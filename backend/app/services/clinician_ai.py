"""Clinician AI Insights service — generates LLM-powered patient summaries and recommendations."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional


def _build_patient_context(patient_data: Dict[str, Any]) -> str:
    """Build a structured clinical context string from patient data for the LLM."""
    lines: List[str] = []

    # Patient demographics
    p = patient_data.get("patient", {})
    lines.append(f"Patient: {p.get('name', 'Unknown')}, Age {p.get('age', 'N/A')}")
    conditions = p.get("conditions", [])
    if conditions:
        lines.append(f"Diagnoses: {', '.join(conditions)}")

    # Medications
    meds = patient_data.get("medications", [])
    if meds:
        lines.append(f"\nMedications ({len(meds)}):")
        for m in meds:
            sched = m.get("schedule", {})
            times = ", ".join(sched.get("times", []))
            lines.append(f"  - {m.get('name', '?')} {m.get('dose_text', '')} | {sched.get('frequency', '')} at {times} | criticality: {m.get('criticality', 'medium')}")

    # Adherence
    adh = patient_data.get("adherence", {})
    if adh:
        lines.append(f"\nAdherence (last 7 days):")
        lines.append(f"  Current score: {adh.get('current_score', 0)}%  |  Prior week: {adh.get('prior_score', 0)}%  |  Delta: {adh.get('delta', 0)}%")
        lines.append(f"  Taken: {adh.get('taken', 0)}  |  Missed: {adh.get('missed', 0)}  |  Late: {adh.get('late', 0)}")

    # Drift
    drift = patient_data.get("drift", {})
    if drift:
        lines.append(f"\nDrift Detection:")
        lines.append(f"  Detected: {drift.get('drift_detected', False)}  |  Severity: {drift.get('severity', 'none')}  |  Trigger: {drift.get('trigger', 'N/A')}")

    # Interventions
    interventions = patient_data.get("interventions", [])
    if interventions:
        lines.append(f"\nRecent Interventions ({len(interventions)}):")
        for iv in interventions[:5]:
            lines.append(f"  - [{iv.get('risk_level', '')}] {iv.get('action_type', '')} — {iv.get('message', '')}")

    # TCM warnings
    tcm_warnings = patient_data.get("tcm_warnings", [])
    if tcm_warnings:
        lines.append(f"\nTCM Herb Interaction Warnings ({len(tcm_warnings)}):")
        for w in tcm_warnings:
            lines.append(f"  - {w.get('herb', '?')} ({w.get('risk_level', '')}) — affects: {', '.join(w.get('flagged_medications', []))}")

    # Food / nutrition
    food_recs = patient_data.get("food_recommendations", [])
    if food_recs:
        lines.append(f"\nFood Recommendations: {', '.join(food_recs[:5])}")

    # Community
    community_count = patient_data.get("community_joined_count", 0)
    lines.append(f"\nCommunity activities joined this week: {community_count}")

    # Overall status
    overall = patient_data.get("overall_status", "")
    if overall:
        lines.append(f"\nOverall Status: {overall}")

    return "\n".join(lines)


SYSTEM_PROMPT = """You are ByteCare Clinical AI, an assistant for healthcare clinicians managing elderly patients' medication adherence and wellness in Singapore.

Given the patient data below, produce a concise clinical summary with the following sections:

1. **Clinical Summary** — A 2-3 sentence overview of the patient's current status, key conditions, and medication adherence trend.

2. **Key Observations** — 3-5 bullet points highlighting the most clinically relevant findings (adherence patterns, drift events, missed doses, herb interactions, lifestyle factors).

3. **Risk Assessment** — A short paragraph assessing potential risks (non-adherence, drug interactions, health deterioration) with a risk level (Low / Moderate / High).

4. **Recommended Actions** — 3-5 actionable suggestions for the clinician (medication adjustments, follow-up scheduling, patient education, caregiver involvement, etc.).

5. **Patient Engagement Tips** — 1-2 suggestions for improving the patient's engagement with their care plan (motivation strategies, community activities, dietary guidance).

Keep the language professional but concise. Use Singapore healthcare context where relevant (polyclinics, community health centres, TCM integration)."""


def _call_groq(prompt: str, patient_context: str) -> str:
    """Call Groq API (OpenAI-compatible) for AI summary generation."""
    import json as _json
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
    import socket

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    base_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    model = os.getenv("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
    timeout = float(os.getenv("GROQ_TIMEOUT_SECONDS", "30"))

    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": patient_context},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
    }

    url = f"{base_url}/chat/completions"
    body = _json.dumps(payload).encode("utf-8")
    request = Request(
        url=url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Groq request failed ({exc.code}): {detail}") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    parsed = _json.loads(raw)
    choices = parsed.get("choices", [])
    if not choices:
        raise RuntimeError("Groq returned empty choices")
    return choices[0]["message"]["content"].strip()


def _call_meralion(prompt: str, patient_context: str) -> str:
    """Call MeraLion API for AI summary generation."""
    from app.services.meralion_client import MeralionClient, MeralionClientError

    client = MeralionClient()
    if not client.enabled:
        raise RuntimeError("MERALION_API_KEY not configured")

    instruction = f"{prompt}\n\n--- PATIENT DATA ---\n{patient_context}"
    return client.chat(instruction)


def _call_openai(prompt: str, patient_context: str) -> str:
    """Call OpenAI API for AI summary generation."""
    import json as _json
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
    import socket

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": patient_context},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
    }

    url = "https://api.openai.com/v1/chat/completions"
    body = _json.dumps(payload).encode("utf-8")
    request = Request(
        url=url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI request failed ({exc.code}): {detail}") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    parsed = _json.loads(raw)
    choices = parsed.get("choices", [])
    if not choices:
        raise RuntimeError("OpenAI returned empty choices")
    return choices[0]["message"]["content"].strip()


def generate_ai_summary(patient_data: Dict[str, Any]) -> Dict[str, Any]:
    """Generate an AI-powered clinical summary for a patient.

    Tries Groq first (fastest), then OpenAI, then MeraLion.
    Returns a dict with the generated summary text and metadata.
    """
    patient_context = _build_patient_context(patient_data)
    patient_name = patient_data.get("patient", {}).get("name", "Unknown")

    errors: List[str] = []
    summary_text = ""
    provider_used = ""

    # Try Groq first
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        try:
            summary_text = _call_groq(SYSTEM_PROMPT, patient_context)
            provider_used = "groq"
        except Exception as exc:
            errors.append(f"Groq: {exc}")

    # Fallback to OpenAI
    if not summary_text:
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        if openai_key:
            try:
                summary_text = _call_openai(SYSTEM_PROMPT, patient_context)
                provider_used = "openai"
            except Exception as exc:
                errors.append(f"OpenAI: {exc}")

    # Fallback to MeraLion
    if not summary_text:
        meralion_key = os.getenv("MERALION_API_KEY", "").strip()
        if meralion_key:
            try:
                summary_text = _call_meralion(SYSTEM_PROMPT, patient_context)
                provider_used = "meralion"
            except Exception as exc:
                errors.append(f"MeraLion: {exc}")

    if not summary_text:
        raise RuntimeError(f"All AI providers failed: {'; '.join(errors)}")

    return {
        "patient_name": patient_name,
        "summary": summary_text,
        "provider": provider_used,
        "status": "success",
    }
