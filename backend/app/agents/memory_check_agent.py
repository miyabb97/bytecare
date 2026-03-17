"""Memory & Focus Check agent — standalone cognitive check-in feature.

Uses MERaLiON (LLM) for:
  1. Generating daily check-in questions (orientation, recall, attention)
  2. Generating friendly insight messages based on deterministic status
  3. Generating trend analysis from past session history

Scoring and status determination are fully deterministic — NO LLM involved.
This feature is independent from medication, planner, and reminder systems.
It is NOT a medical diagnosis tool.
"""

from __future__ import annotations

import json
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

# Singapore Standard Time — UTC+8
_SGT = timezone(timedelta(hours=8))


def _now_sgt() -> datetime:
    """Return current datetime in Singapore Time (UTC+8), without tzinfo (naive)."""
    return datetime.now(_SGT).replace(tzinfo=None)

from sqlalchemy.orm import Session

from app.agents.base_agent import BaseAgent
from app.db import SessionLocal
from app.models import ChatMessage, InterventionLog, MemoryCheckSession, User
from app.services.meralion_client import MeralionClient, MeralionClientError

_meralion = MeralionClient()

# ---------------------------------------------------------------------------
# Language helpers
# ---------------------------------------------------------------------------

_LANG_NAMES: Dict[str, str] = {
    "en": "English",
    "zh": "Mandarin Chinese",
    "yue": "Cantonese (Traditional Chinese)",
    "ms": "Bahasa Melayu",
    "ta": "Tamil",
    "hi": "Hindi",
}

def _translate_text(text: str, lang: str) -> str:
    """Translate text to target language via MERaLiON. Returns original on failure."""
    if lang == "en" or not lang:
        return text
    if not _meralion.enabled:
        return text
    lang_name = _LANG_NAMES.get(lang, "English")
    prompt = (
        f"Translate the following text to {lang_name} as spoken in Singapore. "
        f"Keep it natural and conversational. Return ONLY the translated text, nothing else.\n\n"
        f"{text}"
    )
    try:
        return _meralion.chat(prompt, {"temperature": 0.3, "topP": 0.9})
    except (MeralionClientError, Exception):
        return text

# ---------------------------------------------------------------------------
# Fallback question pools (used when MERaLiON is unavailable)
# ---------------------------------------------------------------------------

_ORIENTATION_POOL = [
    {"question": "What day of the week is it today?", "answer_hint": "day_of_week"},
    {"question": "What month are we in right now?", "answer_hint": "current_month"},
    {"question": "What year is it?", "answer_hint": "current_year"},
    {"question": "What season are we in?", "answer_hint": "current_season"},
]

_RECALL_POOL = [
    {"words": ["apple", "table", "penny"]},
    {"words": ["river", "chair", "sunset"]},
    {"words": ["garden", "blanket", "orange"]},
    {"words": ["window", "rabbit", "candle"]},
    {"words": ["mountain", "pencil", "basket"]},
    {"words": ["ocean", "pillow", "lemon"]},
    {"words": ["forest", "bottle", "clock"]},
    {"words": ["bridge", "mirror", "cherry"]},
]

