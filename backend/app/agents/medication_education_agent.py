"""Medication Education Agent — explains medications simply and empathetically.

Handles patient education questions such as:
  - Why do I take this medicine?
  - What is metformin for?
  - What happens if I skip my blood pressure medicine?
  - How does this pill help me?

Safety rules (hard-coded, never overridden by LLM):
  - Never diagnose conditions
  - Never advise changing, stopping, or skipping doses
  - Always redirect medical decisions to doctor or caregiver

Uses MERaLiON for patient-friendly, empathetic language generation.
Falls back to safe templates if MERaLiON is unavailable.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from app.services.meralion_client import MeralionClient, MeralionClientError

# ---------------------------------------------------------------------------
# General medication knowledge base (safe, non-clinical descriptions only)
# ---------------------------------------------------------------------------

_MED_INFO: Dict[str, Dict[str, str]] = {
    "metformin": {
        "use": "control blood sugar levels",
        "condition": "type 2 diabetes",
        "importance": "helps prevent complications from high blood sugar over time",
    },
    "lisinopril": {
        "use": "lower blood pressure",
        "condition": "high blood pressure or heart conditions",
        "importance": "helps protect your heart and kidneys from damage",
    },
    "atorvastatin": {
        "use": "lower cholesterol levels",
        "condition": "high cholesterol",
        "importance": "helps reduce the risk of heart disease and stroke",
    },
    "aspirin": {
        "use": "thin the blood and reduce inflammation",
        "condition": "heart disease prevention",
        "importance": "helps prevent heart attacks and blood clots",
    },
    "amlodipine": {
        "use": "relax blood vessels and lower blood pressure",
        "condition": "high blood pressure or chest pain",
        "importance": "helps keep your blood pressure at a safe level",
    },
    "omeprazole": {
        "use": "reduce stomach acid",
        "condition": "acid reflux or stomach ulcers",
        "importance": "helps protect your stomach lining and reduce discomfort",
    },
    "simvastatin": {
        "use": "lower cholesterol levels",
        "condition": "high cholesterol",
        "importance": "helps reduce the risk of heart disease",
    },
    "warfarin": {
        "use": "prevent blood clots",
        "condition": "conditions that increase clot risk such as atrial fibrillation",
        "importance": "helps prevent dangerous clots in your blood vessels",
    },
    "losartan": {
        "use": "lower blood pressure",
        "condition": "high blood pressure or kidney disease",
        "importance": "helps protect your kidneys and heart",
    },
    "glipizide": {
        "use": "lower blood sugar levels",
        "condition": "type 2 diabetes",
        "importance": "helps control your blood sugar throughout the day",
    },
    "furosemide": {
        "use": "remove excess fluid from your body",
        "condition": "heart failure or fluid retention",
        "importance": "helps reduce swelling and makes it easier to breathe",
    },
    "insulin": {
        "use": "regulate blood sugar levels",
        "condition": "diabetes",
        "importance": "helps your body use sugar properly for energy",
    },
    "salbutamol": {
        "use": "open up the airways in your lungs",
        "condition": "asthma or breathing difficulties",
        "importance": "provides quick relief when you feel breathless or wheezy",
    },
    "prednisolone": {
        "use": "reduce inflammation",
        "condition": "inflammatory conditions or allergies",
        "importance": "helps calm inflammation in your body",
    },
    "ramipril": {
        "use": "lower blood pressure",
        "condition": "high blood pressure or heart failure",
        "importance": "helps protect your heart and kidneys",
    },
    "bisoprolol": {
        "use": "slow the heart rate and lower blood pressure",
        "condition": "heart failure or high blood pressure",
        "importance": "helps your heart work more efficiently",
    },
    "clopidogrel": {
        "use": "prevent blood clots",
        "condition": "heart disease or stroke prevention",
        "importance": "helps keep your blood flowing smoothly",
    },
    "glibenclamide": {
        "use": "lower blood sugar levels",
        "condition": "type 2 diabetes",
        "importance": "helps keep your blood sugar within a safe range",
    },
    "thyroxine": {
        "use": "replace thyroid hormone",
        "condition": "underactive thyroid (hypothyroidism)",
        "importance": "helps your body maintain normal energy and metabolism",
    },
}

# Regex to extract a known medicine name from the message
_KNOWN_MED_RE = re.compile(
    r"\b(metformin|lisinopril|atorvastatin|aspirin|amlodipine|omeprazole|simvastatin|"
    r"warfarin|losartan|glipizide|furosemide|insulin|salbutamol|prednisolone|"
    r"ramipril|bisoprolol|clopidogrel|glibenclamide|thyroxine)\b",
    re.IGNORECASE,
)

# Pattern: "what happens if I skip/miss/forget"
_SKIP_QUESTION_RE = re.compile(
    r"\b(what happens?|what will happen|what if) (if )?(i )?(skip|miss|don.?t take|stop|forget)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_medicine_name(message: str, patient_medications: List[Dict]) -> Optional[str]:
    """Identify the medicine being asked about.

    Priority:
      1. Known medicine name mentioned explicitly in the message.
      2. Any of the patient's own medication names found in the message.
      3. If the patient refers to 'this/my medicine' generically and only has one medication.
    """
    # 1. Known medicine name in message
    match = _KNOWN_MED_RE.search(message)
    if match:
        return match.group(1).lower()

    # 2. Patient's medication names in message
    msg_lower = message.lower()
    for med in patient_medications:
        name = med.get("name", "").strip().lower()
        if name and name in msg_lower:
            return name

    # 3. Generic reference with single medication
    if len(patient_medications) == 1 and re.search(
        r"\b(this|my|the)\s+(medicine|medication|pill|tablet|drug)\b", message, re.IGNORECASE
    ):
        return patient_medications[0].get("name", "").strip().lower() or None

    return None


def _get_patient_med(med_name: str, patient_medications: List[Dict]) -> Optional[Dict]:
    """Return the patient's medication record matching med_name (case-insensitive)."""
    if not med_name:
        return None
    for med in patient_medications:
        if med.get("name", "").strip().lower() == med_name.lower():
            return med
    return None


