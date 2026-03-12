"""Clinician report summary service."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from app.db import DB
from app.services.agent_engine import determine_next_action
from app.services.drift_engine import detect_adherence_drift
from app.services.meralion_client import MeralionClient, MeralionClientError


def _recommended_follow_up(severity: str, next_action: str) -> str:
    """Return deterministic follow-up guidance for clinicians."""
    if next_action == "caregiver_alert" or severity == "red":
        return "Arrange same-day caregiver outreach and medication adherence check-in."
    if severity == "orange":
        return "Arrange follow-up within 48 hours for adherence coaching and barrier review."
    if severity == "yellow":
        return "Review adherence pattern at next contact and reinforce daily routine reminders."
    return "Continue routine monitoring and acknowledge current adherence stability."


def _deterministic_summary(
    patient_name: str,
    drift_detected: bool,
    severity: str,
    avg_mes_7d: float,
    missed_doses_7d: int,
    late_doses_7d: int,
    next_action: str,
) -> str:
    """Build fallback clinician summary using fixed template text."""
    status_text = "drift detected" if drift_detected else "no drift detected"
    return (
        f"{patient_name}: {status_text}; severity {severity}. "
        f"Past 7 days: average MES {avg_mes_7d}, missed doses {missed_doses_7d}, late doses {late_doses_7d}. "
        f"Current system action: {next_action}."
    )


def _rewrite_summary_for_clinician(raw_summary: str) -> str:
    """Optionally rewrite summary into concise clinician-friendly language via MERaLiON."""
    client = MeralionClient()
    if not client.enabled:
        return raw_summary

    prompt = (
        "Rewrite the following adherence summary into concise clinician-facing language. "
        "Safety constraints: do not provide diagnosis, do not suggest medication changes, "
        "and keep to 2 short sentences. Return plain text only.\n\n"
        f"Summary: {raw_summary}"
    )

    try:
        rewritten = client.chat(prompt, hyperparameters={"temperature": 0.2, "topP": 0.9})
        return rewritten.strip() or raw_summary
    except MeralionClientError:
        return raw_summary


def generate_report_summary(user_id: str) -> Dict[str, Any]:
    """Generate structured clinician report summary from backend rule outputs."""
    user = DB["users"].get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    drift = detect_adherence_drift(user_id)
    next_action_payload = determine_next_action(user_id)

    patient_name = user.get("name", "Patient")
    drift_detected = bool(drift.get("drift_detected", False))
    severity = str(drift.get("severity", "green"))

    details = drift.get("details", {}) if isinstance(drift.get("details"), dict) else {}
    avg_mes_7d = float(details.get("avg_mes", 100.0))
    missed_doses_7d = int(details.get("missed_doses", 0))
    late_doses_7d = int(details.get("late_doses", 0))

    next_action = str(next_action_payload.get("next_action", "none"))
    recommended_follow_up = _recommended_follow_up(severity, next_action)

    deterministic_summary = _deterministic_summary(
        patient_name=patient_name,
        drift_detected=drift_detected,
        severity=severity,
        avg_mes_7d=round(avg_mes_7d, 2),
        missed_doses_7d=missed_doses_7d,
        late_doses_7d=late_doses_7d,
        next_action=next_action,
    )
    summary = _rewrite_summary_for_clinician(deterministic_summary)

    return {
        "patient_name": patient_name,
        "summary": summary,
        "drift_detected": drift_detected,
        "severity": severity,
        "avg_mes_7d": round(avg_mes_7d, 2),
        "missed_doses_7d": missed_doses_7d,
        "late_doses_7d": late_doses_7d,
        "next_action": next_action,
        "recommended_follow_up": recommended_follow_up,
    }
