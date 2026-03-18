"""Clinician AI Insights service — generates LLM-powered patient summaries.

Uses MERaLiON as primary provider (matching the pattern used by conversation_agent
and medication_education_agent), with Groq and OpenAI as fallbacks.
"""

from __future__ import annotations

import json
import os
import socket
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.services.meralion_client import MeralionClient, MeralionClientError



# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------

def _build_patient_context(patient_data: Dict[str, Any]) -> str:
    """Build a structured clinical context string from patient data for the LLM."""
    lines: List[str] = []

    p = patient_data.get("patient", {})
    lines.append(f"Patient: {p.get('name', 'Unknown')}, Age {p.get('age', 'N/A')}")
    conditions = p.get("conditions", [])
    if conditions:
        lines.append(f"Diagnoses: {', '.join(conditions)}")

    meds = patient_data.get("medications", [])
    if meds:
        lines.append(f"\nMedications ({len(meds)}):")
        for m in meds:
            sched = m.get("schedule", {})
            times = ", ".join(sched.get("times", []))
            lines.append(f"  - {m.get('name', '?')} {m.get('dose_text', '')} | {sched.get('frequency', '')} at {times} | criticality: {m.get('criticality', 'medium')}")

    adh = patient_data.get("adherence", {})
    if adh:
        lines.append(f"\nAdherence (last 7 days):")
        lines.append(f"  Current score: {adh.get('current_score', 0)}%  |  Prior week: {adh.get('prior_score', 0)}%  |  Delta: {adh.get('delta', 0)}%")
        lines.append(f"  Taken: {adh.get('taken', 0)}  |  Missed: {adh.get('missed', 0)}  |  Late: {adh.get('late', 0)}")

    drift = patient_data.get("drift", {})
    if drift:
        lines.append(f"\nDrift Detection:")
        lines.append(f"  Detected: {drift.get('drift_detected', False)}  |  Severity: {drift.get('severity', 'none')}  |  Trigger: {drift.get('trigger', 'N/A')}")

    interventions = patient_data.get("interventions", [])
    if interventions:
        lines.append(f"\nRecent Interventions ({len(interventions)}):")
        for iv in interventions[:5]:
            lines.append(f"  - [{iv.get('risk_level', '')}] {iv.get('action_type', '')} — {iv.get('message', '')}")

    tcm_warnings = patient_data.get("tcm_warnings", [])
    if tcm_warnings:
        lines.append(f"\nTCM Herb Interaction Warnings ({len(tcm_warnings)}):")
        for w in tcm_warnings:
            lines.append(f"  - {w.get('herb', '?')} ({w.get('risk_level', '')}) — affects: {', '.join(w.get('flagged_medications', []))}")

    food_recs = patient_data.get("food_recommendations", [])
    if food_recs:
        lines.append(f"\nFood Recommendations: {', '.join(food_recs[:5])}")

    community_count = patient_data.get("community_joined_count", 0)
    lines.append(f"\nCommunity activities joined this week: {community_count}")

    overall = patient_data.get("overall_status", "")
    if overall:
        lines.append(f"\nOverall Status: {overall}")

    return "\n".join(lines)


def _build_multi_patient_context(patients_data: List[Dict[str, Any]]) -> str:
    """Build a combined context string for all patients for the overall summary."""
    blocks: List[str] = []
    for i, pd in enumerate(patients_data, 1):
        p = pd.get("patient", {})
        adh = pd.get("adherence", {})
        drift = pd.get("drift", {})
        meds = pd.get("medications", [])
        tcm = pd.get("tcm_warnings", [])
        overall = pd.get("overall_status", "Unknown")

        block = f"--- Patient {i}: {p.get('name', 'Unknown')} ---"
        block += f"\nAge: {p.get('age', 'N/A')} | Conditions: {', '.join(p.get('conditions', [])) or 'None'}"
        block += f"\nMedications: {len(meds)} | Adherence: {adh.get('current_score', 0)}% (was {adh.get('prior_score', 0)}%)"
        block += f"\nDrift: {'Yes' if drift.get('drift_detected') else 'No'} ({drift.get('severity', 'none')})"
        block += f"\nInterventions this week: {len(pd.get('interventions', []))}"
        if tcm:
            block += f"\nTCM warnings: {len(tcm)}"
        block += f"\nOverall: {overall}"
        blocks.append(block)

    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

