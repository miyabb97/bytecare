"""TCM safety interaction checking service."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import User


HERB_WARNINGS = {
    "ginseng": "Ginseng may affect blood pressure and blood glucose control when combined with chronic medications.",
    "gingko": "Ginkgo may increase bleeding risk when used with antiplatelet medications.",
    "dong quai": "Dong quai may interact with blood-thinning medications.",
}


def check_tcm_interactions(user_id: str, herb: str) -> Dict[str, Any]:
    """Check a basic herb interaction warning against known high-level rules."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    herb_key = herb.strip().lower()
    warning = HERB_WARNINGS.get(herb_key)

    if warning:
        return {
            "interaction_warning": True,
            "message": warning,
        }

    return {
        "interaction_warning": False,
        "message": f"No known caution flags for '{herb}' in the current MVP rule set.",
    }
