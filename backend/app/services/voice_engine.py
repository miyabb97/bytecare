"""Voice transcript interpretation service."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException

from app.db import DB
from app.services.meralion_client import MeralionClient, MeralionClientError


def _compact_text(text: str) -> str:
    return " ".join(text.split())


def _detect_language_hint(text: str) -> str:
    lower = text.lower()
    if any("\u4e00" <= ch <= "\u9fff" for ch in text):
        return "chinese"
    if any(word in lower for word in ["lah", "lor", "leh", "can", "cannot"]):
        return "singlish_or_english"
    if any(word in lower for word in ["terima", "makan", "saya"]):
        return "malay"
    return "english"


def _detect_emotion(text: str) -> str:
    lower = text.lower()
    if any(w in lower for w in ["worried", "scared", "anxious", "stress"]):
        return "anxious"
    if any(w in lower for w in ["sad", "tired", "upset", "down"]):
        return "low"
    if any(w in lower for w in ["okay", "fine", "good", "can"]):
        return "neutral"
    return "neutral"


def _detect_intent(text: str) -> str:
    lower = text.lower()
    if any(w in lower for w in ["forgot", "missed", "skip", "didn't take", "did not take"]):
        return "missed_medication"
    if any(w in lower for w in ["side effect", "dizzy", "nausea", "headache"]):
        return "side_effect_concern"
    if any(w in lower for w in ["when", "what time", "schedule", "remind"]):
        return "schedule_help"
    return "general_check_in"


def _rule_based_analysis(transcript: str) -> Dict[str, str]:
    cleaned = _compact_text(transcript)
    return {
        "cleaned_text": cleaned,
        "language_hint": _detect_language_hint(cleaned),
        "emotion_tag": _detect_emotion(cleaned),
        "intent": _detect_intent(cleaned),
    }


def _parse_structured_json(text: str) -> Dict[str, str]:
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found")

    parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Parsed output is not an object")

    required = ["cleaned_text", "language_hint", "emotion_tag", "intent"]
    if any(key not in parsed for key in required):
        raise ValueError("Missing required fields")

    return {
        "cleaned_text": str(parsed["cleaned_text"]).strip(),
        "language_hint": str(parsed["language_hint"]).strip(),
        "emotion_tag": str(parsed["emotion_tag"]).strip(),
        "intent": str(parsed["intent"]).strip(),
    }


def _build_prompt(transcript: str) -> str:
    return (
        "Extract structured interpretation for the transcript below. "
        "Return JSON only, no markdown, with keys: "
        "cleaned_text, language_hint, emotion_tag, intent.\n\n"
        "Rules:\n"
        "- cleaned_text: concise cleaned sentence preserving meaning\n"
        "- language_hint: one short label\n"
        "- emotion_tag: one of neutral, anxious, low, positive\n"
        "- intent: short snake_case intent label\n\n"
        f"Transcript: {transcript}"
    )


def analyze_transcript(user_id: str, transcript: str) -> Dict[str, str]:
    """Interpret transcript with MERaLiON and persist structured voice log output."""
    if user_id not in DB["users"]:
        raise HTTPException(status_code=404, detail="User not found")

    DB.setdefault("voice_logs", [])

    client = MeralionClient()
    result: Dict[str, str]
    source = "rule_based"

    if not client.enabled:
        result = _rule_based_analysis(transcript)
    else:
        prompt = _build_prompt(transcript)
        try:
            model_text = client.chat(prompt, hyperparameters={"temperature": 0.2, "topP": 0.9})
            result = _parse_structured_json(model_text)
            source = "meralion"
        except (MeralionClientError, ValueError, json.JSONDecodeError):
            result = _rule_based_analysis(transcript)

    DB["voice_logs"].append(
        {
            "log_id": str(uuid4()),
            "user_id": user_id,
            "transcript": transcript,
            "result": result,
            "source": source,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
    )

    return result
