"""Memory & Focus Check API router."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.memory_check_agent import memory_check_agent, generate_trend_analysis

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class StartRequest(BaseModel):
    lang: str = "en"


class SubmitRequest(BaseModel):
    session_id: str
    responses: List[str]
    lang: str = "en"


class AnalysisRequest(BaseModel):
    lang: str = "en"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/memory-check/start")
def start_memory_check(user_id: str, payload: StartRequest):
    """Generate a new set of questions and create a session."""
    return memory_check_agent.start_session(user_id, lang=payload.lang)


@router.post("/users/{user_id}/memory-check/submit")
def submit_memory_check(user_id: str, payload: SubmitRequest):
    """Score responses, determine status, and return insight."""
    return memory_check_agent.submit_responses(
        user_id, payload.session_id, payload.responses, lang=payload.lang
    )


@router.get("/users/{user_id}/memory-check/history")
def get_memory_check_history(user_id: str):
    """Return past completed sessions for the user."""
    return memory_check_agent.get_history(user_id)


@router.post("/users/{user_id}/memory-check/analysis")
def get_memory_check_analysis(user_id: str, payload: AnalysisRequest):
    """Get LLM-generated trend analysis of past sessions."""
    return generate_trend_analysis(user_id, lang=payload.lang)
