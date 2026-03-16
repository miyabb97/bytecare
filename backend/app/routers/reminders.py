"""Reminders router — set, clear, and fire medication dose reminders."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agents.reminder_agent import (
    check_and_fire_reminders,
    clear_medication_reminder,
    set_medication_reminder,
)

router = APIRouter()


class ReminderSetRequest(BaseModel):
    offset_minutes: int = Field(default=10, ge=1, le=120)


class ReminderSetResponse(BaseModel):
    success: bool
    set_count: int
    offset_minutes: int
    medications: List[str]


class ReminderCheckResponse(BaseModel):
    fired: List[Dict[str, Any]]
    checked: int


@router.post(
    "/users/{user_id}/reminders/check",
    response_model=ReminderCheckResponse,
    summary="Check and fire due medication reminders",
)
def check_reminders(user_id: str):
    """Fire system chat messages for any medication reminders that are due now.

    Safe to call repeatedly — deduplicates by checking the last 2 hours.
    """
    return check_and_fire_reminders(user_id)


@router.put(
    "/users/{user_id}/medications/{medication_id}/reminder",
    response_model=ReminderSetResponse,
    summary="Set a reminder for a specific medication",
)
def set_reminder(user_id: str, medication_id: str, body: ReminderSetRequest):
    """Store a reminder preference (offset_minutes before scheduled dose) on a medication."""
    result = set_medication_reminder(user_id, medication_id, body.offset_minutes)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "Medication not found"))
    return result


@router.delete(
    "/users/{user_id}/medications/{medication_id}/reminder",
    summary="Clear the reminder for a specific medication",
)
def clear_reminder(user_id: str, medication_id: str):
    """Remove the reminder preference from a medication."""
    result = clear_medication_reminder(user_id, medication_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "Medication not found"))
    return result
