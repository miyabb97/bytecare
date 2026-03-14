"""Patient chat endpoint router — central AI chatbot."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.central_chat import chat_with_context, get_proactive_alerts

router = APIRouter()


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    sender: str  # "user" or "bot"
    text: str


class ChatRequest(BaseModel):
    message: str
    tcm_result: Optional[Dict[str, Any]] = None
    conversation_history: Optional[List[ChatMessage]] = None
    lang: Optional[str] = "en"


@router.post("/users/{user_id}/chat")
def chat_with_patient(user_id: str, payload: ChatRequest):
    """Central chatbot — reads patient profile, meds, appointments,
    adherence, and TCM results to generate a contextual reply."""
    history = None
    if payload.conversation_history:
        history = [{"sender": m.sender, "text": m.text} for m in payload.conversation_history]
    return chat_with_context(
        user_id,
        payload.message,
        tcm_result=payload.tcm_result,
        conversation_history=history,
        lang=payload.lang or "en",
    )


# ---------------------------------------------------------------------------
# Proactive alerts
# ---------------------------------------------------------------------------

class AlertsRequest(BaseModel):
    tcm_result: Optional[Dict[str, Any]] = None


@router.post("/users/{user_id}/chat/alerts")
def get_alerts(user_id: str, payload: AlertsRequest = AlertsRequest()):
    """Return proactive alert messages for the current patient state."""
    return {"alerts": get_proactive_alerts(user_id, payload.tcm_result)}