# ---------------------------------------------------------------------------
# Prompt construction for MERaLiON
# ---------------------------------------------------------------------------

def _build_education_prompt(
    user: Dict[str, Any],
    message: str,
    med_name: Optional[str],
    patient_med: Optional[Dict],
    patient_medications: List[Dict],
    med_info: Optional[Dict],
) -> str:
    patient_name = user.get("name", "Patient")
    conditions = ", ".join(user.get("conditions") or []) or "not specified"

    if med_name:
        dose = (patient_med.get("dose") or "as prescribed") if patient_med else "as prescribed"
        info_use = med_info.get("use", "help manage your condition") if med_info else "help manage your condition"
        info_condition = med_info.get("condition", "your medical condition") if med_info else "your medical condition"
        info_importance = med_info.get("importance", "support your health") if med_info else "support your health"
        med_context = (
            f"Medicine being asked about: {med_name} ({dose})\n"
            f"General purpose: {info_use}\n"
            f"Typically prescribed for: {info_condition}\n"
            f"Why it matters: {info_importance}\n"
        )
    else:
        all_meds = (
            "; ".join(f"{m['name']} ({m.get('dose', 'dose not specified')})" for m in patient_medications)
            or "none recorded"
        )
        med_context = f"Patient's current medications: {all_meds}\n"

    return (
        "You are ByteCare, a caring medication support assistant for older adults in Singapore.\n"
        "Your role is to explain medications in a simple, warm, and supportive way.\n\n"
        "Safety rules (must follow strictly):\n"
        "1. Do NOT diagnose medical conditions.\n"
        "2. Do NOT advise the patient to change, skip, or stop their medication.\n"
        "3. Do NOT suggest dose changes or timing changes.\n"
        "4. For any medical decision, always say: please check with your doctor or caregiver.\n"
        "5. Keep your response to 2-3 short, clear sentences (max 60 words).\n"
        "6. Use simple words suitable for elderly users.\n"
        "7. Be warm, calm, and supportive — like a caring family member.\n"
        "8. Light Singlish tone is okay (lah, leh, lor).\n\n"
        f"Patient: {patient_name}, age {user.get('age', 'unknown')}\n"
        f"Patient's conditions: {conditions}\n"
        f"{med_context}\n"
        f"Patient question: {message}\n"
        "Reply (warm, simple, 2-3 sentences max):"
    )


