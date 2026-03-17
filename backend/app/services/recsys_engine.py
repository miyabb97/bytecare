"""Hybrid event recommendation engine (content-based + collaborative filtering).

Architecture:
- Content-based (primary): cosine similarity between user health-tag vector
  and event health-tag vector, built from explicit conditions_json + medication inference.
- Collaborative (secondary): item-based Jaccard similarity from UserEvent join history.
  Gracefully degrades to 0 when interaction data is sparse.
- Drift boost: multiplicative amplifier based on adherence drift severity.
- Falls back to rule-based scorer in community_engine.py if this module raises.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from app.db import SessionLocal
from app.models import Medication, User, UserEvent
from app.services.drift_engine import detect_adherence_drift
from app.services.event_provider import load_local_events

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vocabulary maps
# ---------------------------------------------------------------------------

# Substring → health tags (lowercase keys, substring match against condition strings)
_CONDITION_TAG_MAP: Dict[str, List[str]] = {
    "diabetes": ["diabetes", "nutrition", "adherence", "cardio"],
    "hypertension": ["hypertension", "cardio", "stress", "wellness"],
    "depression": ["mental_wellbeing", "social", "stress", "wellness"],
    "anxiety": ["mental_wellbeing", "social", "stress", "wellness"],
    "mental": ["mental_wellbeing", "social", "stress", "wellness"],
    "atrial": ["cardio", "hypertension", "wellness"],
    "fibrillation": ["cardio", "hypertension", "wellness"],
    "heart": ["cardio", "hypertension", "wellness"],
    "mobility": ["mobility", "balance", "strength"],
    "fall": ["mobility", "balance", "strength"],
    "joint": ["mobility", "balance", "strength"],
    "kidney": ["wellness", "nutrition", "education"],
    "renal": ["wellness", "nutrition", "education"],
    "hyperlipidemia": ["cardio", "nutrition", "education"],
    "cholesterol": ["cardio", "nutrition", "education"],
    "cognitive": ["cognitive", "mental_wellbeing", "social"],
    "memory": ["cognitive", "mental_wellbeing", "social"],
    "dementia": ["cognitive", "mental_wellbeing", "social"],
    "social": ["social", "mental_wellbeing", "wellness"],
    "stress": ["stress", "mental_wellbeing", "wellness"],
}

# Event type → implied supplemental tags (weight 0.5)
_TYPE_TAG_MAP: Dict[str, List[str]] = {
    "exercise": ["cardio", "mobility"],
    "wellness": ["wellness", "stress"],
    "social": ["social", "mental_wellbeing"],
    "education": ["education"],
}

# Adherence drift severity → score multiplier
_DRIFT_BOOST: Dict[str, float] = {
    "green": 1.0,
    "yellow": 1.05,
    "orange": 1.12,
    "red": 1.20,
}

# Medication name hints for condition inference (fallback when conditions_json is empty)
_MED_TAG_HINTS: Dict[str, List[str]] = {
    "metformin": ["diabetes", "nutrition", "adherence", "cardio"],
    "insulin": ["diabetes", "nutrition", "adherence", "cardio"],
    "humulin": ["diabetes", "nutrition", "adherence", "cardio"],
    "amlodipine": ["hypertension", "cardio", "stress", "wellness"],
    "valsartan": ["hypertension", "cardio", "stress", "wellness"],
    "lisinopril": ["hypertension", "cardio", "stress", "wellness"],
    "losartan": ["hypertension", "cardio", "stress", "wellness"],
    "hydrochlorothiazide": ["hypertension", "cardio", "stress", "wellness"],
    "atenolol": ["cardio", "hypertension", "wellness"],
    "metoprolol": ["cardio", "hypertension", "wellness"],
    "warfarin": ["cardio", "education", "adherence"],
    "sertraline": ["mental_wellbeing", "social", "stress"],
    "lorazepam": ["mental_wellbeing", "social", "stress"],
    "escitalopram": ["mental_wellbeing", "social", "stress"],
    "diazepam": ["mental_wellbeing", "social", "stress"],
    "simvastatin": ["cardio", "nutrition", "education"],
    "atorvastatin": ["cardio", "nutrition", "education"],
}

# Human-readable condition display labels for reason generation
_CONDITION_DISPLAY: Dict[str, str] = {
    "diabetes": "diabetes management",
    "hypertension": "blood pressure control",
    "depression": "mental wellbeing",
    "anxiety": "stress and anxiety management",
    "mental": "mental wellbeing",
    "atrial": "heart health",
    "fibrillation": "heart health",
    "heart": "heart health",
    "mobility": "mobility and balance",
    "fall": "fall prevention",
    "joint": "joint health",
    "kidney": "kidney health",
    "renal": "kidney health",
    "hyperlipidemia": "cholesterol management",
    "cholesterol": "cholesterol management",
    "cognitive": "cognitive health",
    "memory": "memory and focus",
    "dementia": "cognitive health",
    "social": "social wellbeing",
}


# ---------------------------------------------------------------------------
# Vector construction
# ---------------------------------------------------------------------------

def _build_user_content_vector(user_id: str) -> Tuple[Dict[str, float], List[str]]:
    """Build a tag-weight vector from the user's health profile.

    Returns:
        (tag_vector, conditions_list) — conditions_list is reused by reason generator.
    """
    with SessionLocal() as db:
        user_obj = db.query(User).filter_by(user_id=user_id).first()
        if not user_obj:
            return {}, []
        conditions: List[str] = list(user_obj.conditions)  # parsed from conditions_json
        med_names = [m.name.lower() for m in db.query(Medication).filter_by(user_id=user_id).all()]

    vector: Dict[str, float] = {}

    def _add(tag: str, weight: float) -> None:
        vector[tag] = vector.get(tag, 0.0) + weight

    if conditions:
        for cond in conditions:
            cond_lower = cond.lower()
            for keyword, tags in _CONDITION_TAG_MAP.items():
                if keyword in cond_lower:
                    for tag in tags:
                        _add(tag, 1.0)
    else:
        # Fallback: infer from medication names at lower confidence
        for med in med_names:
            for hint, tags in _MED_TAG_HINTS.items():
                if hint in med:
                    for tag in tags:
                        _add(tag, 0.6)

    # Universal baseline for the senior population
    _add("wellness", 0.3)
    _add("social", 0.3)

    return vector, conditions


def _build_event_content_vector(event: Dict[str, Any]) -> Dict[str, float]:
    """Build a tag-weight vector from an event's metadata."""
    vector: Dict[str, float] = {}

    for tag in event.get("health_tags", []):
        vector[str(tag).lower()] = vector.get(str(tag).lower(), 0.0) + 1.0

    event_type = str(event.get("type", "")).lower()
    for implied_tag in _TYPE_TAG_MAP.get(event_type, []):
        if implied_tag in vector:
            vector[implied_tag] += 0.2  # corroboration bonus
        else:
            vector[implied_tag] = 0.5

    if str(event.get("intensity", "")).lower() == "low":
        vector["wellness"] = vector.get("wellness", 0.0) + 0.2
        vector["stress"] = vector.get("stress", 0.0) + 0.1

    return vector


