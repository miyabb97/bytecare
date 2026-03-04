#!/usr/bin/env python3
"""
ByteCare seed + demo runner.

Usage:
  python scripts/seed_and_demo.py

Optional:
  BASE_URL=http://localhost:8000 python scripts/seed_and_demo.py
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
API_PREFIX = os.environ.get("API_PREFIX", "/api/v1")

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "seeds" / "bytecare_seed_mrtan.json"
OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "demo_outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TIMEOUT = 30


def url(path: str) -> str:
    return f"{BASE_URL}{API_PREFIX}{path}"


def must(resp: requests.Response) -> Dict[str, Any]:
    if not resp.ok:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
    if resp.headers.get("Content-Type", "").startswith("application/json"):
        return resp.json()
    return {"raw": resp.text}


def post_json(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.post(url(path), json=payload, timeout=TIMEOUT)
    return must(r)


def get_json(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    r = requests.get(url(path), params=params or {}, timeout=TIMEOUT)
    return must(r)


def download_file(path: str, out_path: Path, params: Optional[Dict[str, Any]] = None) -> None:
    r = requests.get(url(path), params=params or {}, timeout=TIMEOUT)
    if not r.ok:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text}")
    out_path.write_bytes(r.content)


def main() -> None:
    if not SEED_PATH.exists():
        raise FileNotFoundError(f"Seed file not found: {SEED_PATH}")

    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))

    # 1) Create user
    user_payload = {
        "name": seed["user"]["display_name"],
        "age": seed["user"]["age"],
        "timezone": seed["user"]["timezone"],
    }
    user_res = post_json("/users", user_payload)
    user_id = user_res["user_id"]
    print(f"[OK] Created user: {user_id}")

    # 2) Add medications
    medication_ids: List[str] = []
    for med in seed.get("medications", []):
        med_payload = {
            "name": med["name"],
            "dose_text": med.get("dose_text", ""),
            "schedule": med["schedule"],  # {"frequency": "...", "times": ["HH:MM", ...]}
            "time_window_minutes": med.get("time_window_minutes", 120),
            "criticality": med.get("criticality", "medium"),
        }
        med_res = post_json(f"/users/{user_id}/medications", med_payload)
        medication_id = med_res["medication_id"]
        medication_ids.append(medication_id)
        print(f"[OK] Added medication: {med['name']} -> {medication_id}")

    # 3) Add appointments
    for appt in seed.get("appointments", []):
        appt_payload = {
            "datetime": appt["datetime"],
            "location": appt.get("location", ""),
            "notes": appt.get("notes", ""),
        }
        appt_res = post_json(f"/users/{user_id}/appointments", appt_payload)
        print(f"[OK] Added appointment: {appt_res.get('appointment_id','(no id returned)')}")

    # 4) Run simulator
    sim = seed.get("demo_simulation", {"days": 14, "seed": 42, "pattern": "travel_confusion"})
    sim_payload = {
        "days": sim.get("days", 14),
        "seed": sim.get("seed", 42),
        "pattern": sim.get("pattern", "travel_confusion"),
    }
    sim_res = post_json(f"/users/{user_id}/simulate/pillbox", sim_payload)
    print(f"[OK] Simulator run: {sim_res}")

    # 5) Fetch MES, drift, next action
    mes_res = get_json(f"/users/{user_id}/mes")
    drift_res = get_json(f"/users/{user_id}/drift")
    next_action_res = get_json(f"/users/{user_id}/next-action")

    (OUT_DIR / "mes.json").write_text(json.dumps(mes_res, indent=2), encoding="utf-8")
    (OUT_DIR / "drift.json").write_text(json.dumps(drift_res, indent=2), encoding="utf-8")
    (OUT_DIR / "next_action.json").write_text(json.dumps(next_action_res, indent=2), encoding="utf-8")

    print("[OK] Saved demo outputs:")
    print(f"  - {OUT_DIR / 'mes.json'}")
    print(f"  - {OUT_DIR / 'drift.json'}")
    print(f"  - {OUT_DIR / 'next_action.json'}")

    # 6) Export clinician PDF (optional)
    # If your API needs a week_start param, set it here. Otherwise it will just generate based on recent data.
    week_start = os.environ.get("WEEK_START")  # e.g., "2026-03-01"
    pdf_params = {"week_start": week_start} if week_start else {}

    pdf_out = OUT_DIR / "clinician_report.pdf"
    try:
        download_file(f"/users/{user_id}/reports/weekly.pdf", pdf_out, params=pdf_params)
        print(f"[OK] Downloaded PDF report: {pdf_out}")
    except Exception as e:
        print(f"[WARN] PDF export failed (ok if endpoint not implemented yet): {e}")

    print("\nDONE.")
    print(f"User ID for demo: {user_id}")


if __name__ == "__main__":
    main()