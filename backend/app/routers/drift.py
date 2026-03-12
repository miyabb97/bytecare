"""Drift detection endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.drift_engine import detect_adherence_drift

router = APIRouter()


@router.get("/users/{user_id}/drift")
def get_drift(user_id: str):
    """Get adherence drift signal for a user."""
    return detect_adherence_drift(user_id)
