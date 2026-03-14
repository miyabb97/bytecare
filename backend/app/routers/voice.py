"""Voice agent endpoint router – chat + TTS."""

from __future__ import annotations

import io

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.voice_engine import analyze_transcript, voice_agent_reply, text_to_speech, translate_text

router = APIRouter()


class VoiceTranscriptRequest(BaseModel):
    transcript: str


class VoiceAgentRequest(BaseModel):
    message: str


class TTSRequest(BaseModel):
    text: str
    lang: str = "en"


@router.post("/users/{user_id}/voice/transcript")
def analyze_voice_transcript(user_id: str, payload: VoiceTranscriptRequest):
    """Analyze transcript text and return structured interpretation fields."""
    return analyze_transcript(user_id, payload.transcript)


@router.post("/users/{user_id}/voice/agent")
def voice_agent(user_id: str, payload: VoiceAgentRequest):
    """Voice agent – generate a Singlish-friendly reply for the patient."""
    return voice_agent_reply(user_id, payload.message)


@router.post("/voice/tts")
def tts_endpoint(payload: TTSRequest):
    """Convert text to speech audio (MP3)."""
    audio_bytes = text_to_speech(payload.text, lang=payload.lang)
    return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")


class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "en"


@router.post("/voice/translate")
def translate_endpoint(payload: TranslateRequest):
    """Translate text to a target language via MERaLiON."""
    translated = translate_text(payload.text, payload.target_lang)
    return {"translated_text": translated, "target_lang": payload.target_lang}
