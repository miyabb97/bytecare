"""Conversation Care Agent — intent detection + supportive healthcare response generation.

Sits in front of the raw LLM call in chat_engine.py to provide:
  - Deterministic intent classification (no LLM for safety-critical branches)
  - Hard medical-advice safety gate (bypass LLM entirely)
  - Contextualised prompt construction with patient metadata
  - Graceful template fallback when MERaLiON is unavailable
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from app.db import SessionLocal
from app.models import Appointment, Medication, User
from app.services.meralion_client import MeralionClient, MeralionClientError

# ---------------------------------------------------------------------------
# Intent detection — keyword / regex rules (deterministic, no LLM)
# ---------------------------------------------------------------------------

_REMINDER_RE = re.compile(
    r"\b(yes|yeah|ok|okay|sure|remind me|set.?reminder|please remind|"
    r"can remind|remind lah|yes please|remind me ah|ok lah|ya|yep|"
    r"alright|set it|go ahead|set reminder)\b",
    re.IGNORECASE,
)
_MEDICAL_ADVICE_RE = re.compile(
    r"\b(diagnose|diagnosis|should i take|change my (dose|dosage|medication)|"
    r"stop taking|increase (my )?(dose|medication)|decrease (my )?(dose|medication)|"
    r"treat|cure|is this (serious|dangerous)|what (disease|condition) do i have)\b",
    re.IGNORECASE,
)
_MISSED_DOSE_RE = re.compile(
    r"\b(forgot|missed|skip|didn.?t take|did not take|haven.?t taken|"
    r"forget to take|miss my)\b",
    re.IGNORECASE,
)
_MEDICATION_QUERY_RE = re.compile(
    r"\b(medication|medicine|pill|dose|dosage|side effect|interact|"
    r"refill|prescription|drug)\b",
    re.IGNORECASE,
)
_EMOTIONAL_RE = re.compile(
    r"\b(worried|scared|anxious|stress|stressful|sad|tired|upset|down|"
    r"lonely|afraid|fear|depress|hopeless|overwhelm)\b",
    re.IGNORECASE,
)


def _detect_intent(message: str) -> str:
    """Classify patient message intent using keyword rules (order matters)."""
    if _MEDICAL_ADVICE_RE.search(message):
        return "medical_advice_request"
    if _REMINDER_RE.search(message):
        return "set_reminder"
    if _MISSED_DOSE_RE.search(message):
        return "missed_medication"
    if _EMOTIONAL_RE.search(message):
        return "emotional_support"
    if _MEDICATION_QUERY_RE.search(message):
        return "medication_query"
    return "general_chat"


def _detect_tone(intent: str) -> str:
    if intent == "emotional_support":
        return "empathetic"
    if intent in ("missed_medication", "medical_advice_request"):
        return "reassuring"
    return "supportive"


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_INTENT_GUIDANCE: Dict[str, str] = {
    "set_reminder": (
        "The patient wants a medication reminder set. "
        "Confirm warmly that you will set a reminder for their next dose."
    ),
    "missed_medication": (
        "The patient missed a dose. Be supportive and non-judgmental. "
        "Gently remind them to take it now if not too close to the next dose."
    ),
    "medication_query": (
        "Answer the patient's medication question using the context. "
        "Do NOT suggest changing doses or diagnosis."
    ),
    "emotional_support": (
        "The patient is feeling down. Be warm, empathetic, and encouraging. "
        "Remind them their care team is here."
    ),
    "general_chat": "Respond warmly and supportively to the patient's message.",
}


def _build_agent_prompt(
    user: Dict[str, Any],
    message: str,
    intent: str,
    drift: Dict[str, Any],
    action: Dict[str, Any],
    medications: List[Dict[str, Any]],
    appointments: List[str],
) -> str:
    med_text = (
        "; ".join(f"{m['name']} ({m['dose']})" for m in medications)
        or "none recorded"
    )
    appt_text = "; ".join(appointments) or "none upcoming"
    guidance = _INTENT_GUIDANCE.get(intent, _INTENT_GUIDANCE["general_chat"])

    return (
        "You are ByteCare, a caring medication adherence support assistant for older adults in Singapore.\n"
        "Answer the patient's message directly and warmly using the context below.\n\n"
        "Safety rules (must follow strictly):\n"
        "1. Do NOT diagnose conditions or suggest changing medication doses.\n"
        "2. Keep your response to 2-3 short, clear sentences (max 60 words).\n"
        "3. Use simple words suitable for elderly users.\n"
        "4. Light Singlish tone is okay (lah, leh, lor).\n\n"
        f"Intent guidance: {guidance}\n\n"
        f"Patient: {user.get('name', 'Patient')}, age {user.get('age')}\n"
        f"Conditions: {', '.join(user.get('conditions') or []) or 'none'}\n"
        f"Medications: {med_text}\n"
        f"Upcoming appointments: {appt_text}\n"
        f"Adherence: drift={drift.get('drift_detected')}, severity={drift.get('severity')}\n"
        f"Suggested action: {action.get('next_action')}\n\n"
        f"Patient message: {message}\n"
        "Reply (warm, 2-3 sentences):"
    )


# ---------------------------------------------------------------------------
# Template fallback (no MERaLiON key)
# ---------------------------------------------------------------------------

def _template_reply(
    name: str,
    intent: str,
    next_action: str,
    medications: List[Dict[str, Any]],
) -> str:
    if intent == "medical_advice_request":
        return (
            f"{name}, I understand you have questions about your health. "
            "Please consult your doctor or caregiver for medical advice — "
            "they know your situation best lah."
        )
    if intent == "set_reminder":
        med_name = medications[0]["name"] if medications else "your medication"
        return (
            f"Sure {name}! I'll set a reminder for {med_name} so you don't miss it. "
            "You'll get a notification before it's time lah."
        )
    if intent == "missed_medication":
        if next_action == "caregiver_alert":
            return (
                f"{name}, I noticed you've been missing doses — "
                "your caregiver has been notified and will check in soon."
            )
        return (
            f"{name}, that's okay, it happens sometimes. "
            "Please take your medication now if it's not too close to your next dose lah."
        )
    if intent == "emotional_support":
        return (
            f"{name}, I hear you. It's okay to feel that way. "
            "Remember, you're not alone — your care team is always here to support you."
        )
    if next_action == "caregiver_alert":
        return (
            f"{name}, I'm here to help. "
            "Your caregiver has also been notified to check in with you."
        )
    if next_action == "strong_reminder":
        return (
            f"{name}, please take your medication now and let me know once done. "
            "You're doing your best lah."
        )
    if next_action == "patient_nudge":
        return (
            f"{name}, a gentle reminder to follow your medication schedule today. "
            "Keep it up!"
        )
    return (
        f"Thank you for reaching out, {name}. "
        "I'm here to support you. Take care and remember your medications ah."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_agent_response(user_id: str, message: str) -> Dict[str, Any]:
    """Conversation Care Agent — returns reply + metadata.

    Returns:
        reply           str  — patient-facing response text
        tone            str  — supportive | empathetic | reassuring
        suggested_action str — none | set_reminder | caregiver_check
        intent          str  — detected intent label
    """
    from app.services.drift_engine import detect_adherence_drift
    from app.services.agent_engine import determine_next_action

    # ---- fetch patient context ----
    with SessionLocal() as db:
        user_obj = db.query(User).filter_by(user_id=user_id).first()
        if not user_obj:
            return {
                "reply": "I'm not able to find your profile right now. Please try again.",
                "tone": "supportive",
                "suggested_action": "none",
                "intent": "general_chat",
            }
        user = user_obj.to_dict()
        medications = [
            {
                "name": m.name,
                "dose": m.dose_text or "dose not specified",
                "medication_id": m.medication_id,
            }
            for m in db.query(Medication).filter_by(user_id=user_id).all()
        ]
        appointments = [
            f"{a.datetime_str} at {a.location}" if a.location else a.datetime_str
            for a in (
                db.query(Appointment)
                .filter_by(user_id=user_id)
                .order_by(Appointment.datetime_str)
                .limit(3)
                .all()
            )
        ]

    intent = _detect_intent(message)
    tone = _detect_tone(intent)

    # Hard safety gate — never use LLM for medical advice
    if intent == "medical_advice_request":
        return {
            "reply": _template_reply(user.get("name", "Patient"), intent, "none", medications),
            "tone": "reassuring",
            "suggested_action": "none",
            "intent": intent,
        }

    # Determine suggested_action
    suggested_action = "none"
    if intent == "set_reminder":
        suggested_action = "set_reminder"

    # Fetch drift + next action for prompt/template context
    try:
        drift = detect_adherence_drift(user_id)
        action = determine_next_action(user_id)
    except Exception:
        drift = {"drift_detected": False, "severity": "green"}
        action = {"next_action": "none"}

    if intent == "missed_medication" and action.get("next_action") == "caregiver_alert":
        suggested_action = "caregiver_check"

    # Try MERaLiON, fall back to template
    client = MeralionClient()
    reply: Optional[str] = None

    if client.enabled:
        prompt = _build_agent_prompt(
            user, message, intent, drift, action, medications, appointments
        )
        try:
            raw = client.chat(prompt, hyperparameters={"temperature": 0.35, "topP": 0.9})
            if raw and raw.strip():
                reply = raw.strip()
        except MeralionClientError:
            reply = None

    if not reply:
        reply = _template_reply(
            user.get("name", "Patient"),
            intent,
            action.get("next_action", "none"),
            medications,
        )

    return {
        "reply": reply,
        "tone": tone,
        "suggested_action": suggested_action,
        "intent": intent,
    }
