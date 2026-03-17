"""Reminder Agent — medication reminder storage and firing.

Responsibilities:
  - set_medication_reminder  : store reminder_offset_minutes on medication(s)
  - check_and_fire_reminders : inject system chat messages when dose time approaches
  - clear_medication_reminder: remove reminder preference
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.db import SessionLocal
from app.models import ChatMessage, Medication, MedicationBehaviorPattern, User


def set_medication_reminder(
    user_id: str,
    medication_id: Optional[str],
    offset_minutes: int = 10,
) -> Dict[str, Any]:
    """Store a reminder preference on one or all of the user's medications.

    Args:
        user_id:        patient user ID
        medication_id:  specific medication, or None to apply to all
        offset_minutes: minutes before scheduled dose to remind (default 10)
    """
    with SessionLocal() as db:
        if medication_id:
            meds = (
                db.query(Medication)
                .filter_by(medication_id=medication_id, user_id=user_id)
                .all()
            )
        else:
            meds = db.query(Medication).filter_by(user_id=user_id).all()

        if not meds:
            return {"success": False, "message": "No medications found.", "set_count": 0}

        for med in meds:
            med.reminder_offset_minutes = offset_minutes
        db.commit()

        return {
            "success": True,
            "set_count": len(meds),
            "offset_minutes": offset_minutes,
            "medications": [m.name for m in meds],
        }


def clear_medication_reminder(user_id: str, medication_id: str) -> Dict[str, Any]:
    """Remove the reminder preference from a specific medication."""
    with SessionLocal() as db:
        med = (
            db.query(Medication)
            .filter_by(medication_id=medication_id, user_id=user_id)
            .first()
        )
        if not med:
            return {"success": False, "message": "Medication not found."}
        med.reminder_offset_minutes = None
        db.commit()
        return {"success": True, "medication": med.name}


def schedule_quick_reminder(user_id: str, delay_seconds: int) -> Dict[str, Any]:
    """Schedule a one-time system reminder after N seconds.

    This supports chat inputs like "remind me in 10 seconds" for quick testing.
    """
    delay_seconds = max(1, int(delay_seconds))

    def _worker() -> None:
        time.sleep(delay_seconds)
        now_str = datetime.now().isoformat(timespec="seconds")
        with SessionLocal() as db:
            user = db.query(User).filter_by(user_id=user_id).first()
            if not user:
                return
            text = f"Reminder: Time to take your medication now ({delay_seconds}s timer)."
            db.add(
                ChatMessage(
                    message_id=str(uuid4()),
                    user_id=user_id,
                    role="system",
                    content=text,
                    language="en",
                    is_read=0,
                    created_at=now_str,
                )
            )
            db.commit()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    return {"success": True, "delay_seconds": delay_seconds, "mode": "timer"}


def _next_scheduled_time(
    schedule: Dict[str, Any],
    adaptive_overrides: Optional[Dict[str, str]] = None,
) -> Optional[datetime]:
    """Return the next scheduled dose datetime from a medication schedule dict.

    Args:
        schedule: medication schedule with "times" list
        adaptive_overrides: optional mapping of schedule_time -> display_time
            (learned usual time). When provided, uses display_time as the anchor.
    """
    times: List[str] = schedule.get("times", [])
    if not times:
        return None

    now = datetime.now()
    today = now.date()
    candidates: List[datetime] = []

    for hhmm in times:
        # Use learned display_time if available
        anchor = hhmm
        if adaptive_overrides and hhmm in adaptive_overrides:
            anchor = adaptive_overrides[hhmm]
        try:
            h, m = anchor.split(":")
            dt = datetime(today.year, today.month, today.day, int(h), int(m))
            if dt > now:
                candidates.append(dt)
        except (ValueError, AttributeError):
            continue

    if not candidates:
        # No more doses today — try tomorrow
        tomorrow = today + timedelta(days=1)
        for hhmm in times:
            anchor = hhmm
            if adaptive_overrides and hhmm in adaptive_overrides:
                anchor = adaptive_overrides[hhmm]
            try:
                h, m = anchor.split(":")
                dt = datetime(tomorrow.year, tomorrow.month, tomorrow.day, int(h), int(m))
                candidates.append(dt)
            except (ValueError, AttributeError):
                continue

    return min(candidates) if candidates else None


def check_and_fire_reminders(user_id: str) -> Dict[str, Any]:
    """Check medications with reminder preferences and inject chat messages.

    For each medication with reminder_offset_minutes set:
      - Compute next scheduled dose time
      - If now is within [offset, offset-2] minutes before the dose → fire
      - Deduplicate: skip if same reminder was injected in the last 2 hours

    Returns:
        fired   list of dicts describing each fired reminder
        checked int  number of medications checked
    """
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            return {"fired": [], "checked": 0}

        meds = db.query(Medication).filter_by(user_id=user_id).all()
        now = datetime.now()
        now_str = now.isoformat(timespec="seconds")
        two_hours_ago = (now - timedelta(hours=2)).isoformat(timespec="seconds")

        # Load learned patterns for adaptive anchor times
        patterns = (
            db.query(MedicationBehaviorPattern)
            .filter_by(patient_id=user_id)
            .all()
        )
        # Build per-medication adaptive overrides: {med_id: {schedule_time: display_time}}
        adaptive_by_med: Dict[str, Dict[str, str]] = {}
        for p in patterns:
            if p.learned_time and (p.sample_count or 0) >= 3 and p.schedule_time:
                if p.medication_id not in adaptive_by_med:
                    adaptive_by_med[p.medication_id] = {}
                adaptive_by_med[p.medication_id][p.schedule_time] = p.learned_time

        fired: List[Dict[str, Any]] = []

        for med in meds:
            offset = getattr(med, "reminder_offset_minutes", None)
            if not offset:
                continue

            schedule = med.schedule or {}
            overrides = adaptive_by_med.get(med.medication_id)
            next_time = _next_scheduled_time(schedule, adaptive_overrides=overrides)
            if not next_time:
                continue

            minutes_until = (next_time - now).total_seconds() / 60
            is_adaptive = overrides is not None and len(overrides) > 0

            # Fire window: between (offset) and (offset - 2) minutes before dose
            if offset - 2 <= minutes_until <= offset:
                if is_adaptive:
                    reminder_text = (
                        f"Smart reminder: It's almost time for your {med.name}! "
                        f"Your usual time is around {next_time.strftime('%I:%M %p')}. "
                        f"Please get ready ah."
                    )
                else:
                    reminder_text = (
                        f"Reminder: It's almost time for your {med.name}! "
                        f"Scheduled at {next_time.strftime('%I:%M %p')}. "
                        f"Please get ready ah."
                    )

                # Dedup: skip if we already fired for this med within 2 hours
                existing = (
                    db.query(ChatMessage)
                    .filter(
                        ChatMessage.user_id == user_id,
                        ChatMessage.role == "system",
                        ChatMessage.content.like(f"%Reminder:%{med.name}%"),
                        ChatMessage.created_at >= two_hours_ago,
                    )
                    .first()
                )
                if existing:
                    continue

                db.add(
                    ChatMessage(
                        message_id=str(uuid4()),
                        user_id=user_id,
                        role="system",
                        content=reminder_text,
                        language="en",
                        is_read=0,
                        created_at=now_str,
                    )
                )
                fired.append(
                    {
                        "medication": med.name,
                        "scheduled_at": next_time.isoformat(),
                        "reminder_text": reminder_text,
                    }
                )

        if fired:
            db.commit()

        return {"fired": fired, "checked": len(meds)}
