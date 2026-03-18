"""Routine Learning Service — learn each patient's usual medication time.

Observes recent valid "taken" dose events, computes the median taken time
per medication per schedule slot, and exposes adaptive display times for
reminders, planner, and UI.

Key rules:
  - Minimum 3 valid samples before adapting (cold-start protection)
  - Uses median (robust to one-off outliers)
  - Segments weekday vs weekend patterns (elderly patients often differ)
  - Never modifies the prescribed schedule
  - Falls back to schedule_time when insufficient data
"""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import DoseEvent, Medication, MedicationBehaviorPattern

MIN_SAMPLES = 3
LOOKBACK_DAYS = 14
# Doses taken more than this many minutes from the scheduled time are
# considered outliers and excluded from the learned-time computation.
MAX_DEVIATION_FOR_LEARNING = 120  # 2 hours

# Day-of-week grouping: Monday=0..Friday=4 → weekday, Saturday=5..Sunday=6 → weekend
def _is_weekend(iso_timestamp: str) -> Optional[bool]:
    """Return True if the timestamp falls on Saturday/Sunday, False for weekday, None on error."""
    try:
        return datetime.fromisoformat(iso_timestamp).weekday() >= 5
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mins_to_hhmm(mins: int) -> str:
    """Convert minutes-since-midnight to HH:MM string."""
    h = mins // 60
    m = mins % 60
    return f"{h:02d}:{m:02d}"


def _hhmm_to_mins(hhmm: str) -> int:
    """Convert HH:MM string to minutes-since-midnight."""
    parts = hhmm.strip().split(":")
    return int(parts[0]) * 60 + int(parts[1])


def _extract_time_mins(iso_timestamp: str) -> Optional[int]:
    """Extract minutes-since-midnight from an ISO datetime string."""
    try:
        dt = datetime.fromisoformat(iso_timestamp)
        return dt.hour * 60 + dt.minute
    except Exception:
        return None


def _schedule_time_matches(scheduled_for: str, schedule_time: str) -> bool:
    """Check if a DoseEvent.scheduled_for ISO string matches a schedule HH:MM slot."""
    try:
        # scheduled_for is like "2026-03-17T08:00:00"
        time_part = scheduled_for[11:16]  # extract "08:00"
        return time_part == schedule_time
    except Exception:
        return False


def get_default_time(routine_type: str) -> str:
    """Return a sensible default time for a routine period."""
    defaults = {
        "morning": "08:00",
        "afternoon": "13:00",
        "evening": "20:00",
    }
    return defaults.get(routine_type or "morning", "08:00")


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

def compute_learned_timing(
    db: Session,
    user_id: str,
    medication_id: str,
    schedule_time: str,
    max_deviation: int = MAX_DEVIATION_FOR_LEARNING,
    weekend_only: Optional[bool] = None,
) -> Dict[str, Any]:
    """Compute the learned usual time for a specific medication + schedule slot.

    Args:
        weekend_only: None = all days, True = weekends only, False = weekdays only.

    Returns dict with learned_time (HH:MM or None), sample_count,
    average_deviation_minutes, and flagged_count (doses outside window).
    """
    cutoff = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).isoformat(timespec="seconds")
    schedule_mins = _hhmm_to_mins(schedule_time)

    events = (
        db.query(DoseEvent)
        .filter(
            DoseEvent.user_id == user_id,
            DoseEvent.medication_id == medication_id,
            DoseEvent.response_status == "taken",
            DoseEvent.created_at >= cutoff,
        )
        .all()
    )

    # Filter to events matching this schedule slot and extract taken-time minutes
    taken_minutes: List[int] = []
    flagged_count = 0
    for ev in events:
        if not _schedule_time_matches(ev.scheduled_for, schedule_time):
            continue
        # Day-of-week filter
        if weekend_only is not None:
            ev_weekend = _is_weekend(ev.timestamp)
            if ev_weekend is None or ev_weekend != weekend_only:
                continue
        mins = _extract_time_mins(ev.timestamp)
        if mins is not None:
            deviation = abs(mins - schedule_mins)
            if deviation > max_deviation:
                flagged_count += 1
                continue
            taken_minutes.append(mins)

    sample_count = len(taken_minutes)

    if sample_count < MIN_SAMPLES:
        return {
            "learned_time": None,
            "sample_count": sample_count,
            "average_deviation_minutes": 0,
            "flagged_count": flagged_count,
        }

    median_mins = int(statistics.median(taken_minutes))
    avg_dev = int(sum(abs(m - schedule_mins) for m in taken_minutes) / sample_count)

    return {
        "learned_time": _mins_to_hhmm(median_mins),
        "sample_count": sample_count,
        "average_deviation_minutes": avg_dev,
        "flagged_count": flagged_count,
    }


