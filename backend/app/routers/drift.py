"""Drift detection endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.drift_engine import detect_adherence_drift

router = APIRouter()

_SEVERITY_TO_RISK = {
    "green": "LOW",
    "yellow": "MEDIUM",
    "orange": "MEDIUM",
    "red": "HIGH",
}


@router.get("/users/{user_id}/drift")
def get_drift(user_id: str):
    """Get adherence drift signal for a user, including risk level."""
    result = detect_adherence_drift(user_id)
    # Add risk_level mapping requested by the spec
    avg_mes = result.get("details", {}).get("avg_mes", 100)
    if avg_mes > 80:
        risk_level = "LOW"
    elif avg_mes >= 50:
        risk_level = "MEDIUM"
    else:
        risk_level = "HIGH"
    result["risk_level"] = risk_level
    result["drift_type"] = result.get("trigger", None)
    return result
