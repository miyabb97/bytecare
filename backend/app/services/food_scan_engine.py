"""Food scan extraction service.

Groq is used for image food extraction when available.
Nutrition safety logic remains deterministic in the nutrition engine.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.db import SessionLocal
from app.models import User
from app.services.groq_vision_client import GroqVisionClient, GroqVisionClientError

logger = logging.getLogger(__name__)


def _ensure_user_exists(user_id: str) -> None:
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise ValueError("User not found")


def _normalize_text(text: str) -> str:
    return " ".join(str(text).strip().split())


def _dedupe_preserve(values: List[str]) -> List[str]:
    result: List[str] = []
    seen: set[str] = set()
    for value in values:
        item = _normalize_text(value)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _extract_ingredients_from_text(text: str) -> List[str]:
    lowered = text.lower()

    # Keep this list intentionally small and deterministic for MVP.
    lexicon = [
        "spinach",
        "kale",
        "broccoli",
        "grapefruit",
        "grapefruit juice",
        "bubble tea",
        "alcohol",
        "rice",
        "fish",
        "chicken",
        "pork",
        "tofu",
        "soup",
        "noodle",
        "vegetable",
    ]

    hits: List[str] = []
    for token in lexicon:
        if token in lowered:
            hits.append(token)

    return _dedupe_preserve(hits)


def _detected_food_from_text(text: str, ingredients: List[str]) -> str:
    clean = _normalize_text(text)
    if not clean:
        return ""

    if len(clean) <= 50:
        return clean

    if ingredients:
        if "soup" in ingredients:
            return f"{ingredients[0]} soup"
        return ingredients[0]

    # Fallback to first short phrase.
    head = clean[:50]
    split_idx = head.rfind(" ")
    if split_idx > 12:
        return head[:split_idx]
    return head


def _run_local_ocr(image_bytes: bytes) -> Tuple[str, str | None]:
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except Exception as exc:
        return "", f"Local OCR dependencies unavailable: {exc}"

    try:
        image = Image.open(io.BytesIO(image_bytes))
    except Exception as exc:
        return "", f"Unable to open image for OCR: {exc}"

    try:
        gray = ImageOps.grayscale(image)
        text = pytesseract.image_to_string(gray)
        normalized = _normalize_text(text)
        if normalized:
            return normalized, None

        text_fallback = pytesseract.image_to_string(image)
        normalized_fallback = _normalize_text(text_fallback)
        if normalized_fallback:
            return normalized_fallback, None
        return "", "Local OCR found no readable text."
    except Exception as exc:
        return "", f"Local OCR failed: {exc}"


def analyze_food_scan(
    user_id: str,
    image_path: str | None = None,
    extracted_text: str | None = None,
) -> Dict[str, Any]:
    """Analyze scanned or extracted food text for downstream deterministic nutrition checks."""
    _ensure_user_exists(user_id)

    normalized_text = _normalize_text(extracted_text or "")
    if normalized_text:
        ingredients = _extract_ingredients_from_text(normalized_text)
        detected_food = _detected_food_from_text(normalized_text, ingredients)
        return {
            "detected_food": detected_food,
            "ocr_text": normalized_text,
            "ingredients": ingredients,
            "source": "extracted_text",
        }

    if image_path:
        file_path = Path(image_path)
        if file_path.exists() and file_path.is_file():
            image_bytes = file_path.read_bytes()
            fallback_reasons: List[str] = []

            groq_client = GroqVisionClient()
            if groq_client.enabled:
                try:
                    parsed = groq_client.extract_food_from_image(image_bytes)
                    detected_food = _normalize_text(str(parsed.get("detected_food") or ""))
                    ocr_text = _normalize_text(str(parsed.get("ocr_text") or ""))
                    ingredients = _dedupe_preserve([str(item) for item in (parsed.get("ingredients") or [])])

                    if not ingredients and ocr_text:
                        ingredients = _extract_ingredients_from_text(ocr_text)
                    if not detected_food:
                        detected_food = _detected_food_from_text(ocr_text, ingredients)

                    return {
                        "detected_food": detected_food,
                        "ocr_text": ocr_text,
                        "ingredients": ingredients,
                        "source": "groq_vision",
                    }
                except GroqVisionClientError as exc:
                    logger.warning("Groq vision fallback: %s", exc)
                    fallback_reasons.append(str(exc))
            else:
                fallback_reasons.append("Groq vision is not configured (missing API key/model).")

            ocr_text_local, local_ocr_error = _run_local_ocr(image_bytes)
            if ocr_text_local:
                ingredients = _extract_ingredients_from_text(ocr_text_local)
                detected_food = _detected_food_from_text(ocr_text_local, ingredients)
                return {
                    "detected_food": detected_food,
                    "ocr_text": ocr_text_local,
                    "ingredients": ingredients,
                    "source": "local_ocr",
                    "fallback_reason": "; ".join(fallback_reasons) if fallback_reasons else None,
                }

            if local_ocr_error:
                fallback_reasons.append(local_ocr_error)

            return {
                "detected_food": "",
                "ocr_text": "",
                "ingredients": [],
                "source": "fallback",
                "fallback_reason": "; ".join(fallback_reasons) if fallback_reasons else "Image scan failed.",
            }

        return {
            "detected_food": "",
            "ocr_text": "",
            "ingredients": [],
            "source": "fallback",
            "fallback_reason": "Image path does not exist or is not a file.",
        }

    return {
        "detected_food": "",
        "ocr_text": "",
        "ingredients": [],
        "source": "fallback",
        "fallback_reason": "No extracted text and no image were provided.",
    }
