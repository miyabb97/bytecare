"""Adaptive nutrition recommendation service.

Core rule logic is deterministic and sourced from backend datasets.
LLM usage is limited to patient-facing explanation only.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any, Dict, List, Sequence, Set, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import DoseEvent, Medication, User
from app.services.nutrition_explainer import generate_nutrition_explanation
from app.services.nutrition_provider import load_food_profiles, load_med_food_interactions


DIABETES_HINTS = {"diabetes", "insulin", "metformin", "humulin"}
HYPERTENSION_HINTS = {
    "hypertension",
    "amlodipine",
    "valsartan",
    "hydrochlorothiazide",
    "losartan",
    "lisinopril",
}

TAKEN_EVENT_TYPES = {"tap_confirm", "pillbox_open", "voice_confirm"}

CONDITION_RULES: Dict[str, Dict[str, Any]] = {
    "diabetes": {
        "prefer_tags": {"low_sugar", "high_fiber", "low_glycemic"},
        "avoid_foods": ["sugary drinks", "bubble tea", "sweet desserts"],
        "reasoning": "diabetes profile favors lower sugar and steadier carbohydrate choices",
    },
    "hypertension": {
        "prefer_tags": {"low_sodium", "potassium_friendly"},
        "avoid_foods": ["high sodium soups", "processed meats", "extra gravy"],
        "reasoning": "hypertension profile favors lower sodium meals",
    },
}

LOCAL_RECOMMENDATION_CATALOG: List[Dict[str, Any]] = [
    {
        "text": "Steamed fish with brown rice and extra leafy vegetables",
        "tags": {"low_sodium", "low_sugar", "high_fiber", "low_glycemic"},
    },
    {
        "text": "Yong tau foo soup with more vegetables and less sauce",
        "tags": {"low_sodium", "high_fiber", "low_glycemic"},
    },
    {
        "text": "Thunder tea rice with reduced rice and more greens",
        "tags": {"low_sodium", "high_fiber", "low_glycemic"},
    },
    {
        "text": "Sliced fish soup and ask for less salt",
        "tags": {"low_sodium", "lean_protein"},
    },
    {
        "text": "Economy rice with two vegetable dishes and tofu",
        "tags": {"high_fiber", "low_glycemic", "low_sodium"},
    },
    {
        "text": "Chapati with dhal and mixed vegetables",
        "tags": {"high_fiber", "low_glycemic"},
    },
    {
        "text": "Unsweetened kopi O kosong or plain water instead of sweet drinks",
        "tags": {"low_sugar"},
    },
    {
        "text": "Fruit in small portions instead of fruit juice",
        "tags": {"low_sugar", "high_fiber"},
    },
]


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def _stable_hash_int(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest(), 16)


def _local_timezone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Singapore")


def _local_day_key(timezone_name: str) -> str:
    tz = _local_timezone(timezone_name)
    return datetime.now(tz).strftime("%Y-%m-%d")


def _parse_event_datetime(raw_ts: str, timezone_name: str) -> datetime | None:
    text = str(raw_ts or "").strip()
    if not text:
        return None

    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None

    tz = _local_timezone(timezone_name)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _normalize_conditions(raw_conditions: Sequence[str], inferred_conditions: Sequence[str]) -> List[str]:
    normalized: set[str] = set()

    for value in raw_conditions:
        text = str(value).strip().lower()
        if not text:
            continue
        if "diab" in text:
            normalized.add("diabetes")
        if "hyperten" in text or "blood pressure" in text:
            normalized.add("hypertension")

    for value in inferred_conditions:
        if value in {"diabetes", "hypertension"}:
            normalized.add(value)

    return sorted(normalized)


def _infer_conditions_from_medications(medication_names: Sequence[str]) -> List[str]:
    meds = [_normalize_text(name) for name in medication_names]
    inferred: List[str] = []

    if any(any(hint in med for hint in DIABETES_HINTS) for med in meds):
        inferred.append("diabetes")

    if any(any(hint in med for hint in HYPERTENSION_HINTS) for med in meds):
        inferred.append("hypertension")

    return inferred


def _is_taken_event(event: DoseEvent) -> bool:
    if event.response_status == "taken":
        return True
    return event.event_type in TAKEN_EVENT_TYPES


def _interaction_entries(interactions: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for med_key, payload in interactions.items():
        if not isinstance(payload, dict):
            continue

        avoid = [str(item).strip() for item in payload.get("avoid", []) if str(item).strip()]
        reason = str(payload.get("reason", "")).strip()
        aliases_raw = payload.get("aliases", [])
        aliases = [str(item).strip() for item in aliases_raw if str(item).strip()]
        aliases.append(str(med_key).strip())

        if str(med_key).endswith("s"):
            aliases.append(str(med_key)[:-1])

        deduped_aliases = sorted({_normalize_text(alias) for alias in aliases if _normalize_text(alias)})
        if not avoid:
            continue

        entries.append(
            {
                "medication_key": str(med_key),
                "aliases": deduped_aliases,
                "avoid": avoid,
                "reason": reason,
            }
        )
    return entries


def _match_medication_to_interactions(
    medications_taken_today: Sequence[str], interactions: Dict[str, Any]
) -> List[Dict[str, Any]]:
    entries = _interaction_entries(interactions)
    matches: List[Dict[str, Any]] = []

    for medication_name in medications_taken_today:
        med_norm = _normalize_text(medication_name)
        if not med_norm:
            continue

        for entry in entries:
            if any(alias and alias in med_norm for alias in entry["aliases"]):
                matches.append(
                    {
                        "medication_name": medication_name,
                        "medication_key": entry["medication_key"],
                        "avoid": list(entry["avoid"]),
                        "reason": entry["reason"],
                    }
                )

    deduped: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str]] = set()
    for match in matches:
        key = (_normalize_text(match["medication_name"]), _normalize_text(match["medication_key"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(match)

    return deduped


def _food_profile_tags(food_name: str, food_profiles: Dict[str, Any]) -> Tuple[Set[str], List[str]]:
    query_norm = _normalize_text(food_name)
    if not query_norm:
        return set(), []

    tags: Set[str] = set()
    matched_profiles: List[str] = []

    for profile_food, payload in food_profiles.items():
        candidates = [str(profile_food)]
        if isinstance(payload, dict):
            candidates.extend(str(item) for item in payload.get("aliases", []) if str(item).strip())

        is_match = False
        for candidate in candidates:
            candidate_norm = _normalize_text(candidate)
            if not candidate_norm:
                continue
            if candidate_norm in query_norm:
                is_match = True
                break
            if len(query_norm) >= 5 and query_norm in candidate_norm:
                is_match = True
                break

        if not is_match:
            continue

        profile_tags = payload.get("tags", []) if isinstance(payload, dict) else []
        tags.update(_normalize_text(tag).replace(" ", "_") for tag in profile_tags)
        matched_profiles.append(str(profile_food))

    return tags, matched_profiles


def _collect_avoid_food_tags(avoid_foods: Sequence[str], food_profiles: Dict[str, Any]) -> Set[str]:
    collected: Set[str] = set()
    for food in avoid_foods:
        tags, _ = _food_profile_tags(food, food_profiles)
        collected.update(tags)
    return collected


def _build_checked_foods(food_query: str | None, candidate_foods: Sequence[str] | None) -> List[str]:
    checked_foods: List[str] = []
    seen: Set[str] = set()

    for value in [food_query, *(candidate_foods or [])]:
        item = str(value or "").strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        checked_foods.append(item)

    return checked_foods


def _inspect_foods_against_avoid_list(
    checked_foods: Sequence[str],
    avoid_foods: Sequence[str],
    food_profiles: Dict[str, Any],
) -> Tuple[bool, str, List[str], List[str]]:
    avoid_tags = _collect_avoid_food_tags(avoid_foods, food_profiles)
    reasoning: List[str] = []
    conflict_detected = False
    first_conflict_input = ""
    conflict_avoid_hits: List[str] = []

    for query in checked_foods:
        query_norm = _normalize_text(query)
        if not query_norm:
            continue
        query_tags, matched_profiles = _food_profile_tags(query, food_profiles)

        direct_conflicts: List[str] = []
        for avoid in avoid_foods:
            avoid_norm = _normalize_text(avoid)
            if not avoid_norm:
                continue
            if avoid_norm in query_norm or query_norm in avoid_norm:
                direct_conflicts.append(avoid)

        tag_conflict = bool(query_tags & avoid_tags)
        has_conflict = bool(direct_conflicts or tag_conflict)

        if matched_profiles:
            reasoning.append(f"{query} matched food profiles: {', '.join(matched_profiles[:3])}")

        if direct_conflicts:
            reasoning.append(f"{query} matched avoid list: {', '.join(sorted(set(direct_conflicts))[:3])}")
            conflict_avoid_hits.extend(direct_conflicts)
        elif tag_conflict:
            overlap = sorted(query_tags & avoid_tags)
            reasoning.append(f"{query} shares risk tags with avoid list: {', '.join(overlap[:3])}")

        if has_conflict and not conflict_detected:
            conflict_detected = True
            first_conflict_input = query

    return conflict_detected, first_conflict_input, conflict_avoid_hits, reasoning


def _evaluate_food_query(
    food_query: str | None,
    candidate_foods: Sequence[str] | None,
    interaction_matches: Sequence[Dict[str, Any]],
    food_profiles: Dict[str, Any],
) -> Tuple[bool, str, List[str]]:
    checked_foods = _build_checked_foods(food_query, candidate_foods)
    if not checked_foods:
        return False, "", []

    avoid_foods: List[str] = []
    for match in interaction_matches:
        avoid_foods.extend(match.get("avoid", []))
    conflict_detected, first_conflict_input, conflict_avoid_hits, reasoning = _inspect_foods_against_avoid_list(
        checked_foods,
        avoid_foods,
        food_profiles,
    )

    if not conflict_detected:
        checked_text = ", ".join(checked_foods[:2])
        return (
            False,
            f"No direct medication-food conflict detected for \"{checked_text}\" from the current interaction rule set.",
            reasoning,
        )

    primary = interaction_matches[0] if interaction_matches else {}
    medication_name = str(primary.get("medication_name", "your medication")).strip()
    reason = str(primary.get("reason", "Possible medication-food interaction risk.")).strip()

    unique_hits = sorted({item for item in conflict_avoid_hits if item})
    if unique_hits:
        avoid_text = ", ".join(unique_hits[:2])
    else:
        avoid_text = ", ".join((primary.get("avoid") or [])[:2]) or first_conflict_input

    warning_message = (
        f"Because you took {medication_name} today, avoid {avoid_text}. {reason}."
    )

    return True, warning_message, reasoning


def _evaluate_condition_food_query(
    food_query: str | None,
    candidate_foods: Sequence[str] | None,
    conditions: Sequence[str],
    condition_avoid_foods: Sequence[str],
    food_profiles: Dict[str, Any],
) -> Tuple[bool, str, List[str]]:
    checked_foods = _build_checked_foods(food_query, candidate_foods)
    if not checked_foods or not condition_avoid_foods:
        return False, "", []

    conflict_detected, first_conflict_input, _hits, reasoning = _inspect_foods_against_avoid_list(
        checked_foods,
        condition_avoid_foods,
        food_profiles,
    )
    if not conflict_detected:
        return False, "", reasoning

    condition_set = set(conditions)
    if "hypertension" in condition_set:
        message = (
            f"{first_conflict_input} can be quite high in sodium or rich, so it may not be the best choice today if you are managing blood pressure."
        )
    elif "diabetes" in condition_set:
        message = (
            f"{first_conflict_input} may be high in sugar or fast-absorbing carbs, so it may not be the best choice today if you are managing blood sugar."
        )
    else:
        message = (
            f"{first_conflict_input} may not be the best choice today based on your current nutrition plan."
        )

    return True, message, reasoning


def _condition_preferences(conditions: Sequence[str]) -> Tuple[Set[str], List[str], List[str]]:
    prefer_tags: Set[str] = set()
    avoid_foods: List[str] = []
    reasoning: List[str] = []

    for condition in conditions:
        rule = CONDITION_RULES.get(condition)
        if not rule:
            continue
        prefer_tags.update(rule.get("prefer_tags", set()))
        avoid_foods.extend([str(item).strip() for item in rule.get("avoid_foods", []) if str(item).strip()])
        detail = str(rule.get("reasoning", "")).strip()
        if detail:
            reasoning.append(detail)

    return prefer_tags, avoid_foods, reasoning


def _select_recommended_foods(
    *,
    user_id: str,
    day_key: str,
    prefer_tags: Set[str],
    avoid_foods: Sequence[str],
    food_profiles: Dict[str, Any],
) -> List[str]:
    avoid_norms = {_normalize_text(item) for item in avoid_foods if _normalize_text(item)}
    avoid_tags = _collect_avoid_food_tags(avoid_foods, food_profiles)

    candidates: List[Tuple[int, int, str]] = []
    for item in LOCAL_RECOMMENDATION_CATALOG:
        text = str(item.get("text", "")).strip()
        if not text:
            continue

        text_norm = _normalize_text(text)
        if any(avoid and avoid in text_norm for avoid in avoid_norms):
            continue

        tags = {_normalize_text(tag).replace(" ", "_") for tag in item.get("tags", set())}
        if avoid_tags and tags & avoid_tags:
            continue

        overlap_score = len(tags & prefer_tags) if prefer_tags else len(tags & {"low_sugar", "low_sodium"})
        stable_rank = _stable_hash_int(f"{user_id}:{day_key}:{text}")
        candidates.append((overlap_score, stable_rank, text))

    candidates.sort(key=lambda x: (-x[0], x[1]))

    selected: List[str] = []
    for _, _, text in candidates:
        if text not in selected:
            selected.append(text)
        if len(selected) >= 5:
            break

    if len(selected) < 3:
        fallback = ["Steamed fish", "Vegetable soup", "Brown rice"]
        for item in fallback:
            if item not in selected:
                selected.append(item)
            if len(selected) >= 3:
                break

    return selected


def get_adaptive_nutrition_recommendation(
    user_id: str,
    food_query: str | None = None,
    candidate_foods: Sequence[str] | None = None,
) -> Dict[str, Any]:
    """Return deterministic, context-aware nutrition recommendation for today."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        medications = db.query(Medication).filter_by(user_id=user_id).all()
        dose_events = db.query(DoseEvent).filter_by(user_id=user_id).all()

    timezone_name = user.timezone or "Asia/Singapore"
    local_tz = _local_timezone(timezone_name)
    local_today = datetime.now(local_tz).date()

    medication_by_id = {med.medication_id: med.name for med in medications}

    taken_medications_today: List[str] = []
    seen_taken: Set[str] = set()
    for event in dose_events:
        if not _is_taken_event(event):
            continue
        event_dt = _parse_event_datetime(event.timestamp, timezone_name)
        if not event_dt or event_dt.date() != local_today:
            continue

        medication_name = medication_by_id.get(event.medication_id)
        if not medication_name:
            continue

        key = _normalize_text(medication_name)
        if key in seen_taken:
            continue
        seen_taken.add(key)
        taken_medications_today.append(medication_name)

    all_medication_names = [med.name for med in medications]
    inferred_conditions = _infer_conditions_from_medications(all_medication_names)
    raw_conditions = [str(item) for item in (user.conditions or [])]
    conditions = _normalize_conditions(raw_conditions, inferred_conditions)

    med_food_interactions = load_med_food_interactions()
    food_profiles = load_food_profiles()

    interaction_matches = _match_medication_to_interactions(
        medications_taken_today=taken_medications_today,
        interactions=med_food_interactions,
    )

    interaction_avoid_foods: List[str] = []
    for match in interaction_matches:
        interaction_avoid_foods.extend(match.get("avoid", []))

    prefer_tags, condition_avoid_foods, condition_reasoning = _condition_preferences(conditions)

    combined_avoid_foods: List[str] = []
    for item in interaction_avoid_foods + condition_avoid_foods:
        value = str(item).strip()
        if value and value.lower() not in {x.lower() for x in combined_avoid_foods}:
            combined_avoid_foods.append(value)

    med_interaction_warning, med_warning_message, food_query_reasoning = _evaluate_food_query(
        food_query=food_query,
        candidate_foods=candidate_foods,
        interaction_matches=interaction_matches,
        food_profiles=food_profiles,
    )
    condition_warning, condition_warning_message, condition_query_reasoning = _evaluate_condition_food_query(
        food_query=food_query,
        candidate_foods=candidate_foods,
        conditions=conditions,
        condition_avoid_foods=condition_avoid_foods,
        food_profiles=food_profiles,
    )

    checked_foods = _build_checked_foods(food_query, candidate_foods)
    interaction_warning = med_interaction_warning or condition_warning
    warning_message = (
        med_warning_message
        if med_interaction_warning
        else condition_warning_message
        if condition_warning
        else med_warning_message if checked_foods else ""
    )

    recommendation_level = "recommended"
    if med_interaction_warning:
        recommendation_level = "avoid"
    elif condition_warning:
        recommendation_level = "caution"
    elif checked_foods:
        recommendation_level = "generally_ok"

    day_key = _local_day_key(timezone_name)
    recommended_foods = _select_recommended_foods(
        user_id=user_id,
        day_key=day_key,
        prefer_tags=prefer_tags,
        avoid_foods=combined_avoid_foods,
        food_profiles=food_profiles,
    )

    reasoning: List[str] = []
    if taken_medications_today:
        for med_name in taken_medications_today:
            reasoning.append(f"{med_name} detected in today's dose events")
    else:
        reasoning.append("No taken medication event detected for today")

    for match in interaction_matches:
        reason = str(match.get("reason", "")).strip()
        med_name = str(match.get("medication_name", "medication")).strip()
        if reason:
            reasoning.append(f"{med_name} interaction rule applied: {reason}")

    reasoning.extend(condition_reasoning)
    reasoning.extend(food_query_reasoning)
    reasoning.extend(condition_query_reasoning)

    condition_label = "_and_".join(conditions) if conditions else "general_wellness"

    result: Dict[str, Any] = {
        "medications_taken_today": taken_medications_today,
        "food_query": food_query,
        "recommendation_level": recommendation_level,
        "interaction_warning": interaction_warning,
        "warning_message": warning_message,
        "recommended_foods": recommended_foods,
        "avoid_foods": combined_avoid_foods,
        "reasoning": reasoning,
        # Backward-compatible fields for existing frontend/contracts.
        "condition": condition_label,
        "recommendations": recommended_foods,
    }

    result["explanation"] = generate_nutrition_explanation(result)
    return result


def recommend_food(user_id: str) -> Dict[str, Any]:
    """Backward-compatible entrypoint used by existing endpoints."""
    return get_adaptive_nutrition_recommendation(user_id=user_id, food_query=None)


def get_adaptive_nutrition_from_scan(
    user_id: str,
    detected_food: str | None,
    ingredients: Sequence[str] | None,
) -> Dict[str, Any]:
    """Deterministic nutrition check using scan-derived food inputs."""
    return get_adaptive_nutrition_recommendation(
        user_id=user_id,
        food_query=detected_food,
        candidate_foods=ingredients,
    )
