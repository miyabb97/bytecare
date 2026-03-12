"""In-memory storage for the ByteCare MVP backend."""

from __future__ import annotations

from typing import Any, Dict

# Shared in-memory data store used by routers and services.
DB: Dict[str, Any] = {
    "users": {},
    "medications": {},
    "appointments": {},
    "simulations": {},
    "dose_events": [],
    "mes_scores": [],
    "voice_logs": [],
}