# ---------------------------------------------------------------------------
# Similarity math (pure Python, no external libraries)
# ---------------------------------------------------------------------------

def _cosine_similarity(vec_a: Dict[str, float], vec_b: Dict[str, float]) -> float:
    """Cosine similarity between two sparse tag vectors."""
    dot = sum(vec_a[k] * vec_b[k] for k in vec_a if k in vec_b)
    mag_a = math.sqrt(sum(v * v for v in vec_a.values()))
    mag_b = math.sqrt(sum(v * v for v in vec_b.values()))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


def _content_score(user_vec: Dict[str, float], event_vec: Dict[str, float]) -> float:
    """Wrapper over cosine similarity; hook point for future penalty logic."""
    return _cosine_similarity(user_vec, event_vec)


# ---------------------------------------------------------------------------
# Collaborative filtering
# ---------------------------------------------------------------------------

def _load_all_interactions() -> Dict[str, List[str]]:
    """Load all joined UserEvent rows as {event_id: [user_id, ...]}."""
    with SessionLocal() as db:
        rows = db.query(UserEvent).filter_by(status="joined").all()
    interactions: Dict[str, List[str]] = {}
    for row in rows:
        interactions.setdefault(row.event_id, []).append(row.user_id)
    return interactions


def _jaccard_similarity(set_a: set, set_b: set) -> float:
    """Jaccard similarity between two sets."""
    union = set_a | set_b
    if not union:
        return 0.0
    return len(set_a & set_b) / len(union)


