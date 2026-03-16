"""AI Caregiver Briefing service.

Generates a short, personalised action briefing for the caregiver using the
available LLM clients (MERaLiON first, Groq fallback).  Always returns a
usable result — if both LLMs are unavailable the response is built from
rule-based heuristics so the endpoint never errors.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.db import SessionLocal
from app.models import Account, Appointment, DoseEvent, InterventionLog, Medication, User


# ---------------------------------------------------------------------------
# Data gathering
# ---------------------------------------------------------------------------

def _gather_patient_context(account_id: str, patient_user_id: str) -> Dict[str, Any]:
    """Return a structured dict with everything the LLM needs."""
    with SessionLocal() as db:
        account = db.query(Account).filter_by(account_id=account_id).first()
        if not account or account.role != "caregiver":
            raise PermissionError("Not a caregiver account")

        cg_user = db.query(User).filter_by(account_id=account_id).first()
        if not cg_user:
            raise ValueError("Caregiver profile not found")

        patient = db.query(User).filter_by(
            user_id=patient_user_id, caregiver_id=cg_user.user_id
        ).first()
        if not patient:
            raise ValueError("Patient not linked to this caregiver")

        meds = db.query(Medication).filter_by(user_id=patient_user_id).all()

        now = datetime.utcnow()
        since = (now - timedelta(days=7)).isoformat(timespec="seconds")
        dose_events = (
            db.query(DoseEvent)
            .filter(DoseEvent.user_id == patient_user_id, DoseEvent.timestamp >= since)
            .order_by(DoseEvent.timestamp.desc())
            .all()
        )

        next_appt = (
            db.query(Appointment)
            .filter(Appointment.user_id == patient_user_id, Appointment.datetime > now.isoformat())
            .order_by(Appointment.datetime)
            .first()
        )

        last_intervention = (
            db.query(InterventionLog)
            .filter_by(user_id=patient_user_id)
            .order_by(InterventionLog.timestamp.desc())
            .first()
        )

        # Adherence stats
        taken = sum(1 for e in dose_events if e.response_status == "taken")
        missed = sum(1 for e in dose_events if e.response_status == "missed")
        late = sum(1 for e in dose_events if e.response_status == "late")
        total = taken + missed + late
        adherence_pct = round((taken / total) * 100) if total > 0 else 100

        # Today's summary (for short daily briefing)
        today_date = datetime.utcnow().date().isoformat()
        today_events = [e for e in dose_events if e.timestamp and e.timestamp.startswith(today_date)]
        today_taken = sum(1 for e in today_events if e.response_status == "taken")
        today_missed = sum(1 for e in today_events if e.response_status == "missed")
        today_late = sum(1 for e in today_events if e.response_status == "late")
        # Build a small human-readable today summary
        if today_events:
            today_summary = f"Today: {today_taken} taken, {today_missed} missed, {today_late} late."
        else:
            today_summary = "No medication events recorded for today."

        # Missed medication names (deduplicated)
        missed_ids = list(dict.fromkeys(
            e.medication_id for e in dose_events if e.response_status == "missed"
        ))
        med_map = {m.medication_id: m.name for m in meds}
        missed_names = [med_map[mid] for mid in missed_ids if mid in med_map]

        # Risk level
        if adherence_pct < 70:
            risk = "HIGH RISK"
        elif adherence_pct < 85:
            risk = "NEEDS FOLLOW-UP"
        else:
            risk = "ON TRACK"

        return {
            "patient_name": patient.name,
            "patient_age": patient.age,
            "conditions": getattr(patient, "conditions", []) or [],
            "medications": [{"name": m.name, "dose_text": m.dose_text} for m in meds],
            "missed_names": missed_names,
            "adherence_pct": adherence_pct,
            "taken": taken,
            "missed": missed,
            "late": late,
            "risk": risk,
            "today_summary": today_summary,
            "next_appt": {
                "datetime": next_appt.datetime,
                "location": next_appt.location,
                "notes": next_appt.notes,
            } if next_appt else None,
            "last_intervention_type": last_intervention.action_type if last_intervention else None,
        }


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_prompt(ctx: Dict[str, Any]) -> str:
    conditions = ", ".join(ctx["conditions"]) if ctx["conditions"] else "none recorded"
    meds = "; ".join(f"{m['name']} ({m['dose_text']})" for m in ctx["medications"]) if ctx["medications"] else "none"
    missed_str = ", ".join(ctx["missed_names"]) if ctx["missed_names"] else "none"

    appt_str = "No upcoming appointments."
    if ctx["next_appt"]:
        try:
            dt = datetime.fromisoformat(ctx["next_appt"]["datetime"])
            appt_str = (
                f"{dt.strftime('%A, %d %b %Y at %I:%M %p')} "
                f"at {ctx['next_appt']['location']}"
            )
            if ctx["next_appt"].get("notes"):
                appt_str += f" ({ctx['next_appt']['notes']})"
        except Exception:
            appt_str = ctx["next_appt"]["datetime"]

    return (
        "You are a care coordinator AI helping a family caregiver support an elderly patient "
        "in Singapore. Based on the patient data below, produce exactly 1 concise, actionable "
        "bullet point telling the caregiver what to do TODAY. Be specific, warm, and practical. "
        "Do NOT suggest prescribing, changing, or stopping medications — that is a doctor's role. "
        "Focus on emotional support, reminders, appointments, and logistics the caregiver can act on.\n\n"
        "Output format: return ONLY a JSON object with one key 'actions' containing a single "
        "string. No other text.\n\n"
        f"Patient: {ctx['patient_name']}, Age {ctx['patient_age']}\n"
        f"Conditions: {conditions}\n"
        f"Medications (view only): {meds}\n"
        f"7-day adherence: {ctx['adherence_pct']}% "
        f"({ctx['taken']} taken, {ctx['missed']} missed, {ctx['late']} late)\n"
        f"Missed medications: {missed_str}\n"
        f"Risk level: {ctx['risk']}\n"
        f"Next appointment: {appt_str}\n"
        f"Last system alert: {ctx['last_intervention_type'] or 'none'}\n"
        f"Today's summary: {ctx.get('today_summary','No medication events recorded for today.')}\n\n"
        "Produce the JSON now."
    )


def _shorten_text(s: Optional[str], max_chars: int = 90) -> Optional[str]:
    """Produce a short, single-sentence recommendation from a longer string."""
    if not s:
        return s
    try:
        text = s.strip()
        # Prefer first line
        first_line = text.splitlines()[0]
        # Prefer first sentence
        parts = re.split(r"[\.\?!]\s+", first_line)
        sent = parts[0] if parts and parts[0] else first_line
        sent = sent.strip()
        if len(sent) <= max_chars:
            return sent.rstrip(' .,:;')
        # Trim to nearest word boundary
        trimmed = sent[:max_chars].rstrip()
        last_space = trimmed.rfind(' ')
        if last_space > int(max_chars * 0.5):
            trimmed = trimmed[:last_space]
        return trimmed.rstrip(' .,:;')
    except Exception:
        return (s or "")[:max_chars]


# ---------------------------------------------------------------------------
# LLM callers
# ---------------------------------------------------------------------------

def _call_meralion(prompt: str) -> Optional[Dict[str, Any]]:
    try:
        from app.services.meralion_client import MeralionClient, MeralionClientError
        client = MeralionClient()
        if not client.enabled:
            return None
        text = client.chat(prompt)
        return _parse_actions(text)
    except Exception:
        return None


def _call_groq(prompt: str) -> Optional[Dict[str, Any]]:
    try:
        from app.services.groq_vision_client import GroqVisionClient, GroqVisionClientError
        import json as _json

        client = GroqVisionClient()
        if not client.enabled:
            return None

        payload = {
            "model": client.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_completion_tokens": 300,
            "response_format": {"type": "json_object"},
        }
        response = client._post_chat_completions(payload)
        text = client._extract_message_text(response)
        return _parse_actions(text)
    except Exception:
        return None


def _parse_actions(text: str) -> Optional[Dict[str, Any]]:
    """Extract structured briefing dict from LLM JSON response.
    Expected JSON keys: today_summary, risk, missed_count, monitoring, escalations, actions
    """
    try:
        import re
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if not match:
            return None
        data = json.loads(match.group())
        # Normalize minimal shape
        briefing: Dict[str, Any] = {}
        briefing["today_summary"] = data.get("today_summary") or data.get("summary")
        briefing["adherence_pct"] = data.get("adherence_pct")
        briefing["missed"] = data.get("missed_count") or data.get("missed") or 0
        briefing["risk"] = data.get("risk")
        briefing["monitoring"] = data.get("monitoring") or data.get("monitor") or []
        briefing["escalations"] = data.get("escalations") or data.get("escalation") or []
        actions = data.get("actions") or []
        # Actions can be strings or objects; normalize to list of objects
        parsed_actions: List[Dict[str, Any]] = []
        for a in actions[:1]:
            if isinstance(a, str):
                parsed_actions.append({"text": a.strip()})
            elif isinstance(a, dict):
                parsed_actions.append({
                    "text": a.get("text") or a.get("action") or "",
                    "reason": a.get("reason"),
                    "confidence": a.get("confidence"),
                })
        briefing["actions"] = parsed_actions
        # compute an overall confidence if present on actions
        confidences = [a.get("confidence") for a in parsed_actions if isinstance(a, dict) and a.get("confidence") is not None]
        if confidences:
            try:
                briefing["confidence"] = float(sum(confidences) / len(confidences))
            except Exception:
                briefing["confidence"] = None
        else:
            # also allow top-level confidence
            briefing["confidence"] = data.get("confidence")
        return briefing
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Rule-based fallback
# ---------------------------------------------------------------------------

def _rule_based_actions(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Return a structured fallback briefing when LLMs are unavailable."""
    actions: List[Dict[str, Any]] = []
    name = ctx["patient_name"].split()[0] if ctx["patient_name"] else "the patient"

    if ctx["missed"] > 0:
        med_str = f" ({', '.join(ctx['missed_names'])})" if ctx["missed_names"] else ""
        actions.append({
            "text": (
                f"Call {name} — {ctx['missed']} dose{'s' if ctx['missed'] > 1 else ''}{med_str} "
                f"{'were' if ctx['missed'] > 1 else 'was'} missed this week. A gentle check-in can help."
            ),
            "reason": "missed_doses",
            "confidence": 0.7,
        })
    else:
        actions.append({"text": f"{name} has been taking all medications on time. Send a short message of encouragement today.", "confidence": 0.6})

    if ctx["next_appt"]:
        try:
            dt = datetime.fromisoformat(ctx["next_appt"]["datetime"])
            days_away = (dt.date() - datetime.utcnow().date()).days
            if days_away <= 3:
                actions.append({
                    "text": (
                        f"Remind {name} about the appointment on {dt.strftime('%A')} at {ctx['next_appt']['location']} — it is in {days_away} day{'s' if days_away != 1 else ''}."
                    ),
                    "reason": "appointment",
                    "confidence": 0.6,
                })
            else:
                actions.append({
                    "text": (
                        f"Next appointment is {dt.strftime('%d %b')} at {ctx['next_appt']['location']}. Confirm transport arrangements with {name} this week."
                    ),
                    "reason": "appointment",
                    "confidence": 0.5,
                })
        except Exception:
            actions.append(f"Check with {name} whether they need help getting to their next appointment.")
    else:
        actions.append(f"No upcoming appointments found. Consider scheduling a check-up if adherence stays low.")

    # Risk-based recommendations
    if ctx["risk"] == "HIGH RISK":
        actions.append({
            "text": f"{name}'s adherence has dropped below 70%. Increase daily check-ins and inform the care team if no improvement.",
            "reason": "high_risk",
            "confidence": 0.85,
        })
    elif ctx["risk"] == "NEEDS FOLLOW-UP":
        actions.append({
            "text": f"Adherence is {ctx['adherence_pct']}% — encourage routines and consider a home visit this week.",
            "reason": "follow_up",
            "confidence": 0.6,
        })
    else:
        actions.append({"text": f"{name} is on track this week. A brief social call will help maintain motivation.", "confidence": 0.45})

    # Monitoring checklist and escalation suggestions
    monitoring: List[str] = []
    escalations: List[str] = []
    # If specific high-risk meds missed, recommend clinic/urgent escalation
    high_risk_keywords = ["warfarin", "insulin", "anticoag", "anticoagulant"]
    missed_lower = " ".join(ctx.get("missed_names", [])).lower()
    if any(k in missed_lower for k in high_risk_keywords):
        escalations.append("Contact clinician or bring patient to nearest clinic — critical medication was missed.")
        monitoring.append("Watch for dizziness, bleeding, confusion, sudden weakness — seek care if present.")
    else:
        monitoring.append("Check appetite, sleep, and mobility today; report any sudden changes.")

    # If many missed doses, suggest clinic visit
    if ctx.get("missed", 0) >= 3 or ctx.get("adherence_pct", 100) < 60:
        escalations.append("Consider scheduling a clinic visit for medication review within 48–72 hours.")

    return {
        "today_summary": ctx.get("today_summary"),
        "adherence_pct": ctx.get("adherence_pct"),
        "missed": ctx.get("missed"),
        "risk": {"level": ctx.get("risk"), "score": ctx.get("adherence_pct"), "reason": (", ".join(ctx.get("missed_names", [])) or None)},
        "monitoring": monitoring,
        "escalations": escalations,
        "actions": actions[:1],
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_caregiver_briefing(account_id: str, patient_user_id: str) -> Dict[str, Any]:
    """
    Return a caregiver briefing dict:
        {
            "patient_name": str,
            "risk": str,
            "adherence_pct": int,
            "actions": [str, str, str],
            "source": "llm" | "fallback",
        }
    Never raises — always returns something usable.
    """
    try:
        ctx = _gather_patient_context(account_id, patient_user_id)
    except (PermissionError, ValueError) as exc:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not load patient context: {exc}") from exc

    prompt = _build_prompt(ctx)

    # Use MERaLiON as the authoritative LLM for caregiver briefings (no Groq fallback)
    llm_result = _call_meralion(prompt)
    source = "llm" if llm_result else "fallback"

    # server-side confidence gating for escalations
    escalation_conf_threshold = float(os.environ.get("CAREGIVER_ESCALATION_CONF", "0.75"))

    if llm_result:
        # Merge LLM fields with context defaults
        # if confidence is present and below threshold, suppress high-severity escalations
        llm_conf = llm_result.get("confidence") if isinstance(llm_result.get("confidence"), (int, float)) else None
        escalations = llm_result.get("escalations") or []
        if llm_conf is not None and llm_conf < escalation_conf_threshold:
            escalations = []

        # Shorten action text for concise display
        raw_actions = llm_result.get("actions") or []
        short_actions: List[Dict[str, Any]] = []
        for a in raw_actions[:1]:
            if isinstance(a, dict):
                text = a.get("text") or a.get("action") or ""
                short_actions.append({
                    "text": _shorten_text(text),
                    "reason": a.get("reason"),
                    "confidence": a.get("confidence"),
                })
            else:
                short_actions.append({"text": _shorten_text(str(a))})

        result = {
            "patient_name": ctx["patient_name"],
            "risk": llm_result.get("risk") or {"level": ctx.get("risk"), "score": ctx.get("adherence_pct")},
            "adherence_pct": llm_result.get("adherence_pct") or ctx.get("adherence_pct"),
            "missed": llm_result.get("missed") or ctx.get("missed"),
            "today_summary": llm_result.get("today_summary") or ctx.get("today_summary"),
            "monitoring": llm_result.get("monitoring") or [],
            "escalations": escalations,
            "actions": short_actions,
            "confidence": llm_result.get("confidence"),
            "source": "llm",
        }
        return result

    # Fallback
    fb = _rule_based_actions(ctx)
    return {
        "patient_name": ctx["patient_name"],
        "risk": fb.get("risk"),
        "adherence_pct": fb.get("adherence_pct", ctx.get("adherence_pct")),
        "missed": fb.get("missed", ctx.get("missed")),
        "today_summary": fb.get("today_summary"),
        "monitoring": fb.get("monitoring", []),
        "escalations": fb.get("escalations", []),
        "actions": fb.get("actions", []),
        "source": "fallback",
    }


def generate_med_recommendations(account_id: str, patient_user_id: str, medication_id: str) -> Dict[str, Any]:
    """Generate focused, agentic next-step recommendations for a specific medication.
    Returns dict: { medication_id, medication_name, recommendations: [str], confidence: float|None, source }
    """
    try:
        ctx = _gather_patient_context(account_id, patient_user_id)
    except (PermissionError, ValueError):
        raise

    # locate med in context
    med = next((m for m in ctx.get("medications", []) if getattr(m, "medication_id", None) == medication_id or m.get("medication_id") == medication_id or m.get("name") and medication_id == m.get("name")), None)
    # med objects in ctx are minimal; also gather dose events filtered
    med_events = []
    try:
        from app.db import SessionLocal
        from app.models import DoseEvent
        with SessionLocal() as db:
            since = (datetime.utcnow() - timedelta(days=7)).isoformat(timespec="seconds")
            med_events = db.query(DoseEvent).filter(DoseEvent.user_id == patient_user_id, DoseEvent.medication_id == medication_id, DoseEvent.timestamp >= since).order_by(DoseEvent.timestamp.desc()).all()
    except Exception:
        med_events = []

    med_name = med.get("name") if isinstance(med, dict) else (med.name if med and hasattr(med, "name") else "medication")

    # build prompt
    prompt = (
        f"You are a clinical support assistant for a caregiver.\n"
        f"Patient: {ctx.get('patient_name')} (age {ctx.get('patient_age')})\n"
        f"Medication: {med_name}\n"
        f"Recent 7-day events: taken={sum(1 for e in med_events if e.response_status=='taken')}, missed={sum(1 for e in med_events if e.response_status=='missed')}, late={sum(1 for e in med_events if e.response_status=='late')}\n"
        "The caregiver needs 1 concise, practical next step they can take now or within 48 hours. Avoid prescribing; include when to contact clinician, what signs to watch for, simple home checks, and safe scheduling actions. Return ONLY JSON: { \"recommendations\": [..], \"confidence\": 0.0 }"
    )

    # Use MERaLiON for medication-specific recommendations (no Groq fallback)
    llm_result = _call_meralion(prompt)
    if llm_result:
        recs = llm_result.get("actions") or llm_result.get("recommendations") or []
        # normalize to strings and shorten
        recs_clean = [ (r.get('text') if isinstance(r, dict) else r) for r in recs ]
        recs_short = [ _shorten_text(str(r)) for r in recs_clean ]
        return {
            "medication_id": medication_id,
            "medication_name": med_name,
            "recommendations": [r for r in recs_short if r][:1],
            "confidence": llm_result.get("confidence"),
            "source": "llm",
        }

    # fallback rule-based recommendations
    # simple heuristics based on missed counts and high-risk keywords
    missed = sum(1 for e in med_events if e.response_status == "missed")
    is_high = bool(re.search(r"warfarin|insulin|anticoag", (med_name or ""), re.IGNORECASE))
    recs = []
    if missed > 0:
        recs.append(f"Call {ctx.get('patient_name').split()[0]} to check why {med_name} was missed; ask about symptoms and whether they have access to the medication.")
        recs.append("Help the patient take the missed dose now only if it's safe and within the schedule — otherwise document and contact clinician.")
    else:
        recs.append(f"Confirm {med_name} supply and help set a reminder if doses are often missed.")

    if is_high:
        recs.insert(0, "This medication is high-risk. If multiple doses are missed or patient shows worrying symptoms, contact clinician immediately or arrange urgent review.")
    else:
        recs.append("Encourage consistent timing and monitor for common side effects over the next 48 hours.")

    return {
        "medication_id": medication_id,
        "medication_name": med_name,
        "recommendations": recs[:1],
        "confidence": None,
        "source": "fallback",
    }