# ---------------------------------------------------------------------------
# Template fallback (no MERaLiON key or network failure)
# ---------------------------------------------------------------------------

def _template_education_reply(
    name: str,
    med_name: Optional[str],
    med_info: Optional[Dict],
    patient_medications: List[Dict],
    message: str,
) -> str:
    """Return a safe, empathetic template reply when MERaLiON is unavailable."""
    is_skip_question = bool(_SKIP_QUESTION_RE.search(message))

    if med_name and med_info:
        use = med_info["use"]
        importance = med_info["importance"]
        if is_skip_question:
            return (
                f"Missing {med_name} sometimes may make it harder to keep your condition stable. "
                f"It is best to take it as prescribed lah. "
                f"If you are unsure, please check with your doctor."
            )
        return (
            f"{name}, {med_name} helps {use}. "
            f"Taking it regularly {importance}. "
            f"If you have more questions, do check with your doctor lah."
        )

    if med_name:
        # Medicine name found but not in our knowledge base
        if is_skip_question:
            return (
                f"Missing your {med_name} sometimes may affect how well your condition is managed. "
                f"It is best to take it as prescribed. "
                f"Please check with your doctor or caregiver if you are unsure."
            )
        return (
            f"{name}, your {med_name} is prescribed to help manage your condition. "
            f"Taking it regularly as prescribed helps keep things stable. "
            f"If you would like to know more, please check with your doctor lah."
        )

    if patient_medications:
        if is_skip_question:
            return (
                f"{name}, missing doses sometimes may make it harder to keep your condition well-managed. "
                f"It is best to take your medication as prescribed. "
                f"If you have concerns, please check with your doctor or caregiver."
            )
        return (
            f"{name}, your medications are prescribed to help manage your health condition. "
            f"Taking them regularly helps keep things stable and prevents complications. "
            f"For questions about a specific medicine, please ask your doctor lah."
        )

    return (
        f"{name}, I understand it can feel confusing to manage medications. "
        f"Your medicines are prescribed to help keep your condition stable. "
        f"For specific questions about your treatment, please check with your doctor or caregiver."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_education_reply(
    user_id: str,
    message: str,
    user: Dict[str, Any],
    medications: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Generate a medication education reply.

    Args:
        user_id:     Patient identifier (passed for future context extension).
        message:     The patient's question.
        user:        Patient profile dict (name, age, conditions, etc.).
        medications: List of patient's medication records.

    Returns:
        {
            "reply":                  str  — patient-facing explanation,
            "tone":                   str  — always "empathetic",
            "intent":                 str  — always "medication_education",
            "suggested_action":       str  — always "none",
            "reminder_mode":          None,
            "reminder_delay_seconds": None,
        }
    """
    patient_name = user.get("name", "Patient")

    med_name = _extract_medicine_name(message, medications)
    patient_med = _get_patient_med(med_name, medications) if med_name else None
    med_info = _MED_INFO.get(med_name.lower()) if med_name else None

    client = MeralionClient()
    reply: Optional[str] = None

    if client.enabled:
        prompt = _build_education_prompt(
            user, message, med_name, patient_med, medications, med_info
        )
        try:
            raw = client.chat(prompt, hyperparameters={"temperature": 0.4, "topP": 0.9})
            if raw and raw.strip():
                reply = raw.strip()
        except MeralionClientError:
            reply = None

    if not reply:
        reply = _template_education_reply(
            patient_name, med_name, med_info, medications, message
        )

    return {
        "reply": reply,
        "tone": "empathetic",
        "intent": "medication_education",
        "suggested_action": "none",
        "reminder_mode": None,
        "reminder_delay_seconds": None,
    }
