"""Community event suggestion endpoint router."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.community_engine import (
    cancel_community_event,
    get_user_community_events,
    join_community_event,
    list_community_events,
    recommend_community_events,
    save_community_event,
)

router = APIRouter()


class CommunityEventActionRequest(BaseModel):
    event_id: str


@router.get("/users/{user_id}/community-events")
def get_community_events(user_id: str):
    """Get recommended community events for a user."""
    return recommend_community_events(user_id)


@router.get("/users/{user_id}/community-events/all")
def get_all_community_events(user_id: str):
    """Get all upcoming community events with recommendation metadata."""
    return list_community_events(user_id)


@router.post("/users/{user_id}/community-events/join")
def join_event(user_id: str, payload: CommunityEventActionRequest):
    """Join a recommended community event."""
    return join_community_event(user_id, payload.event_id)


@router.post("/users/{user_id}/community-events/cancel")
def cancel_event(user_id: str, payload: CommunityEventActionRequest):
    """Cancel a previously joined event."""
    return cancel_community_event(user_id, payload.event_id)


@router.post("/users/{user_id}/community-events/save")
def save_event(user_id: str, payload: CommunityEventActionRequest):
    """Save a community event for later."""
    return save_community_event(user_id, payload.event_id)


@router.get("/users/{user_id}/community-events/my-events")
def get_my_events(user_id: str):
    """Get joined and saved community events for a user."""
    return get_user_community_events(user_id)
