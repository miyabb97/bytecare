"""Nutrition endpoint router."""

from __future__ import annotations

import os
import tempfile
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.services.food_scan_engine import analyze_food_scan
from app.services.nutrition_engine import (
    get_adaptive_nutrition_from_scan,
    get_adaptive_nutrition_recommendation,
)

router = APIRouter(tags=["nutrition"])


class NutritionCheckRequest(BaseModel):
    food_query: Optional[str] = None


def _extract_text_from_payload(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("extracted_text", "food_query", "ocr_text", "text", "detected_food"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _is_upload_like(value: Any) -> bool:
    return hasattr(value, "read") and callable(value.read)


def _compact_nutrition_result(result: Dict[str, Any]) -> Dict[str, Any]:
    recommended = list(result.get("recommended_foods") or result.get("recommendations") or [])
    return {
        "recommendation_level": str(result.get("recommendation_level") or ""),
        "interaction_warning": bool(result.get("interaction_warning")),
        "warning_message": str(result.get("warning_message") or ""),
        "recommended_foods": recommended,
        "recommendations": recommended,
        "avoid_foods": list(result.get("avoid_foods") or []),
        "reasoning": list(result.get("reasoning") or []),
        "condition": str(result.get("condition") or ""),
        "medications_taken_today": list(result.get("medications_taken_today") or []),
        "food_query": result.get("food_query"),
        "explanation": str(result.get("explanation") or ""),
    }


@router.post("/users/{user_id}/nutrition/check")
def check_nutrition(user_id: str, payload: NutritionCheckRequest):
    """Check food query against today's taken medications and conditions."""
    return get_adaptive_nutrition_recommendation(user_id=user_id, food_query=payload.food_query)


@router.post("/users/{user_id}/nutrition/scan")
async def scan_nutrition(user_id: str, request: Request):
    """Scan food input via extracted text or uploaded image.

    Supported inputs:
    - JSON: {"extracted_text": "..."}
    - multipart/form-data: image=<file>, extracted_text=<optional>
    """
    content_type = request.headers.get("content-type", "").lower()

    extracted_text: Optional[str] = None
    image_path: Optional[str] = None

    try:
        if "application/json" in content_type:
            payload = await request.json()
            if isinstance(payload, dict):
                extracted_text = _extract_text_from_payload(payload)
        else:
            form = await request.form()
            for key in ("extracted_text", "food_query", "ocr_text", "text", "detected_food"):
                text_value = form.get(key)
                if isinstance(text_value, str) and text_value.strip():
                    extracted_text = text_value.strip()
                    break

            image_file: Any = None
            for key in ("image", "file", "photo", "upload"):
                candidate = form.get(key)
                if candidate is not None:
                    image_file = candidate
                    break

            if image_file is None:
                for _key, candidate in form.multi_items():
                    if _is_upload_like(candidate) or isinstance(candidate, (bytes, bytearray)):
                        image_file = candidate
                        break

            if _is_upload_like(image_file):
                raw = await image_file.read()
                if raw:
                    filename = getattr(image_file, "filename", "") or ""
                    suffix = os.path.splitext(filename)[1] or ".jpg"
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                        tmp.write(raw)
                        image_path = tmp.name
            elif isinstance(image_file, (bytes, bytearray)) and image_file:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                    tmp.write(bytes(image_file))
                    image_path = tmp.name
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid nutrition scan payload: {exc}") from exc

    if not extracted_text and not image_path:
        raise HTTPException(status_code=400, detail="Provide extracted_text or image for nutrition scan")

    try:
        scan_result = analyze_food_scan(
            user_id=user_id,
            image_path=image_path,
            extracted_text=extracted_text,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    finally:
        if image_path and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except OSError:
                pass

    nutrition_result = get_adaptive_nutrition_from_scan(
        user_id=user_id,
        detected_food=scan_result.get("detected_food"),
        ingredients=scan_result.get("ingredients") or [],
    )

    return {
        "scan_result": {
            "detected_food": scan_result.get("detected_food", ""),
            "ocr_text": scan_result.get("ocr_text", ""),
            "ingredients": scan_result.get("ingredients", []),
            "source": scan_result.get("source", "fallback"),
            "fallback_reason": scan_result.get("fallback_reason"),
        },
        "nutrition_result": _compact_nutrition_result(nutrition_result),
    }


@router.get("/users/{user_id}/food-recommendations")
def get_food_recommendations(user_id: str):
    """Return adaptive daily food recommendations for the user."""
    return get_adaptive_nutrition_recommendation(user_id=user_id, food_query=None)
