"""Agent next-action decision service."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import MesScore, User
from app.services.drift_engine import detect_adherence_drift


def _recent_mes_values(user_id: str) -> List[float]:
    """Collect MES values from the last 7 full days."""
    today = datetime.now().date()
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
        fallback = [float(item.mes) for item in scores]
        return fallback
    return values


def _mes_action(avg_mes: float) -> str:
    """Map MES average to deterministic action tier."""
    if avg_mes >= 80:
        return "none"
    if avg_mes >= 60:
        return "patient_nudge"
    if avg_mes >= 40:
        return "strong_reminder"
    return "caregiver_alert"


def _severity_action(severity: str) -> str:
    """Map drift severity to deterministic action floor."""
    return {
        "green": "none",
        "yellow": "patient_nudge",
        "orange": "strong_reminder",
        "red": "caregiver_alert",
    }.get(severity, "patient_nudge")


def _action_rank(action: str) -> int:
    """Return action rank where higher means more urgent intervention."""
    return {
        "none": 0,
        "patient_nudge": 1,
        "strong_reminder": 2,
        "caregiver_alert": 3,
    }.get(action, 1)


def _risk_level_for_action(action: str) -> str:
    """Map action to risk color level."""
    return {
        "none": "green",
        "patient_nudge": "yellow",
        "strong_reminder": "orange",
        "caregiver_alert": "red",
    }[action]


def _suggested_message_for_action(action: str) -> str:
    """Map action to deterministic user-facing message."""
    return {
        "none": "Great job staying on schedule. Keep it up.",
        "patient_nudge": "Quick reminder to take your medication on time today.",
        "strong_reminder": "Please take your medication now and confirm once done.",
        "caregiver_alert": "Caregiver follow-up is recommended due to sustained adherence risk.",
    }[action]


def determine_next_action(user_id: str) -> Dict[str, Any]:
    """Determine next action using MES tier + drift severity floor."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    values = _recent_mes_values(user_id)
    avg_mes = round(sum(values) / len(values), 2) if values else 100.0
    drift = detect_adherence_drift(user_id)
    severity = drift["severity"]

    mes_action = _mes_action(avg_mes)
    severity_floor_action = _severity_action(severity)
    final_action = mes_action if _action_rank(mes_action) >= _action_rank(severity_floor_action) else severity_floor_action

    reason = (
        f"avg_mes_7d={avg_mes}; drift_severity={severity}; "
        f"drift_trigger={drift.get('trigger')}; action={final_action}."
    )

    return {
        "risk_level": _risk_level_for_action(final_action),
        "next_action": final_action,
        "reason": reason,
        "suggested_message": _suggested_message_for_action(final_action),
    }