INDIVIDUAL_PROMPT = """You are ByteCare Clinical AI, an assistant for healthcare clinicians managing elderly patients' medication adherence and wellness in Singapore.

Given the patient data below, produce a concise clinical summary with the following sections:

1. **Clinical Summary** — A 2-3 sentence overview of the patient's current status, key conditions, and medication adherence trend.

2. **Key Observations** — 3-5 bullet points highlighting the most clinically relevant findings (adherence patterns, drift events, missed doses, herb interactions, lifestyle factors).

3. **Risk Assessment** — A short paragraph assessing potential risks (non-adherence, drug interactions, health deterioration) with a risk level (Low / Moderate / High).

4. **Recommended Actions** — 3-5 actionable suggestions for the clinician (medication adjustments, follow-up scheduling, patient education, caregiver involvement, etc.).

5. **Patient Engagement Tips** — 1-2 suggestions for improving the patient's engagement with their care plan (motivation strategies, community activities, dietary guidance).

Keep the language professional but concise. Use Singapore healthcare context where relevant (polyclinics, community health centres, TCM integration)."""

OVERALL_PROMPT = """You are ByteCare Clinical AI, an assistant for healthcare clinicians managing elderly patients' medication adherence and wellness in Singapore.

You are given data for ALL patients currently assigned to this clinician. Produce a concise overall panel summary with these sections:

1. **Panel Overview** — A 2-3 sentence summary of the clinician's patient panel: how many patients, overall adherence trend, general status.

2. **Priority Patients** — List patients who need immediate attention (poor adherence, active drift, high-risk interventions) with a brief reason for each.

3. **Panel Trends** — 3-5 bullet points on patterns across the panel (common conditions, average adherence, recurring issues, TCM safety concerns).

4. **Recommended Focus Areas** — 3-5 actionable suggestions for the clinician's workflow (which patients to review first, scheduling, common education gaps).

5. **Positive Highlights** — 1-2 bullet points on patients doing well or showing improvement — important for morale and care continuity.

Keep the language professional but concise. Use Singapore healthcare context where relevant."""


# ---------------------------------------------------------------------------
# LLM callers — Gemini primary, MeraLion / Groq / OpenAI fallbacks
# ---------------------------------------------------------------------------

def _call_gemini(prompt: str, context: str) -> str:
    """Call Google Gemini API (free tier) with retry for rate limits."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    model = "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = json.dumps({
        "contents": [{
            "parts": [{"text": f"{prompt}\n\n--- PATIENT DATA ---\n{context}"}]
        }],
        "generationConfig": {
            "temperature": 0.4,
            "topP": 0.9,
            "maxOutputTokens": 2048,
        },
    }).encode("utf-8")

    last_exc: Optional[Exception] = None
    for attempt in range(3):
        request = Request(
            url=url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
            parsed = json.loads(raw)
            candidates = parsed.get("candidates", [])
            if not candidates:
                raise RuntimeError("Gemini returned no candidates")
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                raise RuntimeError("Gemini returned empty parts")
            return parts[0].get("text", "").strip()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            last_exc = RuntimeError(f"Gemini failed ({exc.code}): {detail}")
            if exc.code == 429 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise last_exc from exc
        except (URLError, TimeoutError, socket.timeout) as exc:
            raise RuntimeError(f"Gemini failed: {exc}") from exc
    raise last_exc or RuntimeError("Gemini failed after retries")
    return parts[0].get("text", "").strip()


def _call_meralion(instruction: str) -> str:
    """Call MeraLion with retry + exponential backoff for 429 rate limits."""
    client = MeralionClient()
    if not client.enabled:
        raise MeralionClientError("MERALION_API_KEY is not set.")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            return client.chat(instruction, hyperparameters={"temperature": 0.4, "topP": 0.9})
        except MeralionClientError as exc:
            err_msg = str(exc)
            if "429" in err_msg and attempt < max_retries - 1:
                wait = (attempt + 1) * 3  # 3s, 6s, 9s
                time.sleep(wait)
                continue
            raise


def _call_groq(prompt: str, context: str) -> str:
    """Call Groq API (OpenAI-compatible) as fallback."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    base_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    model = os.getenv("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
    timeout = float(os.getenv("GROQ_TIMEOUT_SECONDS", "30"))

    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": context},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
    }).encode("utf-8")

    request = Request(
        url=f"{base_url}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Groq failed ({exc.code}): {detail}") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"Groq failed: {exc}") from exc

    parsed = json.loads(raw)
    choices = parsed.get("choices", [])
    if not choices:
        raise RuntimeError("Groq returned empty choices")
    return choices[0]["message"]["content"].strip()


