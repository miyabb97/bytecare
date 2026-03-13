"""Community event suggestion service."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import User


def recommend_community_events(user_id: str) -> Dict[str, Any]:
    """Return simple community event suggestions for social engagement."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    base_date = datetime.now().date()

    events: List[Dict[str, str]] = [
        {
            "title": "Morning Walk Group",
            "location": "Community Park",
            "date": (base_date + timedelta(days=2)).isoformat(),
            "reason": "Supports a consistent morning routine.",
        },
        {
            "title": "Healthy Cooking Workshop",
            "location": "Senior Activity Centre",
            "date": (base_date + timedelta(days=4)).isoformat(),
            "reason": "Helps build better meal habits for chronic care.",
        },
        {
            "title": "Medication Support Circle",
            "location": "Polyclinic Education Room",
            "date": (base_date + timedelta(days=7)).isoformat(),
            "reason": "Peer support can improve adherence consistency.",
        },
    ]

    return {"events": events}