def _collab_score(
    user_id: str,
    event_id: str,
    all_interactions: Dict[str, List[str]],
) -> float:
    """Item-based collaborative filtering score using Jaccard similarity.

    Gracefully returns 0.0 when interaction data is sparse.
    """
    # Events this user has already joined
    user_joined = {eid for eid, uids in all_interactions.items() if user_id in uids}

    if not user_joined:
        return 0.0  # no history — cold start

    if event_id in user_joined:
        return 0.0  # already joined — don't boost further

    candidate_audience = set(all_interactions.get(event_id, []))
    if not candidate_audience:
        return 0.0  # no one has joined this event yet

    best = 0.0
    for joined_eid in user_joined:
        joined_audience = set(all_interactions.get(joined_eid, []))
        j = _jaccard_similarity(candidate_audience, joined_audience)
        if j > best:
            best = j
    return best


# ---------------------------------------------------------------------------
# Hybrid scoring
# ---------------------------------------------------------------------------

def _hybrid_score(content: float, collab: float, drift_severity: str) -> float:
    """Combine content and collaborative scores with a drift multiplier.

    Weight distribution:
    - content: 0.65 (0.90 when collab is zero — redistributed)
    - collab:  0.25 (0 when sparse)
    - drift:   multiplicative boost on top
    """
    if collab == 0.0:
        base = content * 0.90
    else:
        base = content * 0.65 + collab * 0.25

    multiplier = _DRIFT_BOOST.get(drift_severity, 1.0)
    return min(base * multiplier, 1.0)


# ---------------------------------------------------------------------------
# Reason generation
# ---------------------------------------------------------------------------

def _generate_reason(
    user_conditions: List[str],
    event: Dict[str, Any],
    content_score: float,
    collab_score: float,
) -> str:
    """Generate a human-readable reason for a recommendation."""
    event_tags = {str(t).lower() for t in event.get("health_tags", [])}

    # 1. Condition-tag match (highest priority)
    for cond in user_conditions:
        cond_lower = cond.lower()
        for keyword, tags in _CONDITION_TAG_MAP.items():
            if keyword in cond_lower:
                matching_tags = [t for t in tags if t in event_tags]
                if matching_tags:
                    display = _CONDITION_DISPLAY.get(keyword, keyword)
                    return f"Recommended because this activity supports {display}."

    # 2. Collaborative signal
    if collab_score > 0.3:
        return "Members with similar health interests have also joined this event."

    # 3. Strong content match without direct condition overlap
    if content_score > 0.5:
        return "This event aligns well with your overall health profile."

    # 4. Type-based fallback
    event_type = str(event.get("type", "")).lower()
    type_phrases = {
        "exercise": "light exercise supports healthy ageing",
        "wellness": "wellness activities support a balanced lifestyle",
        "social": "social engagement supports mental wellbeing",
        "education": "health education helps you stay informed and in control",
    }
    phrase = type_phrases.get(event_type, "this activity supports healthy ageing and community connection")
    return f"Recommended because {phrase}."


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def recommend_events(user_id: str, n: int = 5) -> List[Dict[str, Any]]:
    """Return the top-n recommended events for a user using the hybrid engine.

    Output shape per event matches community_engine._recommended_event_payload:
        {event_id, title, location, datetime, reason, type, description, organiser}
    """
    user_vec, user_conditions = _build_user_content_vector(user_id)

    try:
        drift = detect_adherence_drift(user_id)
        drift_severity = drift.get("severity", "green")
    except Exception:
        drift_severity = "green"

    all_interactions = _load_all_interactions()
    now_utc = datetime.now(timezone.utc)

    scored: List[Tuple[float, datetime, Dict[str, Any], float, float]] = []

    for event in load_local_events():
        event_dt = _as_utc(datetime.fromisoformat(event["datetime"]))
        if event_dt < now_utc:
            continue

        event_vec = _build_event_content_vector(event)
        cs = _content_score(user_vec, event_vec)
        cf = _collab_score(user_id, event["event_id"], all_interactions)
        final = _hybrid_score(cs, cf, drift_severity)
        scored.append((final, event_dt, event, cs, cf))

    scored.sort(key=lambda x: (-x[0], x[1]))

    results: List[Dict[str, Any]] = []
    for final_score, _event_dt, event, cs, cf in scored[:n]:
        reason = _generate_reason(user_conditions, event, cs, cf)
        results.append({
            "event_id": event["event_id"],
            "title": event["title"],
            "location": event["location"],
            "datetime": event["datetime"],
            "reason": reason,
            "type": event["type"],
            "description": event["description"],
            "organiser": event["organiser"],
        })

    return results
