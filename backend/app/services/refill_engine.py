"""Medication refill reminder service.

Tracks how many doses have been taken vs. total prescribed supply,
estimates when each medication will run out, and triggers a proactive
system chat message when any medication is within 7 days of running out.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
from uuid import uuid4

from app.db import SessionLocal
from app.models import ChatMessage, DoseEvent, Medication, User
from app.services.meralion_client import MeralionClient, MeralionClientError


def _doses_per_day(schedule: Dict[str, Any]) -> int:
    """Return scheduled doses per day based on frequency."""
    freq = schedule.get("frequency", "once_daily")
    return {
        "once_daily": 1,
        "twice_daily": 2,
        "thrice_daily": 3,
        "as_needed": 1,
    }.get(freq, 1)


def compute_refill_status(user_id: str) -> List[Dict[str, Any]]:
    """Compute refill status for all medications of a user.

    Returns a list where each entry contains:
    - medication_id, name
    - total_supply: total pills/doses prescribed (0 = not tracked)
    - taken_count: how many 'taken' dose events recorded
    - doses_remaining: total_supply - taken_count
    - days_remaining: doses_remaining / doses_per_day
    - is_low: True if days_remaining <= 7
    - needs_refill: True if days_remaining <= 3
    - tracking_enabled: False if total_supply not set
    """
    with SessionLocal() as db:
        meds = db.query(Medication).filter_by(user_id=user_id).all()
        results = []
        for med in meds:
            total_supply = getattr(med, "total_supply", 0) or 0
            taken_count = db.query(DoseEvent).filter(
                DoseEvent.medication_id == med.medication_id,
                DoseEvent.user_id == user_id,
                DoseEvent.response_status == "taken",
            ).count()

            if total_supply <= 0:
                results.append({
                    "medication_id": med.medication_id,
                    "name": med.name,
                    "dose_text": med.dose_text,
                    "total_supply": 0,
                    "taken_count": taken_count,
                    "doses_remaining": None,
                    "days_remaining": None,
                    "is_low": False,
                    "needs_refill": False,
                    "tracking_enabled": False,
                })
                continue

            remaining = max(0, total_supply - taken_count)
            dpd = _doses_per_day(med.schedule)
            days_remaining = round(remaining / dpd, 1) if dpd > 0 else None
            is_low = days_remaining is not None and days_remaining <= 7
            needs_refill = days_remaining is not None and days_remaining <= 3

            results.append({
                "medication_id": med.medication_id,
                "name": med.name,
                "dose_text": med.dose_text,
                "total_supply": total_supply,
                "taken_count": taken_count,
                "doses_remaining": remaining,
                "days_remaining": days_remaining,
                "is_low": is_low,
                "needs_refill": needs_refill,
                "tracking_enabled": True,
            })

    return results


def _generate_singlish_body(patient_name: str, low_meds: List[Dict[str, Any]]) -> str:
    """Try MeRaLiON to write a Singlish refill reminder; fallback to rule-based English."""
    med_lines = []
    for m in low_meds:
        days = m["days_remaining"]
        remaining = m["doses_remaining"]
        suffix = " (Urgent!)" if m["needs_refill"] else ""
        med_lines.append(f"- {m['name']}: {remaining} doses left (~{days} days){suffix}")

    client = MeralionClient()
    if client.enabled:
        prompt = (
            f"You are ByteCare, a friendly Singaporean healthcare companion who speaks warm Singapore Singlish. "
            f"{patient_name} is running low on medication:\n"
            + "\n".join(med_lines) + "\n\n"
            "Write a short, warm 2-sentence Singlish reminder. "
            "Use natural Singlish phrases (e.g. 'eh', 'lah', 'ah', 'hor', 'must remember to'). "
            "Mention the medication names and remind them to arrange a refill soon. "
            "Do not add any preamble, just write the reminder directly."
        )
        try:
            return client.chat(prompt, hyperparameters={"temperature": 0.75, "topP": 0.9})
        except MeralionClientError:
            pass

    # Fallback: rule-based English
    lines = []
    for m in low_meds:
        days = m["days_remaining"]
        remaining = m["doses_remaining"]
        dose_word = "dose" if remaining == 1 else "doses"
        day_word = "day" if days == 1.0 else "days"
        if m["needs_refill"]:
            lines.append(f"⚠️  {m['name']} — only {remaining} {dose_word} left (~{days} {day_word}). Urgent!")
        else:
            lines.append(f"💊 {m['name']} — {remaining} {dose_word} left (~{days} {day_word})")
    return "\n".join(lines) + "\n\nPlease arrange a refill soon to avoid missing doses."


def check_and_notify_refills(user_id: str) -> Dict[str, Any]:
    """Check refill status and inject a system chat message for low-stock meds.

    Follows the same unread-badge pattern as the intervention orchestrator:
    - If no meds are low: clear any existing unread refill alert
    - If meds are low: upsert a single unread system message
    """
    statuses = compute_refill_status(user_id)
    low_meds = [s for s in statuses if s["is_low"] and s["tracking_enabled"]]

    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        patient_name = user.name if user else "Patient"

        now_str = datetime.now().isoformat(timespec="seconds")

        # Find any existing unread refill-type system message
        existing = (
            db.query(ChatMessage)
            .filter(
                ChatMessage.user_id == user_id,
                ChatMessage.role == "system",
                ChatMessage.is_read == 0,
                ChatMessage.content.like("💊 Refill Reminder%"),
            )
            .first()
        )

        if not low_meds:
            # Clear any existing refill alert if stock is fine
            if existing:
                existing.is_read = 1
            db.commit()
            return {"triggered": False, "low_medications": [], "statuses": statuses}

        # Build the refill alert message body — try MeRaLiON Singlish first
        body = _generate_singlish_body(patient_name, low_meds)
        message = f"💊 Refill Reminder for {patient_name}:\n\n{body}"

        if existing:
            existing.content = message
            existing.created_at = now_str
        else:
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
        "triggered": True,
        "low_medications": [m["name"] for m in low_meds],
        "statuses": statuses,
        "message": message,
    }
