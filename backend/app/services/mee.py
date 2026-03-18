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
    """Count taken, late, not_taken, snoozed dose events in the last N days."""
    since = (datetime.utcnow() - timedelta(days=days)).isoformat(timespec="seconds")
    with SessionLocal() as db:
        events = (
            db.query(DoseEvent)
            .filter(DoseEvent.user_id == user_id, DoseEvent.timestamp >= since)
            .all()
        )
    counts = {"taken": 0, "late": 0, "not_taken": 0, "snoozed": 0}
    for ev in events:
        status = ev.response_status
        if status == "taken":
            counts["taken"] += 1
        elif status == "late":
            counts["late"] += 1
        elif status == "not_taken":
            counts["not_taken"] += 1
        elif status == "snoozed":
            counts["snoozed"] += 1
        # Legacy fallback for old event records
        elif ev.event_type in ("tap_confirm", "voice_confirm"):
            counts["taken"] += 1
        elif ev.event_type == "dose_late":
            counts["late"] += 1
        elif ev.event_type in ("dose_not_taken", "dose_missed", "dose_skipped"):
            counts["not_taken"] += 1
    return counts


def _build_explanation(counts: Dict[str, int], score: float, days: int) -> str:
    """Build human-readable explanation of the score."""
    period = 'week' if days == 7 else f'{days}-day period'
    parts: List[str] = []
    if counts["not_taken"] > 0:
        parts.append(f"Not taken {counts['not_taken']} dose{'s' if counts['not_taken'] != 1 else ''}")
    if counts["late"] > 0:
        parts.append(f"taken late {counts['late']} time{'s' if counts['late'] != 1 else ''}")
    if not parts:
        return f"All doses taken on time this {period}."
    return " and ".join(parts) + f" this {period}."


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
    total_events = counts["taken"] + counts["late"] + counts["not_taken"]

    # MEE confidence score (penalty-based, 0–100)
    score = 100.0
    score -= counts["not_taken"] * 8
    score -= counts["late"] * 3
    if counts["not_taken"] >= 3:
        score -= 10  # repeated miss penalty
    score = max(0.0, min(100.0, score))
    score = round(score, 1)

    # Adherence % (ratio-based, consistent with clinician/caregiver views)
    adherence_pct = round(
        ((counts["taken"] + 0.5 * counts["late"]) / total_events * 100) if total_events > 0 else 100.0, 1
    )

    explanation = _build_explanation(counts, score, days)

    return {
        "user_id": user_id,
        "score": score,
        "adherence_pct": adherence_pct,
        "explanation": explanation,
        "period_days": days,
        "counts": counts,
        "total_events": total_events,
        "computed_at": datetime.utcnow().isoformat(timespec="seconds"),
    }


def compute_per_medication_scores(user_id: str, days: int = 7) -> List[Dict[str, Any]]:
    """Compute per-medication adherence scores from MES data."""
    today = datetime.utcnow().date()
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
