"""Patient chat response generation service."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Appointment, ChatMessage, Medication, User
from app.services.agent_engine import determine_next_action
from app.services.drift_engine import detect_adherence_drift
from app.services.meralion_client import MeralionClient, MeralionClientError


def _rule_based_reply(name: str, message: str, next_action: str) -> str:
    """Generate fallback reply when MERaLiON is unavailable."""
    if next_action == "caregiver_alert":
        return f"{name}, I hear you. Please take your medication now, and I can help alert your caregiver if needed."
    if next_action == "strong_reminder":
        return f"{name}, thanks for sharing. Let us get back on track by taking your medication now."
    if next_action == "patient_nudge":
        return f"{name}, thanks for the update. A gentle reminder to follow your medication schedule today."
    return f"Thanks for sharing, {name}. You are doing well, and I am here to support you."


def _build_prompt(user: Dict[str, Any], message: str, drift: Dict[str, Any], action: Dict[str, Any],
                  medications: list, appointments: list, dose_text: list) -> str:
    """Build structured prompt for MERaLiON chat generation."""
    med_text = "; ".join(f"{m['name']} ({m['dose']})" for m in medications) if medications else "none recorded"
    appt_text = "; ".join(appointments) if appointments else "none upcoming"

    return (
        "You are ByteCare, a caring medication adherence support assistant for older adults in Singapore. "
        "You know everything about this patient — their profile, medications, conditions, and appointments. "
        "Answer the patient's question directly using the context below.\n\n"
        "Safety rules (must follow): "
        "1) Do NOT provide medical diagnosis. "
        "2) Do NOT recommend medication changes (do not start, stop, skip, or change dose/timing). "
        "3) If user asks for diagnosis or medication change, advise them to check with their doctor or pharmacist. "
        "4) Keep response supportive, calm, and concise (2-3 short sentences, max 50 words). "
        "5) Use simple words suitable for elderly users in Singapore. "
        "6) Singlish-friendly phrasing is allowed (light, respectful, optional lah/leh/lor). "
        "7) If the patient asks about their medications, conditions, or appointments, answer using the context below. "
        "8) If the patient greets you, reply warmly and briefly.\n\n"
        "Output rules: "
        "Return only the patient-facing reply text. "
        "Do not output JSON. "
        "Do not include internal reasoning.\n\n"
        f"User profile: name={user.get('name','Patient')}, age={user.get('age')}, timezone={user.get('timezone')}\n"
        f"Conditions: {', '.join(user.get('conditions', [])) or 'none'}\n"
        f"Current medications: {med_text}\n"
        f"Upcoming appointments: {appt_text}\n"
        f"Adherence: drift_detected={drift.get('drift_detected')}, severity={drift.get('severity')}, trigger={drift.get('trigger')}\n"
        f"Recommended next action: {action.get('next_action')}\n\n"
        f"Patient message: {message}\n"
        "Tone: warm, respectful, encouraging, not patronizing."
    )


def generate_patient_reply(user_id: str, message: str, language: str = "en") -> Dict[str, Any]:
    """Generate a short patient-facing chat reply using the Conversation Care Agent."""
    # Route through the Conversation Care Agent for intent detection + reply generation
    from app.agents.conversation_agent import generate_agent_response
    agent_result = generate_agent_response(user_id, message)
    reply = agent_result["reply"]
    context_meta = {
        "intent": agent_result["intent"],
        "tone": agent_result["tone"],
        "suggested_action": agent_result["suggested_action"],
    }

    # If agent detected a reminder intent, persist the reminder preference
    if agent_result["suggested_action"] == "set_reminder":
        try:
            from app.agents.reminder_agent import set_medication_reminder
            set_medication_reminder(user_id, None, offset_minutes=10)
        except Exception:
            pass  # non-fatal — reply still delivered

    # Also fetch drift/action for context response (kept for frontend compatibility)
    try:
        drift = detect_adherence_drift(user_id)
        action = determine_next_action(user_id)
    except Exception:
        drift = {"drift_detected": False, "severity": "green"}
        action = {"next_action": "none"}

    context = {
        "drift_detected": drift["drift_detected"],
        "severity": drift["severity"],
        "next_action": action["next_action"],
        "suggested_action": agent_result["suggested_action"],
        "intent": agent_result["intent"],
    }

    # Check user exists (match original behaviour)
    with SessionLocal() as db:
        if not db.query(User).filter_by(user_id=user_id).first():
            raise HTTPException(status_code=404, detail="User not found")

    # Translate if a non-English language is requested
    reply_en = reply
    final_reply = reply
    final_lang = "en"

    if language and language != "en":
        try:
            from app.services.voice_engine import translate_text
            translated = translate_text(reply, language)
            final_reply = translated
            final_lang = language
        except Exception:
            pass

    # Persist user message and assistant reply
    now_str = datetime.now().isoformat(timespec="seconds")
    with SessionLocal() as db:
        db.add(ChatMessage(
            message_id=str(uuid4()),
            user_id=user_id,
            role="user",
            content=message,
            language=language or "en",
            is_read=1,
            created_at=now_str,
        ))
        db.add(ChatMessage(
            message_id=str(uuid4()),
            user_id=user_id,
            role="assistant",
            content=final_reply,
            language=final_lang,
            is_read=1,
            created_at=now_str,
        ))
        # Mark system messages as read since user is actively in chat
        db.query(ChatMessage).filter_by(user_id=user_id, role="system", is_read=0).update({"is_read": 1})
        db.commit()

    result = {
        "reply": final_reply,
        "context": context,
        "language": final_lang,
    }
    if final_lang != "en":
        result["reply_en"] = reply_en
    return result
