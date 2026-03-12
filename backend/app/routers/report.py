"""Clinician report summary endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.report_engine import generate_report_summary

router = APIRouter()


@router.get("/users/{user_id}/report-summary")
def get_report_summary(user_id: str):
    """Return structured clinician-facing adherence report summary."""
    return generate_report_summary(user_id)
