"""Community event provider layer.

Production deployments can integrate official community event sources
(e.g., PA programmes or HealthHub wellness activities) through additional
provider adapters without changing the recommendation engine.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


_REQUIRED_FIELDS = {
    "event_id",
    "title",
    "type",
    "datetime",
    "location",
    "organiser",
    "description",
    "health_tags",
    "intensity",
    "age_friendly",
    "price",
}

_ALLOWED_TYPES = {"exercise", "wellness", "social", "education"}


def _events_file_path() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "events" / "community_events.json"


def _validate_event(event: Dict[str, Any]) -> None:
    missing = [field for field in _REQUIRED_FIELDS if field not in event]
    if missing:
        raise ValueError(f"Event missing required fields: {missing}")

    if event["type"] not in _ALLOWED_TYPES:
        raise ValueError(f"Invalid event type '{event['type']}' for event_id={event.get('event_id')}")

    if not isinstance(event.get("health_tags"), list):
        raise ValueError(f"health_tags must be a list for event_id={event.get('event_id')}")


def load_local_events() -> List[Dict[str, Any]]:
    """Load and validate curated local community events from JSON."""
    path = _events_file_path()
    if not path.exists():
        return []

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("community_events.json must contain a JSON array")

    events: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Each event entry must be a JSON object")
        _validate_event(item)
        events.append(item)

    return events


# Future provider adapter stubs (MVP returns empty lists).
def load_pa_events() -> List[Dict[str, Any]]:
    return []


def load_healthhub_events() -> List[Dict[str, Any]]:
    return []


def load_aac_events() -> List[Dict[str, Any]]:
    return []
