"""Adherence drift detection service."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import DB


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


def _avg_mes_last_7_days(user_id: str) -> float:
    """Compute user's average MES over the last 7 full days."""
    today = datetime.now().date()
    lower = today - timedelta(days=7)
    upper = today - timedelta(days=1)

    values: List[float] = []
    for item in DB["mes_scores"]:
        if item.get("user_id") != user_id:
            continue
        scheduled_dt = item.get("scheduled_datetime")
        if not scheduled_dt:
            continue
        scheduled_date = datetime.fromisoformat(scheduled_dt).date()
        if lower <= scheduled_date <= upper:
            values.append(float(item.get("mes", 0)))

    if not values:
        return 100.0
    return round(sum(values) / len(values), 2)


def detect_adherence_drift(user_id: str) -> Dict[str, Any]:
    """Detect adherence drift for a user using missed doses, late doses, and MES average."""
    if user_id not in DB["users"]:
        raise HTTPException(status_code=404, detail="User not found")

    today = datetime.now().date()
    lower = today - timedelta(days=7)
    upper = today - timedelta(days=1)

    missed_doses = 0
    late_doses = 0
    meds = [m for m in DB["medications"].values() if m.get("user_id") == user_id]

    for med in meds:
        med_id = med.get("medication_id")
        scheduled = _scheduled_datetimes_last_7_days(med)
        events = [
            datetime.fromisoformat(ev["timestamp"])
            for ev in DB["dose_events"]
            if ev.get("user_id") == user_id
            and ev.get("medication_id") == med_id
            and lower <= datetime.fromisoformat(ev["timestamp"]).date() <= upper
        ]
        used = [False] * len(events)

        for scheduled_dt in scheduled:
            candidate_idx = -1
            candidate_diff = None
            for idx, event_dt in enumerate(events):
                if used[idx] or event_dt.date() != scheduled_dt.date():
                    continue
                diff = abs((event_dt - scheduled_dt).total_seconds())
                if candidate_diff is None or diff < candidate_diff:
                    candidate_diff = diff
                    candidate_idx = idx

            if candidate_idx == -1:
                missed_doses += 1
                continue

            used[candidate_idx] = True
            event_dt = events[candidate_idx]
            minutes_late = (event_dt - scheduled_dt).total_seconds() / 60
            if minutes_late > 120:
                late_doses += 1

    avg_mes = _avg_mes_last_7_days(user_id)

    trigger_scores = {
        "missed_doses": (missed_doses / 3) if missed_doses >= 3 else 0,
        "late_doses": (late_doses / 2) if late_doses >= 2 else 0,
        "low_mes": ((60 - avg_mes) / 60) if avg_mes < 60 else 0,
    }
    trigger = max(trigger_scores, key=trigger_scores.get)

    drift_detected = missed_doses >= 3 or late_doses >= 2 or avg_mes < 60
    if not drift_detected:
        severity = "green"
    elif missed_doses >= 6 or late_doses >= 4 or avg_mes < 40:
        severity = "red"
    elif missed_doses >= 4 or late_doses >= 3 or avg_mes < 50:
        severity = "orange"
    else:
        severity = "yellow"

    return {
        "drift_detected": drift_detected,
        "severity": severity,
        "trigger": trigger,
        "details": {
            "missed_doses": missed_doses,
            "late_doses": late_doses,
            "avg_mes": avg_mes,
        },
    }
