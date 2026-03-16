"""Data provider for nutrition interaction and food profile files."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict


_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "nutrition"
_MED_INTERACTIONS_PATH = _DATA_DIR / "med_food_interactions.json"
_FOOD_PROFILES_PATH = _DATA_DIR / "food_profiles.json"


def _read_json_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if isinstance(payload, dict):
        return payload
    return {}


@lru_cache(maxsize=1)
def load_med_food_interactions() -> Dict[str, Any]:
    """Load medication-food interaction mapping from disk."""
    return _read_json_file(_MED_INTERACTIONS_PATH)


@lru_cache(maxsize=1)
def load_food_profiles() -> Dict[str, Any]:
    """Load food profile tags from disk."""
    return _read_json_file(_FOOD_PROFILES_PATH)
