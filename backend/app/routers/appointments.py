"""Appointment tracking endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.appointment_engine import get_upcoming_appointments

router = APIRouter()


@router.get("/users/{user_id}/appointments")
def get_appointments(user_id: str):
    """Get the next upcoming appointment for a user."""
    return get_upcoming_appointments(user_id)
