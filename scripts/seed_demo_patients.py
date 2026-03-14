#!/usr/bin/env python3
"""
Seed 3 demo patients for TCM Safety Check testing.

Usage:
  python scripts/seed_demo_patients.py

The backend server must be running on localhost:8000.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
API = f"{BASE_URL}/api/v1"
TIMEOUT = 30

SEEDS_DIR = Path(__file__).resolve().parents[1] / "data" / "seeds"

DEMO_FILES = [
    "demo_mdm_lim.json",
    "demo_mr_ong.json",
    "demo_mrs_wong.json",
]


def post_json(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.post(f"{API}{path}", json=payload, timeout=TIMEOUT)
    if not r.ok:
        raise RuntimeError(f"POST {path} failed: HTTP {r.status_code} – {r.text}")
    return r.json()


def seed_patient(seed_path: Path) -> str:
    """Create one demo patient with medications and appointments. Returns user_id."""
    seed = json.loads(seed_path.read_text(encoding="utf-8"))

    user_data = seed["user"]
    user_payload = {
        "name": user_data["display_name"],
        "age": user_data["age"],
        "conditions": user_data.get("conditions", []),
        "timezone": user_data.get("timezone", "Asia/Singapore"),
    }
    user_res = post_json("/users", user_payload)
    user_id = user_res["user_id"]
    print(f"  [+] Created user: {user_data['display_name']} -> {user_id}")

    for med in seed.get("medications", []):
        med_payload = {
            "name": med["name"],
            "dose_text": med.get("dose_text", ""),
            "schedule": med["schedule"],
            "time_window_minutes": med.get("time_window_minutes", 120),
            "criticality": med.get("criticality", "medium"),
        }
        post_json(f"/users/{user_id}/medications", med_payload)
        print(f"      Medication: {med['name']}")

    for appt in seed.get("appointments", []):
        appt_payload = {
            "datetime": appt["datetime"],
            "location": appt.get("location", ""),
            "notes": appt.get("notes", ""),
        }
        post_json(f"/users/{user_id}/appointments", appt_payload)
        print(f"      Appointment: {appt['location']}")

    return user_id


def main() -> None:
    print("=" * 50)
    print("ByteCare – Seeding 3 Demo Patients")
    print("=" * 50)

    created = []
    for filename in DEMO_FILES:
        path = SEEDS_DIR / filename
        if not path.exists():
            print(f"  [!] Seed file not found: {path}")
            continue
        print(f"\n  Seeding from {filename}...")
        user_id = seed_patient(path)
        created.append(user_id)

    print(f"\n{'=' * 50}")
    print(f"Done! Created {len(created)} demo patients.")
    print(f"User IDs: {created}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