def _call_openai(prompt: str, context: str) -> str:
    """Call OpenAI API as fallback."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    payload = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": context},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
    }).encode("utf-8")

    request = Request(
        url="https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI failed ({exc.code}): {detail}") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"OpenAI failed: {exc}") from exc

    parsed = json.loads(raw)
    choices = parsed.get("choices", [])
    if not choices:
        raise RuntimeError("OpenAI returned empty choices")
    return choices[0]["message"]["content"].strip()


# ---------------------------------------------------------------------------
# Dispatcher — tries MeraLion → Groq → OpenAI
# ---------------------------------------------------------------------------

def _llm_generate(system_prompt: str, context: str) -> Tuple[str, str]:
    """Try all providers in order. Returns (text, provider_name)."""
    errors: List[str] = []

    # 1) Gemini first (free tier, most reliable right now)
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if gemini_key:
        try:
            text = _call_gemini(system_prompt, context)
            if text and text.strip():
                return text.strip(), "gemini"
        except Exception as exc:
            errors.append(f"Gemini: {exc}")

    # 2) MeraLion fallback
    try:
        instruction = f"{system_prompt}\n\n--- PATIENT DATA ---\n{context}"
        text = _call_meralion(instruction)
        if text and text.strip():
            return text.strip(), "meralion"
    except Exception as exc:
        errors.append(f"MeraLion: {exc}")

    # 3) Groq fallback
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        try:
            text = _call_groq(system_prompt, context)
            if text and text.strip():
                return text.strip(), "groq"
        except Exception as exc:
            errors.append(f"Groq: {exc}")

    # 4) OpenAI fallback
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        try:
            text = _call_openai(system_prompt, context)
            if text and text.strip():
                return text.strip(), "openai"
        except Exception as exc:
            errors.append(f"OpenAI: {exc}")

    raise RuntimeError(f"All AI providers failed: {'; '.join(errors)}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_ai_summary(patient_data: Dict[str, Any]) -> Dict[str, Any]:
    """Generate an AI-powered clinical summary for a single patient."""
    context = _build_patient_context(patient_data)
    patient_name = patient_data.get("patient", {}).get("name", "Unknown")
    text, provider = _llm_generate(INDIVIDUAL_PROMPT, context)
    return {
        "patient_name": patient_name,
        "summary": text,
        "provider": provider,
        "status": "success",
    }


def generate_overall_summary(patients_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate an AI-powered overview summary across all assigned patients."""
    context = _build_multi_patient_context(patients_data)
    patient_count = len(patients_data)
    text, provider = _llm_generate(OVERALL_PROMPT, context)
    return {
        "patient_count": patient_count,
        "summary": text,
        "provider": provider,
        "status": "success",
    }
