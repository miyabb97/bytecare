"""Agent next-action endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.agent_engine import determine_next_action

router = APIRouter()


@router.get("/users/{user_id}/next-action")
def get_next_action(user_id: str):
    """Get the next recommended intervention action for a user."""
    return determine_next_action(user_id)
