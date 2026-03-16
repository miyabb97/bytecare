"""Nudge Optimization API endpoints."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import SessionLocal
from app.models import NudgeLog, NudgePolicyState, User

router = APIRouter()


class NudgeInsightResponse(BaseModel):
    has_personalization: bool
    insight_message: str
    timing_label: str
    best_action: str
    trials_count: int
    best_offset_minutes: int


class NudgeLogItem(BaseModel):
    log_id: str
    medication_id: str
    context_key: str
    action: str
    timing_offset_minutes: int
    tone: str
    reminder_sent_at: str
    outcome: str
    reward: float | None
    created_at: str


@router.get("/users/{user_id}/nudge/insight", response_model=NudgeInsightResponse)
def get_nudge_insight(user_id: str):
    """Return a patient-friendly AI insight about the current reminder strategy."""
    with SessionLocal() as db:
        if not db.query(User).filter_by(user_id=user_id).first():
            raise HTTPException(status_code=404, detail="User not found")

    from app.agents.nudge_agent import get_insight
    insight = get_insight(user_id)
    return NudgeInsightResponse(**insight)


@router.get("/users/{user_id}/nudge/logs")
def get_nudge_logs(user_id: str, limit: int = 20):
    """Return recent nudge decision logs for this patient (for demo/audit)."""
    with SessionLocal() as db:
        if not db.query(User).filter_by(user_id=user_id).first():
            raise HTTPException(status_code=404, detail="User not found")
        logs = (
            db.query(NudgeLog)
            .filter_by(user_id=user_id)
            .order_by(NudgeLog.created_at.desc())
            .limit(min(limit, 100))
            .all()
        )
        return {"items": [log.to_dict() for log in logs]}


@router.get("/users/{user_id}/nudge/policy")
def get_nudge_policy(user_id: str):
    """Return the learned Q-values for this patient (for demo/audit)."""
    with SessionLocal() as db:
        if not db.query(User).filter_by(user_id=user_id).first():
            raise HTTPException(status_code=404, detail="User not found")
        states = (
            db.query(NudgePolicyState)
            .filter_by(user_id=user_id)
            .order_by(NudgePolicyState.context_key, NudgePolicyState.n_trials.desc())
            .all()
        )
        return {"items": [s.to_dict() for s in states]}
