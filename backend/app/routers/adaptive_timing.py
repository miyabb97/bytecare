"""Adaptive Timing router — exposes learned routine-based medication timing."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.services.routine_learning import get_adaptive_times, update_behavior_patterns

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
    display_time: str
    sample_count: int
    average_deviation_minutes: int
    smart_reminder_time: Optional[str] = None
    routine_type: str
    timing_status: str
    confidence: str  # "learned" | "default"


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
