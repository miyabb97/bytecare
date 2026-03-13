"""Nutrition recommendation service."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Medication, User


DIABETES_HINTS = {"diabetes", "insulin", "metformin", "humulin"}
HYPERTENSION_HINTS = {"hypertension", "amlodipine", "valsartan", "hydrochlorothiazide", "losartan", "lisinopril"}


LOW_GI_RECOMMENDATIONS = [
    "Brown rice with steamed fish",
    "Whole-grain porridge with boiled egg",
    "Mixed vegetables with tofu and quinoa",
]

LOW_SODIUM_RECOMMENDATIONS = [
    "Steamed chicken with herbs, no added sauce",
    "Clear vegetable soup with reduced salt",
    "Fresh fruit and unsalted nuts for snacks",
]


def _infer_conditions(user_id: str) -> List[str]:
    with SessionLocal() as db:
        meds = [m.name.lower() for m in db.query(Medication).filter_by(user_id=user_id).all()]
    inferred: List[str] = []

    if any(any(hint in med for hint in DIABETES_HINTS) for med in meds):
        inferred.append("diabetes")

    if any(any(hint in med for hint in HYPERTENSION_HINTS) for med in meds):
        inferred.append("hypertension")

    return inferred


def recommend_food(user_id: str) -> Dict[str, Any]:
    """Recommend food options based on user condition heuristics."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    inferred = _infer_conditions(user_id)
    recommendations: List[str] = []

    if "diabetes" in inferred:
        recommendations.extend(LOW_GI_RECOMMENDATIONS)

    if "hypertension" in inferred:
        recommendations.extend(LOW_SODIUM_RECOMMENDATIONS)

    if not recommendations:
        return {
            "condition": "general_wellness",
            "recommendations": [
                "Balanced plate: half vegetables, quarter protein, quarter whole grains",
                "Drink water regularly and reduce sugary drinks",
            ],
        }

    condition = "_and_".join(inferred)
    return {
        "condition": condition,
        "recommendations": recommendations,
    }
