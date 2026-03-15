"""Orchestration endpoint router."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.orchestrator import run_orchestrator

router = APIRouter()


class OrchestratorRequest(BaseModel):
    custom_message: Optional[str] = None


@router.post("/users/{user_id}/orchestrate")
def orchestrate_intervention(user_id: str, payload: OrchestratorRequest = OrchestratorRequest()):
    """Run the intervention orchestrator for a patient.

    Computes adherence score, detects drift, classifies risk,
    chooses action, logs intervention, and injects chat message.
    """
    return run_orchestrator(user_id, custom_message=payload.custom_message)
