"""Intervention orchestrator service.

Decides what intervention to trigger based on risk level, logs it,
and optionally injects a system message into the patient's chat.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

from app.db import SessionLocal
from app.models import ChatMessage, InterventionLog, User
from app.services.mee import compute_adherence_score
from app.services.drift_engine import detect_adherence_drift
from app.services.meralion_client import MeralionClient, MeralionClientError


def _risk_from_score_and_drift(mee_score: float, drift: Dict[str, Any]) -> str:
    """Deterministic risk classification: LOW / MEDIUM / HIGH."""
    severity = drift.get("severity", "green")
    if mee_score > 80 and severity == "green":
        return "LOW"
    if mee_score < 50 or severity in ("red",):
        return "HIGH"
    return "MEDIUM"


def _choose_action(risk_level: str) -> str:
    """Map risk level to intervention action type."""
    return {
        "LOW": "gentle_reminder",
        "MEDIUM": "chatbot_support",
        "HIGH": "caregiver_alert",
    }[risk_level]


def _default_message(action: str, patient_name: str, mee_score: float) -> str:
    """Generate a deterministic intervention message."""
    if action == "gentle_reminder":
        return (
            f"Hi {patient_name}, just a friendly reminder to take your medications on time today. "
            "You're doing well — keep it up!"
        )
    if action == "chatbot_support":
        return (
            f"Hi {patient_name}, we noticed some missed or late doses recently "
            f"(adherence score: {mee_score}). "
            "I'm here to help — feel free to chat with me about any difficulties you're facing."
        )
    # caregiver_alert
    return (
        f"Hi {patient_name}, your adherence has been declining "
        f"(score: {mee_score}). "
        "Your caregiver and care team have been notified to check in with you. "
        "Please take your medications and let us know if you need help."
    )


def _agent_rephrase(action: str, patient_name: str, mee_score: float, drift_severity: str) -> Optional[str]:
    """Use LLM to generate patient-friendly intervention wording.

    The agent ONLY phrases the message — it does NOT determine the action type,
    risk level, or score. Those are all rule-based.
    Returns None if LLM unavailable (falls back to deterministic message).
    """
    client = MeralionClient()
    if not client.enabled:
        return None

    action_desc = {
        "gentle_reminder": "a gentle medication reminder",
        "chatbot_support": "support for declining adherence, encouraging the patient to chat",
        "caregiver_alert": "an alert that the caregiver has been notified due to serious adherence decline",
    }.get(action, "a medication reminder")

    prompt = (
        "You are ByteCare, a caring medication assistant for elderly patients in Singapore. "
        f"Write {action_desc} message for {patient_name}. "
        f"Their adherence score is {mee_score}/100 and drift severity is {drift_severity}. "
        "Rules: 1) Do NOT give medical advice or suggest medication changes. "
        "2) Keep it warm, supportive, 2-3 short sentences, max 50 words. "
        "3) Use simple words. Light Singlish tone is okay. "
        "4) Return ONLY the patient-facing message text, nothing else."
    )

    try:
        reply = client.chat(prompt, hyperparameters={"temperature": 0.4, "topP": 0.9})
        return reply.strip() if reply and reply.strip() else None
    except MeralionClientError:
        return None


def run_orchestrator(user_id: str, custom_message: Optional[str] = None) -> Dict[str, Any]:
    """Run the full intervention pipeline for a patient.

    1. Compute MEE adherence score
    2. Detect drift
    3. Classify risk (LOW / MEDIUM / HIGH)
    4. Choose action type
    5. Log intervention
    6. Inject system message into chat (unread)

    Returns the intervention record.
    """
    mee = compute_adherence_score(user_id)
    drift = detect_adherence_drift(user_id)

    risk_level = _risk_from_score_and_drift(mee["score"], drift)
    action_type = _choose_action(risk_level)

    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        patient_name = user.name if user else "Patient"

        reason = (
            f"MEE score={mee['score']}; drift_severity={drift['severity']}; "
            f"missed={mee['counts']['missed']}; late={mee['counts']['late']}; "
            f"risk={risk_level}"
        )

        message = custom_message or _agent_rephrase(action_type, patient_name, mee["score"], drift["severity"]) or _default_message(action_type, patient_name, mee["score"])

        now_str = datetime.now().isoformat(timespec="seconds")
        intervention_id = str(uuid4())

        # Log intervention
        db.add(InterventionLog(
            intervention_id=intervention_id,
            user_id=user_id,
            action_type=action_type,
            risk_level=risk_level,
            reason=reason,
            message=message,
            timestamp=now_str,
        ))

        # Chat message logic: only ONE unread alert at a time.
        # LOW risk = adherence recovered → mark any existing unread alert as read (clears badge).
        # MEDIUM/HIGH risk → replace the existing unread alert (update in place) or create a new one.
        existing_unread = (
            db.query(ChatMessage)
            .filter_by(user_id=user_id, role="system", is_read=0)
            .order_by(ChatMessage.created_at.desc())
            .first()
        )

        if risk_level == "LOW":
            # Adherence is good — clear any pending alert, don't create a new one
            if existing_unread:
                db.query(ChatMessage).filter_by(user_id=user_id, role="system", is_read=0).update({"is_read": 1})
        else:
            if existing_unread:
                # Update the existing unread message in place (no badge count increase)
                existing_unread.content = message
                existing_unread.created_at = now_str
            else:
                # No existing alert — create one
                db.add(ChatMessage(
                    message_id=str(uuid4()),
                    user_id=user_id,
                    role="system",
                    content=message,
                    language="en",
                    is_read=0,
                    created_at=now_str,
                ))

        db.commit()

    return {
        "intervention_id": intervention_id,
        "user_id": user_id,
        "action_type": action_type,
        "risk_level": risk_level,
        "reason": reason,
        "message": message,
        "mee_score": mee["score"],
        "drift_severity": drift["severity"],
        "timestamp": now_str,
    }