# ---------------------------------------------------------------------------
# Pattern persistence
# ---------------------------------------------------------------------------

def update_behavior_patterns(db: Session, user_id: str) -> List[Dict[str, Any]]:
    """Recompute and upsert MedicationBehaviorPattern rows for all of a user's medications."""
    meds = db.query(Medication).filter_by(user_id=user_id).all()
    now_str = datetime.now().isoformat(timespec="seconds")

    cutoff = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).isoformat(timespec="seconds")
    all_events = (
        db.query(DoseEvent)
        .filter(
            DoseEvent.user_id == user_id,
            DoseEvent.created_at >= cutoff,
        )
        .all()
    )

    results: List[Dict[str, Any]] = []

    for med in meds:
        schedule = med.schedule or {}
        times: List[str] = schedule.get("times", [])
        routine = med.routine_type or "morning"

        for sched_time in times:
            if not sched_time:
                continue

            max_dev = med.time_window_minutes or MAX_DEVIATION_FOR_LEARNING
            # Compute weekday timing (Mon-Fri)
            timing = compute_learned_timing(db, user_id, med.medication_id, sched_time, max_deviation=max_dev, weekend_only=False)
            # Compute weekend timing (Sat-Sun)
            timing_weekend = compute_learned_timing(db, user_id, med.medication_id, sched_time, max_deviation=max_dev, weekend_only=True)

            # Count late and missed doses for this slot
            late_count = 0
            missed_count = 0
            for ev in all_events:
                if ev.medication_id != med.medication_id:
                    continue
                if not _schedule_time_matches(ev.scheduled_for, sched_time):
                    continue
                if ev.response_status == "late":
                    late_count += 1
                elif ev.response_status in ("not_taken", "missed", "skipped"):
                    missed_count += 1

            # Upsert pattern row
            pattern = (
                db.query(MedicationBehaviorPattern)
                .filter_by(
                    patient_id=user_id,
                    medication_id=med.medication_id,
                    schedule_time=sched_time,
                )
                .first()
            )

            if pattern is None:
                pattern = MedicationBehaviorPattern(
                    patient_id=user_id,
                    medication_id=med.medication_id,
                    routine_type=routine,
                    schedule_time=sched_time,
                )
                db.add(pattern)

            pattern.learned_time = timing["learned_time"]
            pattern.sample_count = timing["sample_count"]
            pattern.average_deviation_minutes = timing["average_deviation_minutes"]
            pattern.learned_time_weekend = timing_weekend["learned_time"]
            pattern.sample_count_weekend = timing_weekend["sample_count"]
            pattern.average_deviation_minutes_weekend = timing_weekend["average_deviation_minutes"]
            pattern.late_dose_count = late_count
            pattern.missed_dose_count = missed_count
            pattern.last_updated = now_str

            results.append(pattern.to_dict())

    db.commit()
    return results


# ---------------------------------------------------------------------------
# Adaptive timing for UI / reminders
# ---------------------------------------------------------------------------

def _compute_timing_status(avg_dev: int, sample_count: int) -> str:
    """Return a patient-friendly timing status string."""
    if sample_count < MIN_SAMPLES:
        return "Building your routine profile"
    if avg_dev <= 30:
        return "Within good range"
    if avg_dev <= 60:
        return "Slightly shifted from schedule"
    return "Taken later than usual"


