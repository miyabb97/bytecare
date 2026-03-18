"""Adherence drift detection service."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import DoseEvent, Medication, MesScore, User


def _parse_hhmm(hhmm: str) -> Tuple[int, int]:
    hour, minute = hhmm.split(":")
    return int(hour), int(minute)


def _scheduled_datetimes_last_7_days(med: Dict[str, Any]) -> List[datetime]:
    """Build scheduled dose datetimes for the last 7 full days."""
    result: List[datetime] = []
    now = datetime.now()
    times = med.get("schedule", {}).get("times", [])

    for day_offset in range(1, 8):
        base_date = (now - timedelta(days=day_offset)).date()
        for hhmm in times:
            h, m = _parse_hhmm(hhmm)
            result.append(datetime.combine(base_date, datetime.min.time()).replace(hour=h, minute=m))
    return sorted(result)


def _avg_mes_last_7_days(user_id: str) -> Optional[float]:
    """Compute user's average MES over the last 7 full days. Returns None if no data."""
    today = datetime.utcnow().date()
    lower = today - timedelta(days=7)
    upper = today - timedelta(days=1)

    with SessionLocal() as db:
        scores = db.query(MesScore).filter_by(user_id=user_id).all()

    values: List[float] = []
    for item in scores:
        scheduled_dt = item.scheduled_datetime
        if not scheduled_dt:
            continue
        scheduled_date = datetime.fromisoformat(scheduled_dt).date()
        if lower <= scheduled_date <= upper:
            values.append(float(item.mes))

    if not values:
        return None  # No data — do not treat as perfect adherence
    return round(sum(values) / len(values), 2)


def detect_adherence_drift(user_id: str) -> Dict[str, Any]:
    """Detect adherence drift for a user using missed doses, late doses, and MES average."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]
        dose_events = [e.to_dict() for e in db.query(DoseEvent).filter_by(user_id=user_id).all()]

    today = datetime.utcnow().date()
    lower = today - timedelta(days=7)
    upper = today - timedelta(days=1)

    # Count not_taken directly from DB (includes legacy missed/skipped)
    not_taken_doses = sum(
        1 for ev in dose_events
        if ev.get("response_status") in ("not_taken", "missed", "skipped")
        or ev.get("event_type") in ("dose_not_taken", "dose_missed", "dose_skipped")
        and lower <= datetime.fromisoformat(ev["timestamp"]).date() <= upper
    )

    # Count late doses by matching only taken/late events to scheduled slots
    late_doses = 0
    for med in meds:
        med_id = med.get("medication_id")
        scheduled = _scheduled_datetimes_last_7_days(med)
        # Only consider confirmed intake events (not snoozed/not_taken)
        intake_events = [
            datetime.fromisoformat(ev["timestamp"])
            for ev in dose_events
            if ev.get("medication_id") == med_id
            and ev.get("response_status") in ("taken", "late")
            and lower <= datetime.fromisoformat(ev["timestamp"]).date() <= upper
        ]
        used = [False] * len(intake_events)

        for scheduled_dt in scheduled:
            candidate_idx = -1
            candidate_diff = None
            for idx, event_dt in enumerate(intake_events):
                if used[idx] or event_dt.date() != scheduled_dt.date():
                    continue
                diff = abs((event_dt - scheduled_dt).total_seconds())
                if candidate_diff is None or diff < candidate_diff:
                    candidate_diff = diff
                    candidate_idx = idx

            if candidate_idx == -1:
                continue  # not_taken already counted separately above

            used[candidate_idx] = True
            event_dt = intake_events[candidate_idx]
            minutes_late = (event_dt - scheduled_dt).total_seconds() / 60
            if minutes_late > 120:
                late_doses += 1

    avg_mes = _avg_mes_last_7_days(user_id)

    total_issues = not_taken_doses + late_doses
    trigger_scores = {
        "not_taken_doses": not_taken_doses,
        "late_doses": late_doses,
    }
    trigger = max(trigger_scores, key=trigger_scores.get)

    if total_issues >= 10:
        severity = "red"
    elif total_issues >= 5:
        severity = "yellow"
    else:
        severity = "green"
    drift_detected = severity != "green"

    return {
        "drift_detected": drift_detected,
        "severity": severity,
        "trigger": trigger,
        "details": {
            "not_taken_doses": not_taken_doses,
            "late_doses": late_doses,
            "avg_mes": avg_mes,  # None when no MES data available
        },
    }
