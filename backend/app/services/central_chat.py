"""Central AI chatbot engine — integrates patient data, meds, appointments,
adherence tracking, and TCM safety results into a single conversational
assistant powered by MERaLiON.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Appointment, DoseEvent, Medication, MesScore, User
from app.services.adherence_tracker import (
    check_missed_doses,
    get_adherence_history,
    get_todays_events,
)
from app.services.drift_engine import detect_adherence_drift
from app.services.meralion_client import MeralionClient, MeralionClientError
from app.services.tcm_engine import HERB_INTERACTIONS, detect_herb_from_text, _check_medication_overlap


# ---------------------------------------------------------------------------
# Context builders — gather all relevant patient data
# ---------------------------------------------------------------------------

def _build_patient_context(user_id: str) -> Dict[str, Any]:
    """Collect patient profile, medications, appointments, adherence, and drift."""
    with SessionLocal() as db:
        user_obj = db.query(User).filter_by(user_id=user_id).first()
        if not user_obj:
            raise HTTPException(status_code=404, detail="User not found")
        user = user_obj.to_dict()

        meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]

        appts = (
            db.query(Appointment)
            .filter_by(user_id=user_id)
            .all()
        )
        appt_list = [a.to_dict() for a in appts]

    # Upcoming appointments (future only)
    now = datetime.now()
    upcoming = []
    for a in appt_list:
        try:
            adt = datetime.fromisoformat(a["datetime"])
            # Strip timezone info for comparison with naive datetime.now()
            adt_naive = adt.replace(tzinfo=None)
            if adt_naive > now:
                days = (adt_naive.date() - now.date()).days
                upcoming.append({**a, "days_remaining": days})
        except (ValueError, TypeError):
            pass
    upcoming.sort(key=lambda x: x["datetime"])

    # Adherence
    todays = get_todays_events(user_id)
    missed = check_missed_doses(user_id)
    history = get_adherence_history(user_id, days=7)

    # Drift
    try:
        drift = detect_adherence_drift(user_id)
    except Exception:
        drift = {"drift_detected": False, "severity": "green", "trigger": "none", "details": {}}

    return {
        "user": user,
        "medications": meds,
        "upcoming_appointments": upcoming[:3],
        "todays_events": todays,
        "missed_doses_today": missed,
        "adherence_history_7d": history,
        "drift": drift,
        "med_names": [m["name"].lower() for m in meds],
    }


def _format_context_for_prompt(ctx: Dict[str, Any]) -> str:
    """Serialize patient context into a compact text block for the LLM prompt."""
    u = ctx["user"]
    lines = [
        f"Patient: {u.get('name','Unknown')}, age {u.get('age','?')}, conditions: {u.get('conditions','none')}",
    ]

    # Medications
    if ctx["medications"]:
        med_strs = []
        for m in ctx["medications"]:
            times = m.get("schedule", {}).get("times", [])
            med_strs.append(f"  - {m['name']} ({m.get('dose_text','')}) at {', '.join(times)}, criticality={m.get('criticality','medium')}")
        lines.append("Medications:\n" + "\n".join(med_strs))
    else:
        lines.append("Medications: none recorded")

    # Upcoming appointments
    if ctx["upcoming_appointments"]:
        for a in ctx["upcoming_appointments"]:
            lines.append(f"Appointment: {a['datetime']} at {a.get('location','?')} ({a.get('days_remaining','?')} days away) — {a.get('notes','')}")
    else:
        lines.append("No upcoming appointments.")

    # Today's adherence
    if ctx["todays_events"]:
        for ev in ctx["todays_events"]:
            lines.append(f"Today {ev['medication_name']} @ {ev['scheduled_time']}: {ev['status']}" +
                         (f" (taken at {ev['taken_time']})" if ev.get("taken_time") else ""))
    else:
        lines.append("No medication events today yet.")

    # Missed today
    if ctx["missed_doses_today"]:
        names = [m["medication_name"] for m in ctx["missed_doses_today"]]
        lines.append(f"MISSED today: {', '.join(names)}")

    # 7d summary
    if ctx["adherence_history_7d"]:
        avg_pct = round(sum(d["adherence_pct"] for d in ctx["adherence_history_7d"]) / len(ctx["adherence_history_7d"]))
        total_missed = sum(d["missed"] for d in ctx["adherence_history_7d"])
        lines.append(f"7-day adherence: {avg_pct}% avg, {total_missed} missed doses total")

    # Drift
    d = ctx["drift"]
    if d.get("drift_detected"):
        lines.append(f"Drift ALERT: severity={d['severity']}, trigger={d['trigger']}")

    # TCM context (injected when available)
    tcm = ctx.get("tcm_result")
    if tcm and tcm.get("herb_detected"):
        risk = tcm.get("risk_level", "unknown")
        herb = tcm["herb_detected"]
        flagged = tcm.get("flagged_medications", [])
        lines.append(f"Latest TCM check: {herb} — risk={risk}")
        if flagged:
            lines.append(f"  Flagged medications: {', '.join(flagged)}")
        lines.append(f"  Guidance: {tcm.get('message', 'N/A')}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Proactive alerts — event-driven messages
# ---------------------------------------------------------------------------

def get_proactive_alerts(user_id: str, tcm_result: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
    """Generate proactive alert messages based on current patient state."""
    alerts: List[Dict[str, str]] = []
    ctx = _build_patient_context(user_id)

    # 1) Missed medication
    if ctx["missed_doses_today"]:
        names = [m["medication_name"] for m in ctx["missed_doses_today"]]
        alerts.append({
            "type": "missed_medication",
            "message": f"It looks like you missed your {', '.join(names)} today. Would you like a reminder?",
        })

    # 2) Appointment coming soon (within 2 days)
    for a in ctx["upcoming_appointments"]:
        if a.get("days_remaining", 99) <= 2:
            alerts.append({
                "type": "appointment_soon",
                "message": f"You have an appointment at {a.get('location','the clinic')} on {a['datetime'][:10]}. Don't forget!",
            })

    # 3) Drift detected
    drift = ctx["drift"]
    if drift.get("drift_detected") and drift.get("severity") in ("orange", "red"):
        alerts.append({
            "type": "adherence_drift",
            "message": "I noticed your medication adherence has been dropping. Let's try to get back on track — shall I help?",
        })

    # 4) Low adherence
    if ctx["adherence_history_7d"]:
        avg = sum(d["adherence_pct"] for d in ctx["adherence_history_7d"]) / len(ctx["adherence_history_7d"])
        if avg < 70:
            alerts.append({
                "type": "low_adherence",
                "message": f"Your 7-day adherence is around {round(avg)}%. Let me know if you need help managing your schedule.",
            })

    # 5) High-risk TCM interaction (passed from frontend context)
    if tcm_result and tcm_result.get("risk_level") == "high":
        herb = tcm_result.get("herb_detected", "an herb")
        alerts.append({
            "type": "tcm_high_risk",
            "message": f"A high-risk interaction was detected between {herb} and your medications. Please consult your doctor before using it.",
        })

    return alerts


# ---------------------------------------------------------------------------
# Main chat handler
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are ByteCare, a friendly AI health assistant for elderly patients in Singapore. "
    "You have access to the patient's full medical profile, medication schedule, appointment "
    "calendar, medication adherence data from their Smart Pill Box, and TCM herb-drug "
    "interaction safety results.\n\n"
    "Safety rules you MUST follow:\n"
    "1) NEVER provide medical diagnosis.\n"
    "2) NEVER recommend starting, stopping, or changing medications or dosages.\n"
    "3) If the patient asks about diagnosis or medication changes, advise them to consult their doctor or pharmacist.\n"
    "4) Keep responses short, calm, and supportive (1-3 simple sentences).\n"
    "5) Use very simple language. Avoid medical jargon. Speak like you are talking to a grandparent.\n"
    "6) Light Singlish phrasing is okay (lah, leh, lor) but keep it respectful.\n"
    "7) Be warm and encouraging, never dismissive or patronizing.\n"
    "8) Ask only ONE question at a time. Do not overload the patient.\n"
    "9) When the patient says 'yes', 'not yet', 'I forgot', or 'remind me later', respond naturally.\n\n"
    "You can answer questions about:\n"
    "- Whether they took their medicine today\n"
    "- When their next doctor visit is\n"
    "- Whether a herb is safe with their medicines\n"
    "- Medicine refill reminders\n"
    "- Words of encouragement\n\n"
    "Output ONLY the patient-facing reply. No JSON, no internal reasoning."
)


def _explain_tcm_result(tcm_result: Dict[str, Any], ctx: Dict[str, Any]) -> str:
    """Generate a plain-language explanation of a TCM interaction result."""
    herb = tcm_result.get("herb_detected", "this herb")
    risk = tcm_result.get("risk_level", "unknown")
    flagged = tcm_result.get("flagged_medications", [])
    guidance = tcm_result.get("message", "")
    name = ctx["user"].get("name", "there")

    # Look up from the canonical HERB_INTERACTIONS database
    herb_key = detect_herb_from_text(herb) if herb else None
    if herb_key and herb_key in HERB_INTERACTIONS:
        db_entry = HERB_INTERACTIONS[herb_key]
        guidance = db_entry["guidance"]
        risk = db_entry["risk_level"]

    parts = [f"Hi {name}, regarding {herb}:"]
    if risk == "high":
        parts.append(f"This is a HIGH-risk interaction.")
    elif risk == "moderate":
        parts.append(f"This is a moderate-risk interaction.")
    elif risk == "low":
        parts.append(f"This is considered low risk, but still worth noting.")

    if guidance:
        parts.append(guidance)
    if flagged:
        parts.append(f"Your affected medications: {', '.join(flagged)}.")
    if risk in ("high", "moderate"):
        parts.append("Please consult your doctor or pharmacist before using it.")

    return " ".join(parts)


def _rule_based_fallback(message: str, ctx: Dict[str, Any], tcm_result: Optional[Dict[str, Any]] = None) -> str:
    """Generate a rule-based reply when MERaLiON is unavailable."""
    msg_lower = message.lower()
    name = ctx["user"].get("name", "there")

    # If user asks about herbs/TCM and a result is available, explain it
    if any(w in msg_lower for w in ["herb", "tcm", "ginseng", "ginkgo", "traditional", "herbal",
                                     "safe", "interaction", "scan", "risk"]):
        if tcm_result and tcm_result.get("herb_detected"):
            return _explain_tcm_result(tcm_result, ctx)

    # If user mentions a specific herb name, look it up directly
    herb_key = detect_herb_from_text(msg_lower)
    if herb_key and herb_key in HERB_INTERACTIONS:
        info = HERB_INTERACTIONS[herb_key]
        med_names = ctx.get("med_names", [])
        flagged = _check_medication_overlap(herb_key, med_names)
        synthetic_result = {
            "herb_detected": info["display_name"],
            "risk_level": info["risk_level"],
            "flagged_medications": flagged,
            "message": info["guidance"],
        }
        return _explain_tcm_result(synthetic_result, ctx)

    if any(w in msg_lower for w in ["miss", "forgot", "skip", "didn't take", "i forgot"]):
        missed = ctx["missed_doses_today"]
        if missed:
            names = ", ".join(m["medication_name"] for m in missed)
            return f"{name}, it looks like you missed {names} today. If you can still take it, please do. Otherwise, no worries \u2014 just take the next one on time."
        return f"Good news, {name}! You haven't missed any medicine today. Keep it up!"

    if any(w in msg_lower for w in ["yes", "took it", "taken", "already took", "done"]):
        return f"That's great, {name}! Well done for taking your medicine on time. Keep going!"

    if any(w in msg_lower for w in ["not yet", "haven't", "later", "remind me"]):
        return f"No problem, {name}. I'll be here when you're ready. Try not to forget, okay?"

    if any(w in msg_lower for w in ["appointment", "next visit", "doctor visit", "clinic", "doctor"]):
        appts = ctx["upcoming_appointments"]
        if appts:
            a = appts[0]
            return f"Your next doctor visit is on {a['datetime'][:10]} at {a.get('location','the clinic')}. That's {a.get('days_remaining','a few')} day(s) away."
        return f"{name}, I don't see any upcoming visits. Would you like to schedule one?"

    if any(w in msg_lower for w in ["herb", "tcm", "traditional", "herbal"]):
        if tcm_result and tcm_result.get("herb_detected"):
            return _explain_tcm_result(tcm_result, ctx)
        return f"{name}, for herb safety checks you can use the Health tab, or just ask me about a specific herb by name!"

    if any(w in msg_lower for w in ["restock", "refill", "running out", "low", "supply"]):
        return f"Good thinking, {name}! Check with your pharmacy about when to get more medicine."

    if any(w in msg_lower for w in ["how am i", "adherence", "doing well", "track", "how doing"]):
        history = ctx["adherence_history_7d"]
        if history:
            avg = round(sum(d["adherence_pct"] for d in history) / len(history))
            encouragement = "Wonderful job!" if avg >= 80 else "Let's try to do better together!"
            return f"{name}, this week you took your medicine about {avg}% of the time. {encouragement}"
        return f"{name}, I don't have enough data yet. Keep using your pill box and I'll track how you're doing!"

    if any(w in msg_lower for w in ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"]):
        return f"Hello {name}! How are you feeling today? Did you take your morning medicine?"

    if any(w in msg_lower for w in ["thank", "thanks"]):
        return f"You're welcome, {name}! I'm always here if you need help."

    if any(w in msg_lower for w in ["what", "medication", "medicine", "taking", "my med"]):
        meds = ctx["medications"]
        if meds:
            names = ", ".join(m["name"] for m in meds)
            return f"{name}, you are taking: {names}. Let me know if you have any questions about them."
        return f"{name}, I don't see any medicines on your list yet."

    return f"Hello {name}, I'm ByteCare, your health helper. You can ask me about your medicines, doctor visits, or how you're doing. How can I help?"


_LANG_NAMES = {"en": "English", "zh": "Chinese", "ms": "Malay", "ta": "Tamil"}


def _maybe_translate(text: str, lang: str, client: MeralionClient) -> str:
    """Translate reply to the selected language if not English."""
    if lang == "en" or not lang:
        return text
    target = _LANG_NAMES.get(lang, lang)
    if not client.enabled:
        return text
    try:
        prompt = (
            f"Translate the following text to {target}. "
            "Keep it simple and easy for elderly to understand. "
            "Output ONLY the translation, nothing else.\n\n"
            f"{text}"
        )
        return client.chat(prompt, hyperparameters={"temperature": 0.1, "topP": 0.9})
    except MeralionClientError:
        return text


def chat_with_context(
    user_id: str,
    message: str,
    tcm_result: Optional[Dict[str, Any]] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    lang: str = "en",
) -> Dict[str, Any]:
    """Central chatbot entry point — gathers full patient context,
    generates proactive alerts, and produces an AI reply."""

    ctx = _build_patient_context(user_id)
    alerts = get_proactive_alerts(user_id, tcm_result)
    context_text = _format_context_for_prompt(ctx)

    # Build conversation for MERaLiON
    client = MeralionClient()

    # Inject TCM result into context for prompt formatting
    if tcm_result:
        ctx["tcm_result"] = tcm_result

    if not client.enabled:
        reply = _rule_based_fallback(message, ctx, tcm_result)
        reply = _maybe_translate(reply, lang, client)
        return {
            "reply": reply,
            "alerts": alerts,
            "context": {
                "drift_detected": ctx["drift"].get("drift_detected", False),
                "severity": ctx["drift"].get("severity", "green"),
                "missed_today": len(ctx["missed_doses_today"]),
                "adherence_7d_avg": _avg_adherence(ctx),
                "upcoming_appointments": len(ctx["upcoming_appointments"]),
            },
        }

    # Build full prompt
    prompt = (
        f"{_SYSTEM_PROMPT}\n\n"
        f"=== PATIENT DATA ===\n{context_text}\n\n"
    )

    # Include TCM context if provided
    if tcm_result:
        prompt += (
            f"=== RECENT TCM CHECK ===\n"
            f"Herb: {tcm_result.get('herb_detected', 'unknown')}\n"
            f"Risk: {tcm_result.get('risk_level', 'unknown')}\n"
            f"Message: {tcm_result.get('message', '')}\n"
            f"Flagged meds: {tcm_result.get('flagged_medications', [])}\n\n"
        )

    # Auto-detect herb mentions and inject safety data into prompt
    herb_key = detect_herb_from_text(message)
    if herb_key and herb_key in HERB_INTERACTIONS and not tcm_result:
        info = HERB_INTERACTIONS[herb_key]
        med_names = ctx.get("med_names", [])
        flagged = _check_medication_overlap(herb_key, med_names)
        prompt += (
            f"=== HERB SAFETY LOOKUP (auto-detected) ===\n"
            f"Herb: {info['display_name']}\n"
            f"Risk level: {info['risk_level']}\n"
            f"Guidance: {info['guidance']}\n"
            f"Patient medications flagged: {flagged if flagged else 'none'}\n"
            f"Use this data to answer the patient's question about this herb.\n\n"
        )

    # Add conversation history for continuity
    if conversation_history:
        prompt += "=== RECENT CONVERSATION ===\n"
        for msg in conversation_history[-6:]:  # last 6 messages for context
            role = "Patient" if msg.get("sender") == "user" else "ByteCare"
            prompt += f"{role}: {msg.get('text', '')}\n"
        prompt += "\n"

    prompt += f"Patient says: {message}\nByteCare reply:"

    try:
        reply = client.chat(prompt, hyperparameters={"temperature": 0.3, "topP": 0.9})
    except MeralionClientError:
        reply = _rule_based_fallback(message, ctx, tcm_result)

    # Translate if non-English language selected
    reply = _maybe_translate(reply, lang, client)

    return {
        "reply": reply,
        "alerts": alerts,
        "context": {
            "drift_detected": ctx["drift"].get("drift_detected", False),
            "severity": ctx["drift"].get("severity", "green"),
            "missed_today": len(ctx["missed_doses_today"]),
            "adherence_7d_avg": _avg_adherence(ctx),
            "upcoming_appointments": len(ctx["upcoming_appointments"]),
        },
    }


def _avg_adherence(ctx: Dict[str, Any]) -> int:
    history = ctx.get("adherence_history_7d", [])
    if not history:
        return 100
    return round(sum(d["adherence_pct"] for d in history) / len(history))
