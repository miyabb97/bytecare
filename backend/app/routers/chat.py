"""Patient chat endpoint router."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.chat_engine import generate_patient_reply

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    language: str = "en"


@router.post("/users/{user_id}/chat")
def chat_with_patient(user_id: str, payload: ChatRequest):
    """Generate a short patient reply using contextual adherence signals."""
    return generate_patient_reply(user_id, payload.message, payload.language)