def _compute_smart_reminder_time(
    display_time: str,
    reminder_offset: Optional[int],
) -> Optional[str]:
    """Compute smart reminder time = display_time - offset."""
    if not reminder_offset:
        return None
    display_mins = _hhmm_to_mins(display_time)
    reminder_mins = max(0, display_mins - reminder_offset)
    return _mins_to_hhmm(reminder_mins)


def get_adaptive_times(db: Session, user_id: str) -> List[Dict[str, Any]]:
    """Return adaptive timing entries for all of a user's medications.

    Each entry corresponds to one medication + one schedule-time slot.
    Automatically selects weekday vs weekend learned time based on today.
    """
    meds = db.query(Medication).filter_by(user_id=user_id).all()
    is_today_weekend = datetime.now().weekday() >= 5

    # Load all patterns for this user in one query
    patterns = (
        db.query(MedicationBehaviorPattern)
        .filter_by(patient_id=user_id)
        .all()
    )
    pattern_map: Dict[str, MedicationBehaviorPattern] = {}
    for p in patterns:
        key = f"{p.medication_id}:{p.schedule_time}"
        pattern_map[key] = p

    items: List[Dict[str, Any]] = []

    for med in meds:
        schedule = med.schedule or {}
        times: List[str] = schedule.get("times", [])
        routine = med.routine_type or "morning"
        reminder_offset = med.reminder_offset_minutes

        for sched_time in times:
            if not sched_time:
                continue

            key = f"{med.medication_id}:{sched_time}"
            pattern = pattern_map.get(key)

            learned_time_weekday = None
            learned_time_weekend = None
            sample_count_weekday = 0
            sample_count_weekend = 0
            avg_dev_weekday = 0
            avg_dev_weekend = 0
            confidence = "default"

            if pattern:
                sample_count_weekday = int(pattern.sample_count or 0)
                avg_dev_weekday = int(pattern.average_deviation_minutes or 0)
                sample_count_weekend = int(pattern.sample_count_weekend or 0)
                avg_dev_weekend = int(pattern.average_deviation_minutes_weekend or 0)

                if pattern.learned_time and sample_count_weekday >= MIN_SAMPLES:
                    learned_time_weekday = pattern.learned_time
                if pattern.learned_time_weekend and sample_count_weekend >= MIN_SAMPLES:
                    learned_time_weekend = pattern.learned_time_weekend

            # Pick the right learned time for today
            if is_today_weekend and learned_time_weekend:
                active_learned_time = learned_time_weekend
                active_sample_count = sample_count_weekend
                active_avg_dev = avg_dev_weekend
                confidence = "learned_weekend"
            elif not is_today_weekend and learned_time_weekday:
                active_learned_time = learned_time_weekday
                active_sample_count = sample_count_weekday
                active_avg_dev = avg_dev_weekday
                confidence = "learned"
            elif learned_time_weekday:
                # Weekend but no weekend data yet — fall back to weekday pattern
                active_learned_time = learned_time_weekday
                active_sample_count = sample_count_weekday
                active_avg_dev = avg_dev_weekday
                confidence = "learned"
            else:
                active_learned_time = None
                active_sample_count = sample_count_weekday
                active_avg_dev = avg_dev_weekday

            display_time = active_learned_time if active_learned_time else sched_time
            smart_reminder = _compute_smart_reminder_time(display_time, reminder_offset)
            timing_status = _compute_timing_status(active_avg_dev, active_sample_count)

            items.append({
                "medication_id": med.medication_id,
                "medication_name": med.name,
                "schedule_time": sched_time,
                "learned_time": active_learned_time,
                "learned_time_weekday": learned_time_weekday,
                "learned_time_weekend": learned_time_weekend,
                "display_time": display_time,
                "sample_count": active_sample_count,
                "sample_count_weekday": sample_count_weekday,
                "sample_count_weekend": sample_count_weekend,
                "average_deviation_minutes": active_avg_dev,
                "smart_reminder_time": smart_reminder,
                "routine_type": routine,
                "timing_status": timing_status,
                "confidence": confidence,
                "is_weekend": is_today_weekend,
            })

    return items
