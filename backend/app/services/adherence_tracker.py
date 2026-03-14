"""Medication adherence tracker — mock Smart Pill Box system.

Generates simulated dose events and provides helpers to query
today's medication schedule, missed doses, and recent adherence history.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any, Dict, List
from uuid import uuid4

from app.db import SessionLocal
from app.models import DoseEvent, Medication, User


def mark_dose(user_id: str, medication_id: str, scheduled_time: str, action: str) -> Dict[str, Any]:
    """Record that a patient took / took-late / missed a specific dose.

    Returns a confirmation dict with the resulting status and human-readable message.
    """
    now = datetime.now()
    today = now.date()
    h, m = scheduled_time.split(":")
    sdt = datetime.combine(today, datetime.min.time()).replace(hour=int(h), minute=int(m))

    with SessionLocal() as db:
        med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
        med_name = med.name if med else "your medication"

        if action in ("taken", "late"):
            db.add(DoseEvent(
                event_id=str(uuid4()),
                user_id=user_id,
                medication_id=medication_id,
                event_type="pillbox_open",
                source="patient_app",
                timestamp=now.isoformat(timespec="seconds"),
                created_at=now.isoformat(timespec="seconds"),
            ))
            db.commit()

    ts_str = now.strftime("%I:%M %p")

    if action == "taken":
        return {"status": "taken", "message": f"Okay, marked {med_name} as taken at {ts_str} \u2705"}
    elif action == "late":
        return {"status": "late", "message": f"Got it, marked {med_name} as taken late at {ts_str} \u23f0"}
    else:
        return {"status": "missed", "message": f"Noted \u2014 {med_name} marked as missed. It\u2019s okay, try not to miss the next one \ud83d\udc4d"}


def undo_dose(user_id: str, medication_id: str, scheduled_time: str) -> Dict[str, Any]:
    """Delete the DoseEvent for a specific medication + scheduled time today,
    restoring it to its natural state (upcoming or missed based on current time).
    """
    today = datetime.now().date()
    h, m = scheduled_time.split(":")
    sdt = datetime.combine(today, datetime.min.time()).replace(hour=int(h), minute=int(m))
    window = 180  # generous 3-hour window for matching

    with SessionLocal() as db:
        med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
        med_name = med.name if med else "your medication"

        events = db.query(DoseEvent).filter_by(user_id=user_id, medication_id=medication_id).all()
        deleted = 0
        for ev in events:
            ev_dt = datetime.fromisoformat(ev.timestamp)
            if ev_dt.date() != today:
                continue
            diff = abs((ev_dt - sdt).total_seconds()) / 60
            if diff <= window:
                db.delete(ev)
                deleted += 1
        db.commit()

    if deleted:
        return {"status": "undone", "message": f"Undone \u2014 {med_name} restored to schedule."}
    return {"status": "no_change", "message": f"No recorded dose found for {med_name} at {scheduled_time}."}


def _today_scheduled(med: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return scheduled dose slots for *today* based on a medication's schedule."""
    times = med.get("schedule", {}).get("times", [])
    today = datetime.now().date()
    slots = []
    for t in times:
        h, m = t.split(":")
        scheduled_dt = datetime.combine(today, datetime.min.time()).replace(hour=int(h), minute=int(m))
        slots.append({
            "medication_name": med["name"],
            "medication_id": med["medication_id"],
            "dose_text": med.get("dose_text", ""),
            "scheduled_time": scheduled_dt.strftime("%H:%M"),
            "scheduled_dt": scheduled_dt,
        })
    return slots


def _match_event(events: List[Dict[str, Any]], scheduled_dt: datetime, window_minutes: int, medication_id: str | None = None) -> Dict[str, Any] | None:
    """Find the closest dose event to a scheduled time on the same day,
    optionally filtered to a specific medication."""
    best = None
    best_diff = None
    for ev in events:
        if medication_id and ev.get("medication_id") != medication_id:
            continue
        ev_dt = datetime.fromisoformat(ev["timestamp"])
        if ev_dt.date() != scheduled_dt.date():
            continue
        diff = abs((ev_dt - scheduled_dt).total_seconds()) / 60
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best = {**ev, "_diff_minutes": diff}
    return best


