"""Patient chat response generation service."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import User
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


def _build_prompt(user: Dict[str, Any], message: str, drift: Dict[str, Any], action: Dict[str, Any]) -> str:
    """Build structured prompt for MERaLiON chat generation."""
    return (
        "You are ByteCare, a medication adherence support assistant for older adults in Singapore. "
        "Safety rules (must follow): "
        "1) Do NOT provide medical diagnosis. "
        "2) Do NOT recommend medication changes (do not start, stop, skip, or change dose/timing). "
        "3) If user asks for diagnosis or medication change, advise them to check with their doctor or pharmacist. "
        "4) Keep response supportive, calm, and concise (1-2 short sentences, max 35 words). "
        "5) Use simple words suitable for elderly users in Singapore. "
        "6) Singlish-friendly phrasing is allowed (light, respectful, optional lah/leh/lor).\n\n"
        "Output rules: "
        "Return only the patient-facing reply text. "
        "Do not output JSON. "
        "Do not include internal reasoning.\n\n"
        f"User profile: name={user.get('name','Patient')}, age={user.get('age')}, timezone={user.get('timezone')}\n"
        f"Patient message: {message}\n"
        f"Drift context: drift_detected={drift.get('drift_detected')}, severity={drift.get('severity')}, trigger={drift.get('trigger')}\n"
        f"Recommended next action: {action.get('next_action')}\n"
        "Tone: warm, respectful, encouraging, not patronizing."
    )


def generate_patient_reply(user_id: str, message: str) -> Dict[str, Any]:
    """Generate a short patient-facing chat reply using context from deterministic engines."""
    with SessionLocal() as db:
        user_obj = db.query(User).filter_by(user_id=user_id).first()
        if not user_obj:
            raise HTTPException(status_code=404, detail="User not found")
        user = user_obj.to_dict()

    drift = detect_adherence_drift(user_id)
    action = determine_next_action(user_id)

    context = {
        "drift_detected": drift["drift_detected"],
        "severity": drift["severity"],
        "next_action": action["next_action"],
    }

    client = MeralionClient()
    if not client.enabled:
        return {
            "reply": _rule_based_reply(user.get("name", "Patient"), message, action["next_action"]),
            "context": context,
        }

    prompt = _build_prompt(user, message, drift, action)

    try:
        reply = client.chat(prompt, hyperparameters={"temperature": 0.3, "topP": 0.9})
    except MeralionClientError:
        reply = _rule_based_reply(user.get("name", "Patient"), message, action["next_action"])

    return {
        "reply": reply,
        "context": context,
    }
