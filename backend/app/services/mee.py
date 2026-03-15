"""Medication Evidence Engine — adherence confidence scoring service.

Computes a deterministic adherence confidence score (0–100) per patient,
aggregating per-medication MES scores with explanations.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from app.db import SessionLocal
from app.models import DoseEvent, Medication, MesScore, User


def _count_events_last_n_days(user_id: str, days: int = 7) -> Dict[str, int]:
    """Count taken, missed, late, skipped dose events in the last N days."""
    since = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    with SessionLocal() as db:
        events = (
            db.query(DoseEvent)
            .filter(DoseEvent.user_id == user_id, DoseEvent.timestamp >= since)
            .all()
        )
    counts = {"taken": 0, "missed": 0, "late": 0, "skipped": 0, "snoozed": 0}
    for ev in events:
        status = ev.response_status
        if status in counts:
            counts[status] += 1
        elif ev.event_type == "dose_missed":
            counts["missed"] += 1
        elif ev.event_type == "dose_late":
            counts["late"] += 1
        elif ev.event_type in ("tap_confirm", "pillbox_open", "voice_confirm"):
            counts["taken"] += 1
        elif ev.event_type == "dose_skipped":
            counts["skipped"] += 1
    return counts


def _build_explanation(counts: Dict[str, int], score: float, days: int) -> str:
    """Build human-readable explanation of the score."""
    parts: List[str] = []
    if counts["missed"] > 0:
        parts.append(f"Missed {counts['missed']} dose{'s' if counts['missed'] != 1 else ''}")
    if counts["late"] > 0:
        parts.append(f"late {counts['late']} time{'s' if counts['late'] != 1 else ''}")
    if counts["skipped"] > 0:
        parts.append(f"skipped {counts['skipped']} dose{'s' if counts['skipped'] != 1 else ''}")
    if not parts:
        return f"All doses taken on time this {'week' if days == 7 else f'{days}-day period'}."
    return " and ".join(parts) + f" this {'week' if days == 7 else f'{days}-day period'}."


def compute_adherence_score(user_id: str, days: int = 7) -> Dict[str, Any]:
    """Compute a single patient-level adherence confidence score (0–100).

    Score breakdown (deterministic):
      - Start at 100
      - Each missed dose: -8
      - Each late dose: -3
      - Each skipped (intentional): -5
      - Repeated misses (3+) in period: additional -10 penalty
      - Clamped to [0, 100]
    """
    counts = _count_events_last_n_days(user_id, days)
    total_events = counts["taken"] + counts["missed"] + counts["late"] + counts["skipped"]

    score = 100.0
    score -= counts["missed"] * 8
    score -= counts["late"] * 3
    score -= counts["skipped"] * 5

    # Repeated miss penalty
    if counts["missed"] >= 3:
        score -= 10

    score = max(0.0, min(100.0, score))
    score = round(score, 1)

    explanation = _build_explanation(counts, score, days)

    return {
        "user_id": user_id,
        "score": score,
        "explanation": explanation,
        "period_days": days,
        "counts": counts,
        "total_events": total_events,
        "computed_at": datetime.now().isoformat(timespec="seconds"),
    }


def compute_per_medication_scores(user_id: str, days: int = 7) -> List[Dict[str, Any]]:
    """Compute per-medication adherence scores from MES data."""
    today = datetime.now().date()
    lower = today - timedelta(days=days)

    with SessionLocal() as db:
        meds = db.query(Medication).filter_by(user_id=user_id).all()
        med_dicts = [m.to_dict() for m in meds]
        scores = db.query(MesScore).filter_by(user_id=user_id).all()

    result = []
    for med in med_dicts:
        med_scores = [
            s.mes for s in scores
            if s.medication_id == med["medication_id"]
            and s.scheduled_datetime
            and lower <= datetime.fromisoformat(s.scheduled_datetime).date() <= today
        ]
        avg = round(sum(med_scores) / len(med_scores), 1) if med_scores else 100.0
        result.append({
            "medication_id": med["medication_id"],
            "medication_name": med["name"],
            "average_mes": avg,
            "dose_count": len(med_scores),
        })

    return result
