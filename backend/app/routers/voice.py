"""Voice transcript endpoint router."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.voice_engine import analyze_transcript

router = APIRouter()


class VoiceTranscriptRequest(BaseModel):
    transcript: str


@router.post("/users/{user_id}/voice/transcript")
def analyze_voice_transcript(user_id: str, payload: VoiceTranscriptRequest):
    """Analyze transcript text and return structured interpretation fields."""
    return analyze_transcript(user_id, payload.transcript)
