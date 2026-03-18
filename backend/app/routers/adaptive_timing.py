"""Adaptive Timing router — exposes learned routine-based medication timing."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.services.routine_learning import get_adaptive_times, update_behavior_patterns
from app.services.meralion_client import MeralionClient, MeralionClientError

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class AdaptiveTimingItem(BaseModel):
    medication_id: str
    medication_name: str
    schedule_time: str
    learned_time: Optional[str] = None
    learned_time_weekday: Optional[str] = None
    learned_time_weekend: Optional[str] = None
    display_time: str
    sample_count: int
    sample_count_weekday: int = 0
    sample_count_weekend: int = 0
    average_deviation_minutes: int
    smart_reminder_time: Optional[str] = None
    routine_type: str
    timing_status: str
    confidence: str  # "learned" | "learned_weekend" | "default"
    is_weekend: bool = False


class AdaptiveTimingResponse(BaseModel):
    user_id: str
    items: List[AdaptiveTimingItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/users/{user_id}/adaptive-timing",
    response_model=AdaptiveTimingResponse,
    summary="Get adaptive display times for all medications",
)
def get_user_adaptive_timing(user_id: str, db: Session = Depends(get_db)):
    """Return per-medication per-schedule-slot adaptive timing data.

    Refreshes learned patterns from recent dose events before responding.
    """
    from app.models import User

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Refresh patterns from latest dose events
    update_behavior_patterns(db, user_id)

    items = get_adaptive_times(db, user_id)

    return AdaptiveTimingResponse(user_id=user_id, items=items)


class TimingInsightResponse(BaseModel):
    user_id: str
    insight: str
    source: str  # "ai" or "deterministic"


def _build_deterministic_insight(items: List[Dict[str, Any]], patient_name: str) -> str:
    """Generate a deterministic insight when MeraLion is unavailable."""
    lines = []
    learned_count = sum(1 for i in items if i.get("confidence") in ("learned", "learned_weekend"))
    if learned_count == 0:
        return f"Hi {patient_name}, we're still building your routine profile. Keep taking your medications and we'll learn your usual timing soon!"

    for item in items:
        if item.get("confidence") not in ("learned", "learned_weekend"):
            continue
        name = item["medication_name"].split(" ")[0]  # short name
        weekday = item.get("learned_time_weekday")
        weekend = item.get("learned_time_weekend")
        if weekday and weekend and weekday != weekend:
            lines.append(f"{name}: you usually take it around {weekday} on weekdays and {weekend} on weekends")
        elif weekday:
            lines.append(f"{name}: you usually take it around {weekday}")

    summary = ". ".join(lines) + "."
    return f"Hi {patient_name}, based on your recent history: {summary} Your reminders have been personalised to match your routine."


@router.get(
    "/users/{user_id}/timing-insight",
    response_model=TimingInsightResponse,
    summary="Get AI-generated insight about the patient's medication timing patterns",
)
def get_timing_insight(user_id: str, db: Session = Depends(get_db)):
    """Generate a patient-friendly explanation of learned timing patterns.

    Uses MeraLion if available, otherwise falls back to a deterministic message.
    """
    from app.models import User
    from app.services.reminder_bandit import get_bandit_stats

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    patient_name = user.name or "Patient"
    items = get_adaptive_times(db, user_id)
    bandit_stats = get_bandit_stats(db, user_id)

    # Build data summary for LLM
    timing_summary_parts = []
    for item in items:
        part = f"- {item['medication_name']} (prescribed at {item['schedule_time']})"
        if item.get("learned_time_weekday"):
            part += f", weekday usual: {item['learned_time_weekday']} ({item['sample_count_weekday']} samples)"
        if item.get("learned_time_weekend"):
            part += f", weekend usual: {item['learned_time_weekend']} ({item['sample_count_weekend']} samples)"
        if item.get("smart_reminder_time"):
            part += f", smart reminder at: {item['smart_reminder_time']}"
        part += f", status: {item['timing_status']}"
        timing_summary_parts.append(part)

    # Summarise bandit learning
    bandit_parts = []
    by_med: Dict[str, list] = {}
    for arm in bandit_stats:
        mid = arm["medication_id"]
        if mid not in by_med:
            by_med[mid] = []
        by_med[mid].append(arm)
    for mid, arms in by_med.items():
        best = max(arms, key=lambda a: a["alpha"] / max(a["alpha"] + a["beta"], 1))
        med_name = next((i["medication_name"] for i in items if i["medication_id"] == mid), mid[:8])
        bandit_parts.append(f"- {med_name}: best reminder offset learned = {best['offset_minutes']} min before (success rate: {best['alpha']}/{best['alpha']+best['beta']})")

    data_block = "\n".join(timing_summary_parts)
    bandit_block = "\n".join(bandit_parts) if bandit_parts else "No reminder optimisation data yet."

    client = MeralionClient()
    if not client.enabled:
        return TimingInsightResponse(
            user_id=user_id,
            insight=_build_deterministic_insight(items, patient_name),
            source="deterministic",
        )

    prompt = (
        "You are ByteCare, a caring medication assistant for elderly patients in Singapore. "
        f"Generate a short, warm insight for {patient_name} about their medication timing patterns. "
        "Explain what the system has learned and why their reminders are set the way they are.\n\n"
        f"TIMING DATA:\n{data_block}\n\n"
        f"REMINDER OPTIMISATION:\n{bandit_block}\n\n"
        "Rules:\n"
        "1) Do NOT give medical advice or suggest changing medications.\n"
        "2) Keep it warm, supportive, and concise.\n"
        "3) Use simple words. Light Singlish tone is okay.\n"
        "4) You MUST mention ALL medications and their learned timings — use a compact format like a short list or grouped sentence.\n"
        "5) Highlight any weekday vs weekend differences.\n"
        "6) Briefly explain why the reminder timing was chosen (e.g., 'we noticed you respond best to reminders X minutes before').\n"
        "7) Return ONLY the patient-facing message text, nothing else."
    )

    try:
        reply = client.chat(prompt, hyperparameters={"temperature": 0.4, "topP": 0.9})
        insight = reply.strip() if reply and reply.strip() else _build_deterministic_insight(items, patient_name)
        source = "ai" if reply and reply.strip() else "deterministic"
    except MeralionClientError:
        insight = _build_deterministic_insight(items, patient_name)
        source = "deterministic"

    return TimingInsightResponse(user_id=user_id, insight=insight, source=source)


@router.get(
    "/users/{user_id}/learning-evidence",
    summary="Get raw learning data — dose timestamps and bandit arm stats for demo/judges",
)
def get_learning_evidence(user_id: str, db: Session = Depends(get_db)):
    """Return the raw data the system learned from:

    1. Per-medication dose event timestamps grouped by weekday/weekend
       with the computed median (learned_time) highlighted.
    2. Thompson Sampling bandit arm stats showing which reminder
       offset is winning and why.
    """
    from datetime import datetime, timedelta
    from app.models import DoseEvent, Medication, User
    from app.services.reminder_bandit import get_bandit_stats
    from app.services.routine_learning import _hhmm_to_mins, _extract_time_mins, MIN_SAMPLES

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    meds = db.query(Medication).filter_by(user_id=user_id).all()
    cutoff = (datetime.now() - timedelta(days=14)).isoformat(timespec="seconds")

    events = (
        db.query(DoseEvent)
        .filter(
            DoseEvent.user_id == user_id,
            DoseEvent.created_at >= cutoff,
        )
        .order_by(DoseEvent.timestamp.asc())
        .all()
    )

    medications = []
    for med in meds:
        sched_times = (med.schedule or {}).get("times", [])
        for sched_time in sched_times:
            if not sched_time:
                continue

            weekday_samples = []
            weekend_samples = []

            for ev in events:
                if ev.medication_id != med.medication_id:
                    continue
                if ev.response_status not in ("taken", "late"):
                    continue
                sf = ev.scheduled_for or ""
                if len(sf) >= 16 and sf[11:16] != sched_time:
                    continue

                try:
                    dt = datetime.fromisoformat(ev.timestamp)
                except Exception:
                    continue

                entry = {
                    "date": dt.strftime("%Y-%m-%d"),
                    "day": dt.strftime("%a"),
                    "time": dt.strftime("%H:%M"),
                    "status": ev.response_status,
                }
                if dt.weekday() >= 5:
                    weekend_samples.append(entry)
                else:
                    weekday_samples.append(entry)

            # Compute medians
            def _median_time(samples):
                if len(samples) < MIN_SAMPLES:
                    return None
                mins = []
                for s in samples:
                    m = _extract_time_mins(f"2000-01-01T{s['time']}:00")
                    if m is not None:
                        mins.append(m)
                if not mins:
                    return None
                import statistics
                median = int(statistics.median(mins))
                return f"{median // 60:02d}:{median % 60:02d}"

            # Bandit arms for this med+slot
            bandit_arms = get_bandit_stats(db, user_id, med.medication_id)
            slot_arms = [a for a in bandit_arms if a.get("schedule_time") == sched_time]
            # Sort by win rate descending
            for arm in slot_arms:
                total = arm["alpha"] + arm["beta"]
                arm["win_rate"] = round(arm["alpha"] / total * 100, 1) if total > 0 else 50.0
            slot_arms.sort(key=lambda a: a["win_rate"], reverse=True)

            medications.append({
                "medication_id": med.medication_id,
                "medication_name": med.name,
                "schedule_time": sched_time,
                "weekday_samples": weekday_samples,
                "weekend_samples": weekend_samples,
                "weekday_median": _median_time(weekday_samples),
                "weekend_median": _median_time(weekend_samples),
                "weekday_count": len(weekday_samples),
                "weekend_count": len(weekend_samples),
                "bandit_arms": slot_arms,
                "best_offset": slot_arms[0]["offset_minutes"] if slot_arms else None,
                "best_win_rate": slot_arms[0]["win_rate"] if slot_arms else None,
            })

    return {
        "user_id": user_id,
        "lookback_days": 14,
        "min_samples_needed": MIN_SAMPLES,
        "medications": medications,
    }
