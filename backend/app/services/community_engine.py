"""Community event recommendation and user action service."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import RUNTIME_DB, SessionLocal
from app.models import Medication, User
from app.services.appointment_engine import get_upcoming_appointments
from app.services.drift_engine import detect_adherence_drift
from app.services.event_provider import load_local_events


_DIABETES_HINTS = {"diabetes", "insulin", "metformin", "humulin"}
_HYPERTENSION_HINTS = {"hypertension", "amlodipine", "valsartan", "hydrochlorothiazide", "losartan", "lisinopril"}
_MOBILITY_HINTS = {"mobility", "balance", "joint", "falls"}


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_user_exists(user_id: str) -> User:
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _infer_conditions(user_id: str) -> List[str]:
    with SessionLocal() as db:
        meds = [m.name.lower() for m in db.query(Medication).filter_by(user_id=user_id).all()]

    conditions: List[str] = []
    if any(any(h in med for h in _DIABETES_HINTS) for med in meds):
        conditions.append("diabetes")
    if any(any(h in med for h in _HYPERTENSION_HINTS) for med in meds):
        conditions.append("hypertension")
    if any(any(h in med for h in _MOBILITY_HINTS) for med in meds):
        conditions.append("mobility_issues")
    return conditions


def _event_reason_and_score(
    event: Dict[str, Any],
    conditions: List[str],
    drift_severity: str,
    days_to_appointment: int | None,
) -> Tuple[int, str]:
    tags = set(str(x).lower() for x in event.get("health_tags", []))
    intensity = str(event.get("intensity", "low")).lower()
    event_type = str(event.get("type", "")).lower()

    score = 0
    reasons: List[str] = []

    if event.get("age_friendly"):
        score += 1

    if "hypertension" in conditions and ({"hypertension", "cardio"} & tags):
        score += 3
        reasons.append("light exercise supports blood pressure control")

    if "diabetes" in conditions and ({"diabetes", "nutrition", "adherence"} & tags):
        score += 3
        reasons.append("supports healthier routines for diabetes management")

    if "mobility_issues" in conditions and ({"mobility", "balance"} & tags):
        score += 3
        reasons.append("focuses on mobility and balance in a senior-friendly way")

    # Social support priority (especially for sustained adherence risk)
    if drift_severity in {"orange", "red"} and (event_type == "social" or "social" in tags):
        score += 2
        reasons.append("social engagement may improve motivation and consistency")

    if drift_severity in {"orange", "red"} and intensity == "low":
        score += 2
        reasons.append("low-intensity format is suitable while rebuilding routine")
    elif drift_severity == "yellow" and event_type in {"exercise", "wellness"}:
        score += 1

    if days_to_appointment is not None and days_to_appointment <= 3 and intensity == "low":
        score += 1
        reasons.append("near-term appointment makes gentle activities more practical")

    if not reasons:
        reasons.append("supports healthy ageing and community connection")

    return score, f"Recommended because {reasons[0]}."


def _recommended_event_payload(event: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return {
        "event_id": event["event_id"],
        "title": event["title"],
        "location": event["location"],
        "datetime": event["datetime"],
        "reason": reason,
        "type": event["type"],
        "description": event["description"],
        "organiser": event["organiser"],
    }


def _user_events_state(user_id: str) -> Dict[str, List[str]]:
    store = RUNTIME_DB.setdefault("user_events", {})
    state = store.setdefault(user_id, {"saved": [], "joined": []})
    state.setdefault("saved", [])
    state.setdefault("joined", [])
    return state


def _events_by_id() -> Dict[str, Dict[str, Any]]:
    return {event["event_id"]: event for event in load_local_events()}


def recommend_community_events(user_id: str) -> Dict[str, Any]:
    """Recommend top 5 community events by relevance and date."""
    _ensure_user_exists(user_id)

    conditions = _infer_conditions(user_id)
    drift = detect_adherence_drift(user_id)
    drift_severity = drift.get("severity", "green")

    appt = get_upcoming_appointments(user_id)
    days_to_appointment = appt.get("days_remaining")

    now_utc = _now_utc()
    scored: List[Tuple[int, datetime, Dict[str, Any]]] = []

    for event in load_local_events():
        event_dt = _as_utc(datetime.fromisoformat(event["datetime"]))
        if event_dt < now_utc:
            continue

        score, reason = _event_reason_and_score(
            event=event,
            conditions=conditions,
            drift_severity=drift_severity,
            days_to_appointment=days_to_appointment,
        )
        scored.append((score, event_dt, _recommended_event_payload(event, reason)))

    scored.sort(key=lambda x: (-x[0], x[1]))
    top_events = [item[2] for item in scored[:5]]

    return {"events": top_events}


def list_community_events(user_id: str) -> Dict[str, Any]:
    """Return all upcoming community events with recommendation metadata."""
    _ensure_user_exists(user_id)

    conditions = _infer_conditions(user_id)
    drift = detect_adherence_drift(user_id)
    drift_severity = drift.get("severity", "green")

    appt = get_upcoming_appointments(user_id)
    days_to_appointment = appt.get("days_remaining")

    now_utc = _now_utc()
    scored: List[Tuple[int, datetime, Dict[str, Any], str]] = []

    for event in load_local_events():
        event_dt = _as_utc(datetime.fromisoformat(event["datetime"]))
        if event_dt < now_utc:
            continue

        score, reason = _event_reason_and_score(
            event=event,
            conditions=conditions,
            drift_severity=drift_severity,
            days_to_appointment=days_to_appointment,
        )
        scored.append((score, event_dt, event, reason))

    scored.sort(key=lambda x: (-x[0], x[1]))
    recommended_ids = {item[2]["event_id"] for item in scored[:5]}

    events: List[Dict[str, Any]] = []
    for _score, _event_dt, event, reason in scored:
        is_recommended = event["event_id"] in recommended_ids
        events.append(
            {
                "event_id": event["event_id"],
                "title": event["title"],
                "location": event["location"],
                "datetime": event["datetime"],
                "type": event["type"],
                "description": event["description"],
                "organiser": event["organiser"],
                "is_recommended": is_recommended,
                "reason": reason if is_recommended else None,
            }
        )

    return {"events": events}


def join_community_event(user_id: str, event_id: str) -> Dict[str, Any]:
    """Join an event for a user in runtime state."""
    _ensure_user_exists(user_id)
    event = _events_by_id().get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    state = _user_events_state(user_id)
    if event_id not in state["joined"]:
        state["joined"].append(event_id)

    return {
        "status": "joined",
        "event_id": event_id,
        "joined": state["joined"],
    }


def cancel_community_event(user_id: str, event_id: str) -> Dict[str, Any]:
    """Cancel a previously joined event for a user."""
    _ensure_user_exists(user_id)
    state = _user_events_state(user_id)

    state["joined"] = [eid for eid in state["joined"] if eid != event_id]

    return {
        "status": "cancelled",
        "event_id": event_id,
        "joined": state["joined"],
    }


def save_community_event(user_id: str, event_id: str) -> Dict[str, Any]:
    """Save an event for later in runtime state."""
    _ensure_user_exists(user_id)
    event = _events_by_id().get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    state = _user_events_state(user_id)
    if event_id not in state["saved"]:
        state["saved"].append(event_id)

    return {
        "status": "saved",
        "event_id": event_id,
        "saved": state["saved"],
    }


def get_user_community_events(user_id: str) -> Dict[str, Any]:
    """Fetch joined/saved events for a user from runtime state."""
    _ensure_user_exists(user_id)
    state = _user_events_state(user_id)
    events_map = _events_by_id()

    def _resolve(ids: List[str]) -> List[Dict[str, Any]]:
        resolved: List[Dict[str, Any]] = []
        for event_id in ids:
            event = events_map.get(event_id)
            if not event:
                continue
            resolved.append(
                {
                    "event_id": event["event_id"],
                    "title": event["title"],
                    "location": event["location"],
                    "datetime": event["datetime"],
                    "type": event["type"],
                    "description": event["description"],
                    "organiser": event["organiser"],
                }
            )
        resolved.sort(key=lambda x: datetime.fromisoformat(x["datetime"]))
        return resolved

    return {
        "joined": _resolve(state["joined"]),
        "saved": _resolve(state["saved"]),
    }