_ATTENTION_POOL = [
    {"question": "What is 20 minus 7?", "answer": "13"},
    {"question": "What is 15 plus 8?", "answer": "23"},
    {"question": "What is 30 minus 12?", "answer": "18"},
    {"question": "What is 9 plus 14?", "answer": "23"},
    {"question": "What is 50 minus 17?", "answer": "33"},
    {"question": "Spell the word 'WORLD' backwards.", "answer": "dlrow"},
    {"question": "What is 7 plus 6?", "answer": "13"},
    {"question": "What is 100 minus 7?", "answer": "93"},
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_recent_questions(db: Session, user_id: str, days: int = 3) -> List[str]:
    """Return question texts from recent sessions to avoid repetition."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    rows = (
        db.query(MemoryCheckSession)
        .filter(
            MemoryCheckSession.user_id == user_id,
            MemoryCheckSession.created_at >= cutoff,
        )
        .all()
    )
    recent: List[str] = []
    for row in rows:
        for q in row.questions:
            if isinstance(q, dict):
                recent.append(q.get("question", ""))
            elif isinstance(q, str):
                recent.append(q)
    return recent


def _get_past_scores(db: Session, user_id: str, limit: int = 10) -> List[int]:
    """Return recent completed session scores for trend comparison."""
    rows = (
        db.query(MemoryCheckSession)
        .filter(
            MemoryCheckSession.user_id == user_id,
            MemoryCheckSession.completed == 1,
        )
        .order_by(MemoryCheckSession.created_at.desc())
        .limit(limit)
        .all()
    )
    return [r.score for r in rows if r.score is not None]


def _resolve_orientation_answer(hint: str) -> str:
    """Compute the correct orientation answer dynamically (English)."""
    now = _now_sgt()
    if hint == "day_of_week":
        return now.strftime("%A").lower()
    if hint == "current_month":
        return now.strftime("%B").lower()
    if hint == "current_year":
        return str(now.year)
    if hint == "current_season":
        month = now.month
        if month in (3, 4, 5):
            return "spring"
        if month in (6, 7, 8):
            return "summer"
        if month in (9, 10, 11):
            return "autumn"
        return "winter"
    return ""


# Localised orientation answers indexed by [hint][lang][index]
# day_of_week: 0=Mon … 6=Sun (matches datetime.weekday())
# current_month: 0=Jan … 11=Dec (matches datetime.month - 1)
# current_season: 0=spring, 1=summer, 2=autumn, 3=winter
_ORIENTATION_LOCALIZED: Dict[str, Dict[str, List[str]]] = {
    "day_of_week": {
        "zh":  ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
        "yue": ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
        "ms":  ["isnin", "selasa", "rabu", "khamis", "jumaat", "sabtu", "ahad"],
        "ta":  ["திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி", "ஞாயிறு"],
        "hi":  ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"],
    },
    "current_month": {
        "zh":  ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
        "yue": ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
        "ms":  ["januari","februari","mac","april","mei","jun","julai","ogos","september","oktober","november","disember"],
        "ta":  ["ஜனவரி","பிப்ரவரி","மார்ச்","ஏப்ரல்","மே","ஜூன்","ஜூலை","ஆகஸ்ட்","செப்டம்பர்","அக்டோபர்","நவம்பர்","டிசம்பர்"],
        "hi":  ["जनवरी","फरवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर"],
    },
    "current_season": {
        "zh":  ["春天", "夏天", "秋天", "冬天"],
        "yue": ["春天", "夏天", "秋天", "冬天"],
        "ms":  ["musim bunga", "musim panas", "musim luruh", "musim sejuk"],
        "ta":  ["வசந்தம்", "கோடை", "இலையுதிர்", "குளிர்காலம்"],
        "hi":  ["वसंत", "ग्रीष्म", "शरद", "शीत"],
    },
}


def _resolve_orientation_localized(hint: str, lang: str) -> str:
    """Return the correct orientation answer in the user's chosen language."""
    now = _now_sgt()
    if lang == "en" or hint == "current_year":
        return _resolve_orientation_answer(hint)

    lang_map = _ORIENTATION_LOCALIZED.get(hint, {})
    answers = lang_map.get(lang)
    if not answers:
        return _resolve_orientation_answer(hint)

    if hint == "day_of_week":
        return answers[now.weekday()]          # 0=Mon … 6=Sun
    if hint == "current_month":
        return answers[now.month - 1]          # 0-based
    if hint == "current_season":
        month = now.month
        if month in (3, 4, 5):
            idx = 0
        elif month in (6, 7, 8):
            idx = 1
        elif month in (9, 10, 11):
            idx = 2
        else:
            idx = 3
        return answers[idx]
    return _resolve_orientation_answer(hint)


def _normalize(text: str) -> str:
    """Lowercase, strip, remove punctuation for comparison. Preserves Unicode letters/digits."""
    return re.sub(r"[^\w\s]", "", text.lower().strip(), flags=re.UNICODE)


# ---------------------------------------------------------------------------
# Question generation
# ---------------------------------------------------------------------------


def _generate_questions_via_llm(recent_questions: List[str], lang: str = "en") -> Optional[List[Dict[str, Any]]]:
    """Try to generate questions using MERaLiON. Returns None on failure."""
    if not _meralion.enabled:
        return None

    avoid_text = ""
    if recent_questions:
        avoid_text = (
            "\n\nIMPORTANT: Do NOT use any of these recently asked questions:\n"
            + "\n".join(f"- {q}" for q in recent_questions[:6])
        )

    lang_name = _LANG_NAMES.get(lang, "English")
    lang_instruction = ""
    if lang != "en":
        lang_instruction = f"\n- ALL question text and words MUST be written in {lang_name}"

    prompt = f"""You are helping with a daily cognitive check-in app (NOT a medical test).
Generate exactly 3 questions in valid JSON array format:

1. One ORIENTATION question (e.g. "What day of the week is it?" or "What month are we in?")
   - Include "type": "orientation" and "answer_hint" as one of: day_of_week, current_month, current_year, current_season
2. One MEMORY RECALL task — give the user 3 simple, common words to remember.
   - Include "type": "recall" and "words" as a list of 3 words
   - Include "question" with a short instruction to remember these words
3. One simple ATTENTION/MATH question (e.g. "What is 20 minus 7?")
   - Include "type": "attention" and "answer" with the correct answer as a string

Requirements:
- Use simple, clear language suitable for elderly users
- Keep content safe and neutral
- Keep questions short{lang_instruction}{avoid_text}

Respond ONLY with a JSON array. No explanation, no markdown."""

    try:
        raw = _meralion.chat(prompt, {"temperature": 0.5, "topP": 0.9})
        # Extract JSON array from response
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            questions = json.loads(match.group())
            if isinstance(questions, list) and len(questions) == 3:
                return questions
    except (MeralionClientError, json.JSONDecodeError, Exception):
        pass
    return None


def _generate_questions_fallback(recent_questions: List[str], lang: str = "en") -> List[Dict[str, Any]]:
    """Generate questions from local pools, avoiding recent ones. Translate if needed."""
    recent_lower = {_normalize(q) for q in recent_questions}

    # Orientation
    candidates = [o for o in _ORIENTATION_POOL if _normalize(o["question"]) not in recent_lower]
    if not candidates:
        candidates = _ORIENTATION_POOL
    orient = random.choice(candidates)

    # Recall
    recall_choice = random.choice(_RECALL_POOL)

    # Attention
    candidates = [a for a in _ATTENTION_POOL if _normalize(a["question"]) not in recent_lower]
    if not candidates:
        candidates = _ATTENTION_POOL
    attn = random.choice(candidates)

    recall_q = f"Remember these three words: {', '.join(recall_choice['words'])}. You will be asked to recall them."

    questions = [
        {"type": "orientation", "question": orient["question"], "answer_hint": orient["answer_hint"]},
        {"type": "recall", "question": recall_q, "words": recall_choice["words"]},
        {"type": "attention", "question": attn["question"], "answer": attn["answer"]},
    ]

    # Translate questions if non-English
    if lang != "en":
        for q in questions:
            q["question"] = _translate_text(q["question"], lang)
            if q["type"] == "recall":
                q["words"] = [_translate_text(w, lang) for w in q["words"]]

    return questions


# ---------------------------------------------------------------------------
# Scoring (deterministic — NO LLM)
# ---------------------------------------------------------------------------


def score_responses(questions: List[Dict], responses: List[str], lang: str = "en") -> Dict[str, Any]:
    """Score user responses deterministically. Returns score (0-3) and per-question results."""
    results = []
    total = 0

    for i, q in enumerate(questions):
        user_ans = _normalize(responses[i]) if i < len(responses) else ""
        qtype = q.get("type", "")
        correct = False

        if qtype == "orientation":
            hint = q.get("answer_hint", "")
            expected_en = _resolve_orientation_answer(hint)
            expected_loc = _resolve_orientation_localized(hint, lang)
            # Accept answer in either English or the user's chosen language
            correct = bool(
                (expected_en and expected_en in user_ans)
                or (expected_loc and _normalize(expected_loc) in user_ans)
            )

        elif qtype == "recall":
            # Words may be in user's language — normalize both sides for comparison
            words = [_normalize(w) for w in q.get("words", [])]
            matched = sum(1 for w in words if w and w in user_ans)
            correct = matched >= 2  # at least 2 out of 3

        elif qtype == "attention":
            expected = _normalize(q.get("answer", ""))
            correct = bool(expected and expected in user_ans)

        if correct:
            total += 1
        results.append({"question": q.get("question", ""), "correct": correct})

    return {"score": total, "max_score": 3, "details": results}


# ---------------------------------------------------------------------------
# Status determination (deterministic)
# ---------------------------------------------------------------------------


def determine_status(score: int, past_scores: List[int]) -> str:
    """Compare score against user's history. Returns status string."""
    if not past_scores:
        return "within_range" if score >= 2 else "slightly_lower"
    avg = sum(past_scores) / len(past_scores)
    if score >= avg - 0.5:
        return "within_range"
    return "slightly_lower"


# ---------------------------------------------------------------------------
# Cognitive decline pattern detection (deterministic)
# ---------------------------------------------------------------------------

_ALERT_COOLDOWN_HOURS = 48  # don't re-alert if we already did within this window

def _check_and_fire_cognitive_alert(db: Session, user_id: str, lang: str = "en") -> Optional[str]:
    """
    Check if 3 or more of the last 5 completed sessions are 'slightly_lower'.
    If so, log a clinician_alert + caregiver_alert and inject a system chat message.
    Returns an alert insight string if triggered, else None.
    Includes a cooldown to avoid duplicate alerts within 48 hours.
    """
    # Get last 5 completed sessions ordered by newest first
    recent = (
        db.query(MemoryCheckSession)
        .filter_by(user_id=user_id, completed=1)
        .order_by(MemoryCheckSession.created_at.desc())
        .limit(5)
        .all()
    )

    if len(recent) < 3:
        return None

    # 3 or more of the last 5 sessions must be slightly_lower (not necessarily consecutive)
    lower_count = sum(1 for r in recent if r.status == "slightly_lower")
    if lower_count < 3:
        return None

    # Cooldown check — don't re-alert if a cognitive alert was logged recently
    cutoff = (datetime.utcnow() - timedelta(hours=_ALERT_COOLDOWN_HOURS)).isoformat()
    recent_alert = (
        db.query(InterventionLog)
        .filter(
            InterventionLog.user_id == user_id,
            InterventionLog.action_type == "clinician_alert",
            InterventionLog.reason.like("%memory_check%"),
            InterventionLog.timestamp >= cutoff,
        )
        .first()
    )
    if recent_alert:
        return None

    # --- Fetch patient name ---
    user = db.query(User).filter_by(user_id=user_id).first()
    patient_name = user.name if user else "Patient"

    # --- Build reason string ---
    lower_sessions = [r for r in recent if r.status == "slightly_lower"]
    scores = [r.score for r in lower_sessions]
    dates = [r.created_at[:10] for r in lower_sessions]
    reason = (
        f"memory_check: {lower_count} of last {len(recent)} sessions 'slightly_lower' "
        f"(scores: {scores}, dates: {dates}). "
        f"Possible cognitive pattern flagged for clinical review."
    )

    # --- Generate alert message via LLM (or fallback) ---
    lang_name = _LANG_NAMES.get(lang, "English")
    alert_msg_fallback = (
        f"Hi {patient_name}, we've noticed that your memory check-in scores have been "
        f"lower than usual over your last 3 check-ins. Don't worry — your clinician "
        f"and caregiver have been informed and will follow up with you soon."
    )

    alert_msg = alert_msg_fallback
    if _meralion.enabled:
        lang_instruction = f"\nRespond in {lang_name}." if lang != "en" else ""
        prompt = (
            f"You are ByteCare, a caring health companion (NOT a doctor).\n"
            f"The patient '{patient_name}' has had 3 consecutive low scores on their "
            f"daily memory & focus check-in.\n"
            f"Write a SHORT, warm, non-alarming message to the patient:\n"
            f"- Acknowledge they've been having a harder time recently\n"
            f"- Explicitly tell them their clinician AND caregiver have been notified and will follow up\n"
            f"- Keep it gentle and supportive (max 3 sentences)\n"
            f"- Do NOT diagnose, do NOT use clinical language{lang_instruction}\n"
            f"Return ONLY the patient message, no quotes or formatting."
        )
        try:
            llm_msg = _meralion.chat(prompt, {"temperature": 0.4, "topP": 0.9})
            if llm_msg and len(llm_msg.strip()) < 500:
                alert_msg = llm_msg.strip()
        except (MeralionClientError, Exception):
            pass

    now_str = datetime.utcnow().isoformat(timespec="seconds")

    # --- Log clinician_alert InterventionLog ---
    db.add(InterventionLog(
        intervention_id=str(uuid4()),
        user_id=user_id,
        action_type="clinician_alert",
        risk_level="MEDIUM",
        reason=reason,
        message=alert_msg,
        timestamp=now_str,
    ))

    # --- Log caregiver_alert InterventionLog ---
    db.add(InterventionLog(
        intervention_id=str(uuid4()),
        user_id=user_id,
        action_type="caregiver_alert",
        risk_level="MEDIUM",
        reason=reason,
        message=alert_msg,
        timestamp=now_str,
    ))

    # --- Inject system chat message (unread) so it shows in the chat badge ---
    existing_unread = (
        db.query(ChatMessage)
        .filter_by(user_id=user_id, role="system", is_read=0)
        .order_by(ChatMessage.created_at.desc())
        .first()
    )
    if existing_unread:
        existing_unread.content = alert_msg
        existing_unread.created_at = now_str
    else:
        db.add(ChatMessage(
            message_id=str(uuid4()),
            user_id=user_id,
            role="system",
            content=alert_msg,
            language=lang,
            is_read=0,
            created_at=now_str,
        ))

    db.commit()
    return alert_msg


# ---------------------------------------------------------------------------
# Insight generation (via MERaLiON LLM)
# ---------------------------------------------------------------------------

_INSIGHT_FALLBACKS = {
    "within_range": "Great job today! Your focus is looking steady. Keep it up!",
    "slightly_lower": "A little harder than usual today \u2014 that\u2019s okay, we\u2019ll keep tracking. Everyone has off days!",
}


def _generate_insight_via_llm(status: str, lang: str = "en") -> Optional[str]:
    """Generate a friendly insight message via MERaLiON. Returns None on failure."""
    if not _meralion.enabled:
        return None

    lang_name = _LANG_NAMES.get(lang, "English")
    lang_instruction = f"\n- Respond in {lang_name}" if lang != "en" else ""

    prompt = f"""You are a friendly health companion app (NOT a doctor).
The user just completed a quick daily memory and focus check-in.
Their result status is: "{status}"

Generate ONE short, warm, encouraging sentence as feedback.
Rules:
- Do NOT diagnose or suggest any medical condition
- Do NOT use clinical language
- Keep it casual and supportive
- Maximum 2 sentences
- Do NOT mention scores or numbers{lang_instruction}

Respond with just the message, no quotes or formatting."""

    try:
        text = _meralion.chat(prompt, {"temperature": 0.4, "topP": 0.9})
        if text and len(text) < 500:
            return text.strip()
    except (MeralionClientError, Exception):
        pass
    return None


def generate_insight(status: str, lang: str = "en") -> str:
    """Get a friendly insight message — try LLM first, then fallback."""
    llm_insight = _generate_insight_via_llm(status, lang)
    if llm_insight:
        return llm_insight
    fallback = _INSIGHT_FALLBACKS.get(status, _INSIGHT_FALLBACKS["within_range"])
    if lang != "en":
        return _translate_text(fallback, lang)
    return fallback


# ---------------------------------------------------------------------------
# Trend analysis (via MERaLiON LLM)
# ---------------------------------------------------------------------------


def generate_trend_analysis(user_id: str, lang: str = "en") -> Dict[str, Any]:
    """Analyse past sessions and return a friendly trend summary."""
    db = SessionLocal()
    try:
        rows = (
            db.query(MemoryCheckSession)
            .filter_by(user_id=user_id, completed=1)
            .order_by(MemoryCheckSession.created_at.desc())
            .limit(30)
            .all()
        )

        if not rows:
            msg = "No completed sessions yet. Complete a check-in to start tracking your trends!"
            if lang != "en":
                msg = _translate_text(msg, lang)
            return {"analysis": msg, "session_count": 0, "average_score": None, "alert_notified": False}

        scores = [r.score for r in rows if r.score is not None]
        avg = round(sum(scores) / len(scores), 1) if scores else 0
        total = len(scores)

        # --- Check alert pattern: 3+ of last 5 slightly_lower ---
        recent5 = rows[:5]
        lower_in_recent = sum(1 for r in recent5 if r.status == "slightly_lower")
        pattern_detected = lower_in_recent >= 3

        # --- If pattern detected, ensure alert is fired (or already exists) ---
        alert_notified = False
        alert_notified_at: Optional[str] = None
        if pattern_detected:
            alert_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
            alert_log = (
                db.query(InterventionLog)
                .filter(
                    InterventionLog.user_id == user_id,
                    InterventionLog.action_type == "clinician_alert",
                    InterventionLog.reason.like("%memory_check%"),
                    InterventionLog.timestamp >= alert_cutoff,
                )
                .order_by(InterventionLog.timestamp.desc())
                .first()
            )
            if not alert_log:
                # Alert hasn't been logged yet — fire it now so the care team is notified
                _check_and_fire_cognitive_alert(db, user_id, lang)
                # Re-query to get the newly created log
                alert_log = (
                    db.query(InterventionLog)
                    .filter(
                        InterventionLog.user_id == user_id,
                        InterventionLog.action_type == "clinician_alert",
                        InterventionLog.reason.like("%memory_check%"),
                    )
                    .order_by(InterventionLog.timestamp.desc())
                    .first()
                )
            # Pattern exists → care team is/will be notified
            alert_notified = True
            alert_notified_at = alert_log.timestamp if alert_log else None

        # Build a compact data summary for the LLM
        session_summaries = []
        for r in rows[:15]:
            session_summaries.append(
                f"- {r.created_at[:10]}: score {r.score}/3, status: {r.status}"
            )
        data_text = "\n".join(session_summaries)

        lang_name = _LANG_NAMES.get(lang, "English")
        lang_instruction = f"\nRespond in {lang_name}." if lang != "en" else ""

        # Add alert context to prompt when pattern is detected
        alert_instruction = ""
        if pattern_detected:
            alert_instruction = (
                f"\n\nIMPORTANT: A concerning pattern was detected — {lower_in_recent} of the last "
                f"{len(recent5)} check-ins scored lower than usual. "
                f"{'The user has been notified and the clinician and caregiver have been informed.' if alert_notified else 'This pattern has been flagged.'} "
                f"Include ONE warm, non-alarming sentence acknowledging this pattern and explicitly "
                f"{'confirming that their clinician and caregiver have been informed and will follow up.' if alert_notified else 'encouraging them to keep checking in.'}"
            )

        prompt = f"""You are a friendly health companion app (NOT a doctor).
Analyse the user's past memory & focus check-in results and provide a brief, encouraging summary.

Data ({total} sessions, average score {avg}/3):
{data_text}

Rules:
- Do NOT diagnose or suggest any medical condition
- Do NOT use clinical language or medical terms
- Be warm, encouraging, and supportive
- Mention trends you notice (improving, steady, or occasional dips)
- Keep it to 2-4 sentences
- This is a wellness tracker, NOT a medical test{alert_instruction}{lang_instruction}

Respond with just the analysis, no quotes or formatting."""

        analysis = None
        if _meralion.enabled:
            try:
                text = _meralion.chat(prompt, {"temperature": 0.4, "topP": 0.9})
                if text and len(text) < 800:
                    analysis = text.strip()
            except (MeralionClientError, Exception):
                pass

        if not analysis:
            if avg >= 2.5:
                analysis = f"Over your last {total} check-ins, you've been doing great with an average of {avg}/3. Your memory and focus are looking steady!"
            elif avg >= 1.5:
                analysis = f"Across {total} check-ins, your average is {avg}/3. You're doing well overall, with some natural variation day to day."
            else:
                analysis = f"You've completed {total} check-ins with an average of {avg}/3. Remember, everyone has different days — keep checking in and you'll build a clearer picture over time."
            # Append notification note before translating so everything is done together
            if alert_notified:
                analysis += " We've noticed a pattern in your recent scores and your clinician and caregiver have been informed to follow up with you."
            if lang != "en":
                analysis = _translate_text(analysis, lang)

        return {
            "analysis": analysis,
            "session_count": total,
            "average_score": avg,
            "alert_notified": alert_notified,
            "alert_notified_at": alert_notified_at,
        }
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Main agent class
# ---------------------------------------------------------------------------


class MemoryCheckAgent(BaseAgent):
    name = "memory_check"

    def run(self, user_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Orchestrate the memory check flow based on context action."""
        action = context.get("action", "start")
        if action == "start":
            return self.start_session(user_id, context.get("lang", "en"))
        elif action == "submit":
            return self.submit_responses(
                user_id,
                context.get("session_id", ""),
                context.get("responses", []),
                context.get("lang", "en"),
            )
        elif action == "history":
            return self.get_history(user_id)
        elif action == "analysis":
            return generate_trend_analysis(user_id, context.get("lang", "en"))
        return {"error": "Unknown action"}

    def start_session(self, user_id: str, lang: str = "en") -> Dict[str, Any]:
        """Generate questions and create a new session."""
        db = SessionLocal()
        try:
            recent = _get_recent_questions(db, user_id)
            questions = _generate_questions_via_llm(recent, lang) or _generate_questions_fallback(recent, lang)

            # Build expected answers for storage
            expected = []
            for q in questions:
                qtype = q.get("type", "")
                if qtype == "orientation":
                    expected.append(_resolve_orientation_answer(q.get("answer_hint", "")))
                elif qtype == "recall":
                    expected.append(", ".join(q.get("words", [])))
                elif qtype == "attention":
                    expected.append(q.get("answer", ""))
                else:
                    expected.append("")

            session_id = str(uuid4())
            session = MemoryCheckSession(
                session_id=session_id,
                user_id=user_id,
                questions_json=json.dumps(questions),
                expected_answers_json=json.dumps(expected),
                user_responses_json="[]",
                score=None,
                status="",
                insight="",
                completed=0,
                created_at=datetime.utcnow().isoformat(),
            )
            db.add(session)
            db.commit()

            return {
                "session_id": session_id,
                "questions": questions,
            }
        finally:
            db.close()

    def submit_responses(self, user_id: str, session_id: str, responses: List[str], lang: str = "en") -> Dict[str, Any]:
        """Score responses, determine status, generate insight, and save."""
        db = SessionLocal()
        try:
            session = (
                db.query(MemoryCheckSession)
                .filter_by(session_id=session_id, user_id=user_id)
                .first()
            )
            if not session:
                return {"error": "Session not found"}
            if session.completed:
                return session.to_dict()

            questions = session.questions
            scoring = score_responses(questions, responses, lang=lang)
            score = scoring["score"]

            past_scores = _get_past_scores(db, user_id)
            status = determine_status(score, past_scores)
            insight = generate_insight(status, lang)

            session.user_responses_json = json.dumps(responses)
            session.score = score
            session.status = status
            session.insight = insight
            session.completed = 1
            db.commit()

            # Check for 3-consecutive-low pattern AFTER saving this session
            alert_msg = _check_and_fire_cognitive_alert(db, user_id, lang)

            result = session.to_dict()
            result["scoring_details"] = scoring["details"]
            result["alert_triggered"] = alert_msg is not None
            result["alert_message"] = alert_msg or ""
            return result
        finally:
            db.close()

    def get_history(self, user_id: str) -> Dict[str, Any]:
        """Return past completed sessions for trend tracking."""
        db = SessionLocal()
        try:
            rows = (
                db.query(MemoryCheckSession)
                .filter_by(user_id=user_id, completed=1)
                .order_by(MemoryCheckSession.created_at.desc())
                .limit(30)
                .all()
            )
            return {"sessions": [r.to_dict() for r in rows]}
        finally:
            db.close()


# Module-level singleton for convenience
memory_check_agent = MemoryCheckAgent()