def get_todays_events(user_id: str) -> List[Dict[str, Any]]:
    """Return today's medication schedule with adherence status for each slot."""
    with SessionLocal() as db:
        meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]
        dose_events = [e.to_dict() for e in db.query(DoseEvent).filter_by(user_id=user_id).all()]

    now = datetime.now()
    results = []

    for med in meds:
        window = med.get("time_window_minutes", 120)
        for slot in _today_scheduled(med):
            sdt = slot["scheduled_dt"]
            ev = _match_event(dose_events, sdt, window, medication_id=med["medication_id"])

            if ev:
                ev_dt = datetime.fromisoformat(ev["timestamp"])
                diff = ev["_diff_minutes"]
                status = "taken" if diff <= window else "late"
                taken_time = ev_dt.strftime("%H:%M")
            elif now > sdt + timedelta(minutes=window):
                status = "missed"
                taken_time = None
            else:
                status = "upcoming"
                taken_time = None

            results.append({
                "medication_name": slot["medication_name"],
                "medication_id": slot["medication_id"],
                "dose_text": slot.get("dose_text", ""),
                "scheduled_time": slot["scheduled_time"],
                "taken_time": taken_time,
                "status": status,
                "date": now.strftime("%Y-%m-%d"),
            })

    return results


def check_missed_doses(user_id: str) -> List[Dict[str, Any]]:
    """Return only today's missed doses."""
    return [e for e in get_todays_events(user_id) if e["status"] == "missed"]


def get_adherence_history(user_id: str, days: int = 7) -> List[Dict[str, Any]]:
    """Return adherence summary per day for the last N days."""
    with SessionLocal() as db:
        meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]
        dose_events = [e.to_dict() for e in db.query(DoseEvent).filter_by(user_id=user_id).all()]

    now = datetime.now()
    history: List[Dict[str, Any]] = []

    for day_offset in range(days, 0, -1):
        day_date = (now - timedelta(days=day_offset)).date()
        taken = 0
        late = 0
        missed = 0
        total = 0

        for med in meds:
            window = med.get("time_window_minutes", 120)
            times = med.get("schedule", {}).get("times", [])
            for t in times:
                total += 1
                h, m = t.split(":")
                sdt = datetime.combine(day_date, datetime.min.time()).replace(hour=int(h), minute=int(m))
                ev = _match_event(dose_events, sdt, window, medication_id=med["medication_id"])
                if ev:
                    if ev["_diff_minutes"] <= window:
                        taken += 1
                    else:
                        late += 1
                else:
                    missed += 1

        history.append({
            "date": day_date.isoformat(),
            "total": total,
            "taken": taken,
            "late": late,
            "missed": missed,
            "adherence_pct": round(taken / total * 100) if total > 0 else 100,
        })

    return history


def generate_mock_events(user_id: str, days: int = 7, seed: int = 123) -> Dict[str, Any]:
    """Generate realistic mock pill-box events for testing.

    Unlike the full simulator in main.py this is a lightweight helper
    intended for quick chatbot demo without wiping existing events.
    """
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            return {"error": "User not found"}

        meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]
        if not meds:
            return {"error": "No medications found", "events_created": 0}

        rng = random.Random(seed)
        created = 0
        now = datetime.now()

        for med in meds:
            times = med.get("schedule", {}).get("times", [])
            for day_offset in range(days, 0, -1):
                day_date = (now - timedelta(days=day_offset)).date()
                for t in times:
                    h, m = t.split(":")
                    sdt = datetime.combine(day_date, datetime.min.time()).replace(hour=int(h), minute=int(m))

                    roll = rng.random()
                    if roll < 0.12:
                        continue  # missed
                    if roll < 0.25:
                        ev_dt = sdt + timedelta(minutes=rng.randint(125, 180))  # late
                    else:
                        ev_dt = sdt + timedelta(minutes=rng.randint(0, 25))  # on time

                    from uuid import uuid4
                    db.add(DoseEvent(
                        event_id=str(uuid4()),
                        user_id=user_id,
                        medication_id=med["medication_id"],
                        event_type="pillbox_open",
                        source="mock_tracker",
                        timestamp=ev_dt.isoformat(timespec="seconds"),
                        created_at=now.isoformat(timespec="seconds"),
                    ))
                    created += 1

        db.commit()

    return {"events_created": created, "days": days, "medications": len(meds)}
