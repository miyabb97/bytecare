"""Patient-facing explanation layer for deterministic nutrition results."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from app.services.meralion_client import MeralionClient, MeralionClientError


def _short_list(items: List[str], max_items: int = 3) -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    if not cleaned:
        return ""
    return ", ".join(cleaned[:max_items])


def _fallback_explanation(nutrition_result: Dict[str, Any]) -> str:
    meds = nutrition_result.get("medications_taken_today") or []
    warnings = bool(nutrition_result.get("interaction_warning"))
    warning_message = str(nutrition_result.get("warning_message") or "").strip()
    recs = nutrition_result.get("recommended_foods") or []
    avoid = nutrition_result.get("avoid_foods") or []

    meds_text = _short_list(meds, max_items=2)
    rec_text = _short_list(recs, max_items=2)
    avoid_text = _short_list(avoid, max_items=2)

    if warnings and warning_message:
        suffix = f" Safer options today: {rec_text}." if rec_text else ""
        return f"{warning_message}{suffix}".strip()

    if meds_text and avoid_text:
        return (
            f"You have taken {meds_text} today. Continue to avoid {avoid_text}, and choose {rec_text or 'lighter lower-salt meals'} where possible."
        )

    if rec_text:
        return f"For today, good meal choices include {rec_text}. Keep portions steady and stay hydrated."

    return "For today, keep meals balanced with less sugar and salt, and drink enough water."


def _clean_model_text(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    return " ".join(text.split())


def generate_nutrition_explanation(nutrition_result: Dict[str, Any]) -> str:
    """Generate a short supportive explanation without changing deterministic facts."""
    fallback = _fallback_explanation(nutrition_result)
    client = MeralionClient()
    if not client.enabled:
        return fallback

    facts = {
        "medications_taken_today": nutrition_result.get("medications_taken_today", []),
        "food_query": nutrition_result.get("food_query"),
        "interaction_warning": nutrition_result.get("interaction_warning", False),
        "warning_message": nutrition_result.get("warning_message", ""),
        "recommended_foods": nutrition_result.get("recommended_foods", []),
        "avoid_foods": nutrition_result.get("avoid_foods", []),
        "reasoning": nutrition_result.get("reasoning", []),
    }

    prompt = (
        "You are ByteCare's nutrition support assistant for an elderly Singapore patient.\n"
        "Rewrite the provided nutrition result into 2-3 short, supportive sentences.\n"
        "Requirements:\n"
        "- Use only the facts provided.\n"
        "- Do not invent medication-food interactions.\n"
        "- No diagnosis and no medication change advice.\n"
        "- Keep it concise, safe, and clear.\n"
        "- Singlish-friendly tone is okay, but remain clear.\n"
        "Return plain text only.\n\n"
        f"FACTS_JSON:\n{json.dumps(facts, ensure_ascii=True)}"
    )

    try:
        raw = client.chat(prompt, hyperparameters={"temperature": 0.2, "topP": 0.9})
        text = _clean_model_text(raw)
        return text or fallback
    except (MeralionClientError, Exception):
        return fallback
