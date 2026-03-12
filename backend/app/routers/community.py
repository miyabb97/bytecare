"""Community event suggestion endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.community_engine import recommend_community_events

router = APIRouter()


@router.get("/users/{user_id}/community-events")
def get_community_events(user_id: str):
    """Get suggested community events for a user."""
    return recommend_community_events(user_id)
