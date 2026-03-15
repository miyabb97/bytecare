"""Nutrition recommendation service."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from app.db import RUNTIME_DB, SessionLocal
from app.models import Medication, User
from app.services.meralion_client import MeralionClient, MeralionClientError


DIABETES_HINTS = {"diabetes", "insulin", "metformin", "humulin"}
HYPERTENSION_HINTS = {"hypertension", "amlodipine", "valsartan", "hydrochlorothiazide", "losartan", "lisinopril"}


# Singapore-local anchors. These guide the model but do not hard-limit output.
SG_FOOD_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "yong_tau_foo_clear",
        "text": "Yong tau foo soup with more vegetables, avoid fried pieces and sweet sauce",
        "tags": {"diabetes", "hypertension", "general"},
    },
    {
        "id": "sliced_fish_soup",
        "text": "Sliced fish soup with extra greens and half portion of rice",
        "tags": {"diabetes", "hypertension", "general"},
    },
    {
        "id": "thunder_tea_rice",
        "text": "Thunder tea rice with extra vegetables and reduced rice",
        "tags": {"diabetes", "hypertension"},
    },
    {
        "id": "mixed_rice_2veg",
        "text": "Economy rice with 2 vegetable dishes and steamed tofu or fish",
        "tags": {"diabetes", "hypertension", "general"},
    },
    {
        "id": "ban_mian_soup",
        "text": "Ban mian soup with more leafy vegetables, less soup finishing",
        "tags": {"hypertension", "general"},
    },
    {
        "id": "chicken_rice_mod",
        "text": "Chicken rice with skin removed, less rice and extra cucumber",
        "tags": {"diabetes", "hypertension", "general"},
    },
    {
        "id": "nasi_padang_grilled",
        "text": "Nasi padang with grilled fish, say less gravy and add vegetables",
        "tags": {"diabetes", "hypertension"},
    },
    {
        "id": "bee_hoon_soup",
        "text": "Fish bee hoon soup with evaporated milk reduced where possible",
        "tags": {"diabetes", "hypertension"},
    },
    {
        "id": "teh_kosong",
        "text": "Choose kopi O kosong, teh kosong, or water instead of sweet drinks",
        "tags": {"diabetes", "general"},
    },
    {
        "id": "fruit_portion",
        "text": "Pick whole fruit in small portions instead of fruit juice",
        "tags": {"diabetes", "general"},
    },
]


CONDITION_FALLBACK_POOL: Dict[str, List[str]] = {
    "diabetes": [
        "Choose lower-glycemic carbs like brown rice, wholegrain noodles, or smaller rice portions",
        "Reduce sugary drinks and bubble tea; choose less sweet or unsweetened options",
        "Pair carbs with protein and vegetables to reduce blood sugar spikes",
    ],
    "hypertension": [
        "Ask for less salt, less gravy, and no added sauces when ordering",
        "Choose steamed, soup, or grilled items more often than fried foods",
        "Limit processed meats and high-sodium sides like fish cake or luncheon meat",
    ],
}

GENERAL_FALLBACK_POOL = [
    "Use the quarter-quarter-half plate method when choosing hawker meals",
    "Add one extra vegetable item to your meal most days",
    "Drink water regularly through the day, especially with meals",
]


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


def _infer_conditions_from_medications(user_id: str) -> List[str]:
    with SessionLocal() as db:
        meds = [m.name.lower() for m in db.query(Medication).filter_by(user_id=user_id).all()]
    inferred: List[str] = []

    if any(any(hint in med for hint in DIABETES_HINTS) for med in meds):
        inferred.append("diabetes")

    if any(any(hint in med for hint in HYPERTENSION_HINTS) for med in meds):
        inferred.append("hypertension")

    return inferred


def _local_day_key(timezone_name: str) -> str:
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("Asia/Singapore")
    return datetime.now(tz).strftime("%Y-%m-%d")


def _stable_hash_int(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest(), 16)


def _choose_local_anchors(conditions: Sequence[str], user_id: str, day_key: str, count: int = 3) -> List[str]:
    condition_set = set(conditions)
    if condition_set:
        primary = [item for item in SG_FOOD_CATALOG if item["tags"] & condition_set]
        backup = [item for item in SG_FOOD_CATALOG if "general" in item["tags"]]
        candidates = primary + [item for item in backup if item["id"] not in {p["id"] for p in primary}]
    else:
        candidates = list(SG_FOOD_CATALOG)

    ranked = sorted(
        candidates,
        key=lambda item: _stable_hash_int(f"{user_id}:{day_key}:{item['id']}"),
    )
    return [item["text"] for item in ranked[:count]]


def _build_meralion_prompt(
    *,
    user_name: str,
    user_age: int,
    conditions: Sequence[str],
    day_key: str,
    anchors: Sequence[str],
) -> str:
    condition_text = ", ".join(conditions) if conditions else "general wellness"
    anchor_text = "\n".join(f"- {item}" for item in anchors) if anchors else "- None"

    return (
        "You are ByteCare's Singapore diet assistant for seniors.\n"
        "Task: create concise, practical daily diet suggestions for a patient.\n\n"
        "Patient context:\n"
        f"- name: {user_name}\n"
        f"- age: {user_age}\n"
        f"- conditions: {condition_text}\n"
        f"- daily_key: {day_key}\n\n"
        "Local Singapore anchor examples (guide only, do not limit to these):\n"
        f"{anchor_text}\n\n"
        "Rules:\n"
        "1) Return strict JSON only, no markdown.\n"
        '2) Output schema: {"recommendations": ["...", "...", "...", "...", "..."]}\n'
        "3) Provide 4-5 recommendations.\n"
        "4) Include at least 2 Singapore-local hawker/food court suggestions.\n"
        "5) Include at least 1 behavior-change suggestion that starts with 'Reduce' or 'Avoid'.\n"
        "6) Keep each suggestion to one short sentence, <= 18 words.\n"
        "7) Safe boundaries: no diagnosis, no medication changes, no cure claims.\n"
        "8) Vary choices day-to-day using daily_key.\n"
        "9) You may propose suitable options outside the anchor list.\n"
    )


def _extract_json_blob(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidate = text[start : end + 1]
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("Invalid JSON response")


def _normalize_recommendations(payload: Dict[str, Any]) -> List[str]:
    raw = payload.get("recommendations")
    if not isinstance(raw, list):
        raise ValueError("Missing recommendations list")

    cleaned: List[str] = []
    seen: set[str] = set()
    for item in raw:
        value = ""
        if isinstance(item, str):
            value = item.strip()
        elif isinstance(item, dict):
            for key in ("text", "recommendation", "item"):
                maybe = item.get(key)
                if isinstance(maybe, str) and maybe.strip():
                    value = maybe.strip()
                    break
        if not value:
            continue
        compact = " ".join(value.split())
        key = compact.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(compact)

    if len(cleaned) < 3:
        raise ValueError("Too few recommendations")

    return cleaned[:5]


def _fallback_recommendations(
    *,
    conditions: Sequence[str],
    anchors: Sequence[str],
    user_id: str,
    day_key: str,
) -> List[str]:
    pool: List[str] = list(anchors)

    for condition in conditions:
        pool.extend(CONDITION_FALLBACK_POOL.get(condition, []))
    pool.extend(GENERAL_FALLBACK_POOL)

    # Deterministic daily rotation so list changes by day, not by refresh.
    ranked = sorted(
        pool,
        key=lambda item: _stable_hash_int(f"{user_id}:{day_key}:{item}"),
    )

    selected: List[str] = []
    selected_lower: set[str] = set()
    for item in ranked:
        lowered = item.lower()
        if lowered in selected_lower:
            continue
        selected.append(item)
        selected_lower.add(lowered)
        if len(selected) >= 5:
            break

    has_change_prompt = any(x.lower().startswith(("reduce", "avoid")) for x in selected)
    if not has_change_prompt:
        selected.append("Reduce sugary drinks and sweet desserts; choose water or unsweetened drinks")

    return selected[:5]


def _daily_nutrition_cache() -> Dict[str, Dict[str, Any]]:
    return RUNTIME_DB.setdefault("nutrition_daily", {})


def recommend_food(user_id: str) -> Dict[str, Any]:
    """Recommend food options with SG-local context and daily variation."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    inferred = _infer_conditions_from_medications(user_id)
    raw_conditions = [str(item) for item in (user.conditions or [])]
    conditions = _normalize_conditions(raw_conditions, inferred)
    condition_label = "_and_".join(conditions) if conditions else "general_wellness"

    timezone_name = user.timezone or "Asia/Singapore"
    day_key = _local_day_key(timezone_name)
    cache_key = f"{user_id}:{day_key}:{condition_label}"

    cache = _daily_nutrition_cache()
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    anchors = _choose_local_anchors(conditions, user_id=user_id, day_key=day_key, count=3)
    recommendations: List[str] = []

    client = MeralionClient()
    if client.enabled:
        prompt = _build_meralion_prompt(
            user_name=user.name,
            user_age=user.age,
            conditions=conditions,
            day_key=day_key,
            anchors=anchors,
        )
        try:
            raw = client.chat(prompt, hyperparameters={"temperature": 0.45, "topP": 0.92})
            parsed = _extract_json_blob(raw)
            recommendations = _normalize_recommendations(parsed)
        except (MeralionClientError, ValueError, json.JSONDecodeError):
            recommendations = []

    if not recommendations:
        recommendations = _fallback_recommendations(
            conditions=conditions,
            anchors=anchors,
            user_id=user_id,
            day_key=day_key,
        )

    result = {
        "condition": condition_label,
        "recommendations": recommendations,
    }
    cache[cache_key] = result
    return result
