"""Voice transcript interpretation service."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import User, VoiceLog
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
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

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

    with SessionLocal() as db:
        db.add(VoiceLog(
            log_id=str(uuid4()),
            user_id=user_id,
            transcript=transcript,
            result_json=json.dumps(result),
            source=source,
            created_at=datetime.now().isoformat(timespec="seconds"),
        ))
        db.commit()

    return result


# ─── Voice Agent (Singlish chat) ───────────────────────────

_SINGLISH_REPLIES = {
    "missed_medication": (
        "No worries ah, these things happen one. "
        "If can, try to take your medicine now lah. "
        "Maybe can set a little alarm on your phone, so next time easier to remember!"
    ),
    "side_effect_concern": (
        "Sorry to hear you're not feeling well leh. "
        "Sometimes medicine can have side effects, it's normal. "
        "But if it keeps going, please do see your doctor ah — they can help you."
    ),
    "schedule_help": (
        "Sure, no problem! Let me help you check your schedule ah. "
        "Taking medicine on time very important one. "
        "Don't worry, I'm here to help you keep track!"
    ),
    "general_check_in": (
        "Hello! Hope you're doing well today. "
        "Remember to take your medicine on time ah. "
        "If anything is bothering you, just let me know — happy to help!"
    ),
}


def _build_singlish_prompt(user_name: str, message: str) -> str:
    return (
        "You are ByteCare, a friendly and polite medication safety assistant in Singapore. "
        "You speak in a warm, respectful Singlish tone (use lah, ah, leh gently — "
        "do NOT use harsh expressions like aiyoh or wah). "
        "Rules: "
        "1) Do NOT give medical diagnosis or recommend medication changes. "
        "2) If asked about diagnosis or changing meds, kindly advise to see doctor. "
        "3) Be supportive, encouraging, and concise (2-3 sentences max). "
        "4) Use simple English suitable for elderly Singaporean users. "
        "5) Sound like a kind, respectful caregiver — warm but polite.\n\n"
        f"Patient name: {user_name}\n"
        f"Patient says: {message}\n\n"
        "Reply in Singlish tone:"
    )


def voice_agent_reply(user_id: str, message: str) -> Dict[str, Any]:
    """Generate a Singlish-friendly voice agent reply."""
    with SessionLocal() as db:
        user_obj = db.query(User).filter_by(user_id=user_id).first()
        if not user_obj:
            raise HTTPException(status_code=404, detail="User not found")
        user_name = user_obj.name

    # Try MERaLiON first
    client = MeralionClient()
    if client.enabled:
        prompt = _build_singlish_prompt(user_name, message)
        try:
            reply = client.chat(prompt, hyperparameters={"temperature": 0.4, "topP": 0.9})
            return {"reply": reply, "source": "meralion"}
        except MeralionClientError:
            pass

    # Rule-based fallback with Singlish tone
    analysis = _rule_based_analysis(message)
    intent = analysis["intent"]
    reply = _SINGLISH_REPLIES.get(intent, _SINGLISH_REPLIES["general_check_in"])

    # Personalize with name
    if user_name and user_name != "Patient":
        reply = f"{user_name} ah, " + reply[0].lower() + reply[1:]

    return {"reply": reply, "source": "rule_based"}


# ─── Language → Voice mapping ──────────────────────────────

_LANG_VOICES = {
    "en": "en-SG-LunaNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "ms": "ms-MY-YasminNeural",
    "ta": "ta-SG-VenbaNeural",
}

_LANG_GTTS = {"en": "en", "zh": "zh-CN", "ms": "ms", "ta": "ta"}

# ─── Text-to-Speech ────────────────────────────────────────

def text_to_speech(text: str, lang: str = "en") -> bytes:
    """Convert text to MP3 audio bytes using edge-tts with language-appropriate SG voice."""
    voice = _LANG_VOICES.get(lang, _LANG_VOICES["en"])
    try:
        import asyncio
        import edge_tts
        import io

        async def _generate():
            communicate = edge_tts.Communicate(text, voice=voice)
            buf = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])
            buf.seek(0)
            return buf.read()

        # Run the async edge-tts in a new event loop (safe from sync context)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(lambda: asyncio.run(_generate())).result()
            return result
        else:
            return asyncio.run(_generate())
    except Exception:
        # Fallback to gTTS if edge-tts fails
        try:
            from gtts import gTTS
            gtts_lang = _LANG_GTTS.get(lang, "en")
            tts = gTTS(text=text, lang=gtts_lang, slow=False)
            buf = __import__("io").BytesIO()
            tts.write_to_fp(buf)
            buf.seek(0)
            return buf.read()
        except Exception:
            return b""


# ─── Translation via MERaLiON ──────────────────────────────

_LANG_NAMES = {"en": "English", "zh": "Chinese", "ms": "Malay", "ta": "Tamil"}

def translate_text(text: str, target_lang: str) -> str:
    """Translate text to the target language using MERaLiON."""
    if target_lang == "en":
        return text  # already English / Singlish

    lang_name = _LANG_NAMES.get(target_lang, "English")
    from app.services.meralion_client import MeralionClient, MeralionClientError
    client = MeralionClient()
    if not client.enabled:
        return text

    prompt = (
        f"Translate the following text to {lang_name} as spoken in Singapore. "
        f"Keep it natural and conversational. Return ONLY the translated text, nothing else.\n\n"
        f"{text}"
    )
    try:
        return client.chat(prompt)
    except MeralionClientError:
        return text
