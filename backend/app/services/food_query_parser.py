"""Deterministic parsing for chat food questions."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from app.services.nutrition_provider import load_food_profiles


_FOOD_INTENT_RE = re.compile(
    r"("
    r"\b(can i eat|can eat|eat this|drink this|is .* okay for me|"
    r"what should i eat|what can i eat|what to eat|"
    r"feel like|healthier alternatives|healthy alternatives|"
    r"suggest\w*\s+(a\s+)?(healthier|lighter|safer|lower.sugar|lower.salt|dinner|lunch|breakfast|food|snack|meal|alternative|option)\w*|"
    r"show\s+(healthier|lighter|safer|lower.sugar|lower.salt)\s*\w*|"
    r"dinner|lunch|breakfast|supper|meal|food|drink|snack|after taking my medicine|"
    r"after my medicine|after taking medicine)\b|"
    r"(可以吃|能吃|可以喝|能喝|晚餐|午餐|早餐|食物|饮料|飲料|吃什么|喝什么|這個可以吃嗎|这个可以吃吗)"
    r")",
    re.IGNORECASE,
)

_GENERIC_FOOD_ONLY_RE = re.compile(
    r"\b(show healthier alternatives|healthy alternatives|what should i eat|what can i eat|dinner|lunch|breakfast|supper)\b",
    re.IGNORECASE,
)

_CAPTURE_AFTER_VERB_RE = re.compile(
    r"\b(?:eat|drink|have|try|order|feel like|want)\s+([a-z][a-z0-9\s\-]{2,50})",
    re.IGNORECASE,
)

_STOPWORDS = {
    "today",
    "now",
    "this",
    "that",
    "something",
    "anything",
    "it",
    "or not",
    "okay",
    "for me",
}


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def _profile_candidates() -> List[Tuple[str, List[str]]]:
    profiles = load_food_profiles()
    candidates: List[Tuple[str, List[str]]] = []
    for canonical_name, payload in profiles.items():
        aliases = [str(canonical_name)]
        if isinstance(payload, dict):
            aliases.extend(str(item) for item in payload.get("aliases", []) if str(item).strip())
        deduped = []
        seen = set()
        for alias in aliases:
            raw = alias.strip()
            if not raw:
                continue
            key = raw.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(raw)
        candidates.append((str(canonical_name), deduped))
    return candidates


def _match_profile_alias(message: str) -> str | None:
    raw_lower = message.lower()
    normalized_message = _normalize_text(message)
    best_match: Tuple[int, str] | None = None

    for canonical_name, aliases in _profile_candidates():
        for alias in aliases:
            alias_text = alias.strip()
            if not alias_text:
                continue

            alias_norm = _normalize_text(alias_text)
            matched = False

            if alias_norm and alias_norm in normalized_message:
                matched = True
            elif alias_text.lower() in raw_lower:
                matched = True

            if not matched:
                continue

            score = max(len(alias_norm), len(alias_text))
            if best_match is None or score > best_match[0]:
                best_match = (score, canonical_name)

    return best_match[1] if best_match else None


def _extract_phrase_candidate(message: str) -> str | None:
    match = _CAPTURE_AFTER_VERB_RE.search(message)
    if not match:
        return None

    phrase = match.group(1).strip(" ?!.,")
    phrase = re.sub(r"\b(today|tonight|now|please|lah|leh|lor)\b", "", phrase, flags=re.IGNORECASE).strip()
    if not phrase:
        return None

    normalized = _normalize_text(phrase)
    if not normalized or normalized in _STOPWORDS:
        return None

    return phrase


def parse_food_query(message: str) -> Dict[str, Any]:
    """Return deterministic food-intent classification for chat messages."""
    raw = str(message or "").strip()
    if not raw:
        return {"is_food_query": False, "food_query": None}

    food_query = _match_profile_alias(raw)
    generic_intent = bool(_FOOD_INTENT_RE.search(raw))

    if not food_query and generic_intent:
        phrase_candidate = _extract_phrase_candidate(raw)
        if phrase_candidate and _normalize_text(phrase_candidate) not in _STOPWORDS:
            food_query = phrase_candidate

    is_food_query = bool(food_query) or generic_intent or bool(_GENERIC_FOOD_ONLY_RE.search(raw))

    return {
        "is_food_query": is_food_query,
        "food_query": food_query,
    }
