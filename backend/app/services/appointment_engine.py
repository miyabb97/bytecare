"""Appointment tracking service."""

from __future__ import annotations

from datetime import datetime, timezone

from typing import Any, Dict

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Appointment, User


def _as_utc(dt: datetime) -> datetime:
    """Normalize naive/aware datetimes into comparable UTC-aware datetimes."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_upcoming_appointments(user_id: str) -> Dict[str, Any]:
    """Return the next upcoming appointment and remaining days."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        appts = db.query(Appointment).filter_by(user_id=user_id).all()
        appt_dicts = [a.to_dict() for a in appts]

    now_utc = datetime.now(timezone.utc)
    appointments: list[tuple[Dict[str, Any], datetime]] = []
    for appt in appt_dicts:
        appt_dt = datetime.fromisoformat(appt["datetime"])
        appt_utc = _as_utc(appt_dt)
        if appt_utc >= now_utc:
            appointments.append((appt, appt_utc))

    appointments.sort(key=lambda item: item[1])

    if not appointments:
        return {
            "next_appointment": None,
            "days_remaining": None,
        }

    next_appt, next_appt_utc = appointments[0]

    return {
        "next_appointment": {
            "datetime": next_appt["datetime"],
            "location": next_appt.get("location", ""),
        },
        "days_remaining": (next_appt_utc.date() - now_utc.date()).days,
    }
