"""Nudge Optimization Agent — Contextual Bandit for personalized reminder strategy.

Learns which reminder timing and tone works best for each patient using an
epsilon-greedy contextual bandit algorithm.

Design:
  - Context buckets: hour-of-day bucket × weekday/weekend
  - Actions: 6 combined (3 timings × 2 tones)
  - Policy: per-patient, per-context Q-values (incremental mean update)
  - Cold-start: default to safe `before_10_supportive` until enough data

Public API:
  choose_action(user_id, medication_id)  → NudgeDecision
  record_outcome(log_id, outcome_type)   → updates Q-values
  get_insight(user_id)                   → patient-friendly explanation
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from app.db import SessionLocal
from app.models import DoseEvent, Medication, User

# ---------------------------------------------------------------------------
# Action space
# ---------------------------------------------------------------------------

ACTIONS: List[str] = [
    "on_time_supportive",
    "on_time_direct",
    "before_1_supportive",
    "before_1_direct",
    "before_10_supportive",
    "before_10_direct",
    "before_30_supportive",
    "before_30_direct",
]

# Map action → (offset_minutes, tone)
ACTION_META: Dict[str, Dict[str, Any]] = {
    "on_time_supportive":   {"offset_minutes": 0,  "tone": "supportive"},
    "on_time_direct":       {"offset_minutes": 0,  "tone": "direct"},
    "before_1_supportive":  {"offset_minutes": 1,  "tone": "supportive"},
    "before_1_direct":      {"offset_minutes": 1,  "tone": "direct"},
    "before_10_supportive": {"offset_minutes": 10, "tone": "supportive"},
    "before_10_direct":     {"offset_minutes": 10, "tone": "direct"},
    "before_30_supportive": {"offset_minutes": 30, "tone": "supportive"},
    "before_30_direct":     {"offset_minutes": 30, "tone": "direct"},
}

# Default safe action for cold start
DEFAULT_ACTION = "before_10_supportive"

# Epsilon for exploration (10% random)
EPSILON = 0.10

# Minimum trials before greedy exploitation kicks in per context bucket
COLD_START_MIN_TRIALS = 3

# Learning rate for incremental Q update
LEARNING_RATE = 0.3

# ---------------------------------------------------------------------------
# Context bucketing
# ---------------------------------------------------------------------------

def _context_key(dt: Optional[datetime] = None) -> str:
    """Produce a short context key from the current (or given) datetime.

    Format: <hour_bucket>_<weekday_type>
    Examples: morning_weekday, evening_weekend
    """
    if dt is None:
        dt = datetime.now()
    hour = dt.hour
    if 6 <= hour < 12:
        hour_bucket = "morning"
    elif 12 <= hour < 18:
        hour_bucket = "afternoon"
    elif 18 <= hour < 21:
        hour_bucket = "evening"
    else:
        hour_bucket = "night"
    weekday_type = "weekend" if dt.weekday() >= 5 else "weekday"
    return f"{hour_bucket}_{weekday_type}"


def _build_context_dict(user_id: str, medication_id: str) -> Dict[str, Any]:
    """Build the full context feature dict for logging purposes."""
    now = datetime.now()
    hour = now.hour
    if 6 <= hour < 12:
        hour_of_day = "morning"
    elif 12 <= hour < 18:
        hour_of_day = "afternoon"
    elif 18 <= hour < 21:
        hour_of_day = "evening"
    else:
        hour_of_day = "night"

    weekday = now.strftime("%A").lower()

    # Fetch patient context from DB
    missed_recently = 0
    med_type = "chronic"
    language = "english"

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(user_id=user_id).first()
            if user:
                language = (user.language_preference or "English").lower()
            med = db.query(Medication).filter_by(
                medication_id=medication_id, user_id=user_id
            ).first()
            if med:
                med_type = med.criticality or "medium"
            # Count missed doses in last 7 days
            since = (now - timedelta(days=7)).isoformat()
            events = (
                db.query(DoseEvent)
                .filter(
                    DoseEvent.user_id == user_id,
                    DoseEvent.medication_id == medication_id,
                    DoseEvent.created_at >= since,
                )
                .all()
            )
            missed_recently = sum(
                1 for e in events if e.response_status in ("missed",)
            )
    except Exception:
        pass

    return {
        "hour_of_day": hour_of_day,
        "weekday": weekday,
        "weekday_type": "weekend" if now.weekday() >= 5 else "weekday",
        "language": language,
        "med_type": med_type,
        "missed_recently": missed_recently,
    }


# ---------------------------------------------------------------------------
# Policy state helpers (read/write NudgePolicyState rows)
# ---------------------------------------------------------------------------

def _get_q_values(db, user_id: str, context_key: str) -> Dict[str, Tuple[float, int]]:
    """Return {action: (q_value, n_trials)} for this patient + context bucket."""
    from app.models import NudgePolicyState
    rows = (
        db.query(NudgePolicyState)
        .filter_by(user_id=user_id, context_key=context_key)
        .all()
    )
    result: Dict[str, Tuple[float, int]] = {}
    for row in rows:
        result[row.action] = (row.q_value, row.n_trials)
    return result


def _upsert_q_value(
    db, user_id: str, context_key: str, action: str, new_q: float, n_trials: int
) -> None:
    from app.models import NudgePolicyState
    row = (
        db.query(NudgePolicyState)
        .filter_by(user_id=user_id, context_key=context_key, action=action)
        .first()
    )
    now_str = datetime.now().isoformat(timespec="seconds")
    if row:
        row.q_value = new_q          # uses the @property setter → updates q_value_str
        row.n_trials = n_trials
        row.updated_at = now_str
    else:
        ps = NudgePolicyState(
            user_id=user_id,
            context_key=context_key,
            action=action,
            n_trials=n_trials,
            updated_at=now_str,
        )
        ps.q_value = new_q           # uses the @property setter
        db.add(ps)


# ---------------------------------------------------------------------------
# Epsilon-greedy action selection
# ---------------------------------------------------------------------------

def _epsilon_greedy(
    q_values: Dict[str, Tuple[float, int]],
    total_trials: int,
) -> str:
    """Select an action using epsilon-greedy policy.

    Cold start: if total_trials < COLD_START_MIN_TRIALS, always return default.
    Exploration: with probability EPSILON, choose a random action.
    Exploitation: otherwise choose argmax Q.
    """
    if total_trials < COLD_START_MIN_TRIALS:
        return DEFAULT_ACTION

    if random.random() < EPSILON:
        return random.choice(ACTIONS)

    # Greedy: pick action with highest Q-value (default 0.5 for unseen actions)
    best_action = DEFAULT_ACTION
    best_q = -1.0
    for action in ACTIONS:
        q, _ = q_values.get(action, (0.5, 0))
        if q > best_q:
            best_q = q
            best_action = action
    return best_action


# ---------------------------------------------------------------------------
# Public data class
# ---------------------------------------------------------------------------

class NudgeDecision:
    """Result of choose_action()."""

    def __init__(
        self,
        log_id: str,
        action: str,
        offset_minutes: int,
        tone: str,
        context_key: str,
        is_personalized: bool,
    ) -> None:
        self.log_id = log_id
        self.action = action
        self.offset_minutes = offset_minutes
        self.tone = tone
        self.context_key = context_key
        self.is_personalized = is_personalized

    def to_dict(self) -> Dict[str, Any]:
        return {
            "log_id": self.log_id,
            "action": self.action,
            "offset_minutes": self.offset_minutes,
            "tone": self.tone,
            "context_key": self.context_key,
            "is_personalized": self.is_personalized,
        }


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def choose_action(user_id: str, medication_id: str) -> NudgeDecision:
    """Select the best reminder action for this patient right now.

    Persists a NudgeLog entry with outcome="pending".
    Returns a NudgeDecision describing timing and tone to use.
    """
    from app.models import NudgeLog

    ctx_key = _context_key()
    context_dict = _build_context_dict(user_id, medication_id)

    with SessionLocal() as db:
        q_values = _get_q_values(db, user_id, ctx_key)
        total_trials = sum(n for _, (_, n) in q_values.items())
        action = _epsilon_greedy(q_values, total_trials)
        is_personalized = total_trials >= COLD_START_MIN_TRIALS

        meta = ACTION_META[action]
        log_id = str(uuid4())
        now_str = datetime.now().isoformat(timespec="seconds")

        log = NudgeLog(
            log_id=log_id,
            user_id=user_id,
            medication_id=medication_id,
            context_json=json.dumps(context_dict),
            context_key=ctx_key,
            action=action,
            timing_offset_minutes=meta["offset_minutes"],
            tone=meta["tone"],
            reminder_sent_at=now_str,
            outcome="pending",
            created_at=now_str,
        )
        log.reward = None            # uses the @property setter
        db.add(log)
        db.commit()

    return NudgeDecision(
        log_id=log_id,
        action=action,
        offset_minutes=meta["offset_minutes"],
        tone=meta["tone"],
        context_key=ctx_key,
        is_personalized=is_personalized,
    )


def record_outcome(user_id: str, medication_id: str, response_status: str) -> None:
    """Called when a dose event is recorded. Finds pending NudgeLog entries and
    updates the Q-values based on the observed outcome.

    Outcome → reward mapping:
      taken (within 30 min of reminder) → 1.0
      taken (within 90 min)             → 0.5
      missed / skipped                  → 0.0
    """
    from app.models import NudgeLog

    try:
        now = datetime.now()
        with SessionLocal() as db:
            # Find the most recent pending nudge log for this user + medication
            cutoff = (now - timedelta(hours=3)).isoformat(timespec="seconds")
            pending = (
                db.query(NudgeLog)
                .filter(
                    NudgeLog.user_id == user_id,
                    NudgeLog.medication_id == medication_id,
                    NudgeLog.outcome == "pending",
                    NudgeLog.reminder_sent_at >= cutoff,
                )
                .order_by(NudgeLog.reminder_sent_at.desc())
                .first()
            )
            if not pending:
                return

            # Compute reward
            if response_status == "taken":
                try:
                    sent_at = datetime.fromisoformat(pending.reminder_sent_at)
                    elapsed_minutes = (now - sent_at).total_seconds() / 60
                except Exception:
                    elapsed_minutes = 999

                if elapsed_minutes <= 30:
                    reward = 1.0
                    outcome = "taken_30min"
                elif elapsed_minutes <= 90:
                    reward = 0.5
                    outcome = "taken_90min"
                else:
                    reward = 0.2
                    outcome = "taken_late"
            else:
                reward = 0.0
                outcome = "missed"

            # Update NudgeLog
            pending.outcome = outcome
            pending.reward = reward

            # Update Q-value: Q ← Q + α * (reward − Q)
            action = pending.action
            ctx_key = pending.context_key
            q_values = _get_q_values(db, user_id, ctx_key)
            current_q, n_trials = q_values.get(action, (0.5, 0))
            new_q = current_q + LEARNING_RATE * (reward - current_q)
            _upsert_q_value(db, user_id, ctx_key, action, new_q, n_trials + 1)
            db.commit()

        # Write learned offset back to medication so the reminder pipeline picks it up
        apply_learned_offset_to_medication(user_id, medication_id)
    except Exception:
        pass  # non-fatal — reminder delivery unaffected


def apply_learned_offset_to_medication(user_id: str, medication_id: str) -> None:
    """Find the best learned action and write its offset back to medication.reminder_offset_minutes.

    Also creates a ReminderLearningLog entry so the change is auditable.
    Only runs after enough data (>= COLD_START_MIN_TRIALS total trials).
    """
    from app.models import Medication, NudgePolicyState, ReminderLearningLog

    try:
        with SessionLocal() as db:
            all_states = (
                db.query(NudgePolicyState)
                .filter_by(user_id=user_id)
                .all()
            )
            if not all_states:
                return

            total_trials = sum(s.n_trials for s in all_states)
            if total_trials < COLD_START_MIN_TRIALS:
                return

            # Find best action across all context buckets
            best_action = DEFAULT_ACTION
            best_q = -1.0
            for row in all_states:
                if row.q_value > best_q:
                    best_q = row.q_value
                    best_action = row.action

            meta = ACTION_META[best_action]
            new_offset = meta["offset_minutes"]
            tone = meta["tone"]

            med = db.query(Medication).filter_by(
                medication_id=medication_id, user_id=user_id
            ).first()
            if not med:
                return

            previous_offset = med.reminder_offset_minutes or 10
            if previous_offset == new_offset:
                return  # No change needed

            med.reminder_offset_minutes = new_offset

            # Determine scheduled_time from medication schedule
            schedule = med.schedule or {}
            times = schedule.get("times", [])
            scheduled_time = times[0] if times else ""

            # Build reason string
            timing_label = _TIMING_LABELS.get(new_offset, f"{new_offset} minutes earlier")
            if new_offset == 0:
                timing_str = "right at your dose time"
            else:
                timing_str = f"{new_offset} minute{'s' if new_offset != 1 else ''} before your dose"
            reason = (
                f"Based on {total_trials} reminder responses, "
                f"ByteCare learned that sending reminders {timing_str} "
                f"with a {tone} message works best for you."
            )

            context_dict = _build_context_dict(user_id, medication_id)

            log_entry = ReminderLearningLog(
                patient_id=user_id,
                medication_id=medication_id,
                scheduled_time=scheduled_time,
                previous_offset_minutes=previous_offset,
                new_offset_minutes=new_offset,
                chosen_timing_action=best_action,
                chosen_tone_action=tone,
                context_json=json.dumps(context_dict),
                observed_outcome="applied",
                reason=reason,
                source="rl_nudge_agent",
                created_at=datetime.now().isoformat(timespec="seconds"),
            )
            log_entry.reward = None
            db.add(log_entry)
            db.commit()
    except Exception:
        pass  # non-fatal


# ---------------------------------------------------------------------------
# Insight generation (patient-friendly)
# ---------------------------------------------------------------------------

_TIMING_LABELS: Dict[int, str] = {
    0:  "right at dose time",
    1:  "1 minute earlier",
    10: "10 minutes earlier",
    30: "30 minutes earlier",
}

_TIMING_DESCRIPTIONS: Dict[int, str] = {
    0:  "remind you right when it's time for your dose",
    1:  "send your reminder 1 minute before your dose time",
    10: "send your reminder 10 minutes before your dose time",
    30: "send your reminder 30 minutes before your dose time",
}


def get_insight(user_id: str) -> Dict[str, Any]:
    """Return a patient-friendly insight about the current reminder strategy.

    Returns:
        has_personalization  bool   — True once the agent has learned enough
        insight_message      str    — explanation in plain language
        timing_label         str    — e.g. "10 minutes earlier"
        best_action          str    — internal action key
        trials_count         int    — total trials across all context buckets
        best_offset_minutes  int    — chosen offset in minutes
    """
    from app.models import NudgePolicyState

    try:
        with SessionLocal() as db:
            all_states = (
                db.query(NudgePolicyState)
                .filter_by(user_id=user_id)
                .all()
            )
    except Exception:
        all_states = []

    if not all_states:
        return {
            "has_personalization": False,
            "insight_message": (
                "ByteCare is learning your reminder preferences. "
                "Your reminders will be personalised after a few more doses."
            ),
            "timing_label": "10 minutes before",
            "best_action": DEFAULT_ACTION,
            "trials_count": 0,
            "best_offset_minutes": 10,
        }

    # Find the best action across all context buckets (highest Q-value)
    best_action = DEFAULT_ACTION
    best_q = -1.0
    total_trials = 0
    for row in all_states:
        total_trials += row.n_trials
        if row.q_value > best_q:
            best_q = row.q_value
            best_action = row.action

    meta = ACTION_META[best_action]
    offset = meta["offset_minutes"]
    tone = meta["tone"]
    timing_label = _TIMING_LABELS.get(offset, f"{offset} minutes earlier")
    timing_desc = _TIMING_DESCRIPTIONS.get(offset, f"{offset} minutes before your dose")
    has_personalization = total_trials >= COLD_START_MIN_TRIALS

    if not has_personalization:
        return {
            "has_personalization": False,
            "insight_message": (
                "ByteCare is still learning your routine. "
                "Your reminders will become personalised after a few more doses."
            ),
            "timing_label": timing_label,
            "best_action": best_action,
            "trials_count": total_trials,
            "best_offset_minutes": offset,
        }

    # Build a patient-friendly insight message
    if offset == 0:
        timing_part = "right at your scheduled dose time"
    elif offset == 1:
        timing_part = "1 minute before your scheduled time"
    elif offset == 10:
        timing_part = "10 minutes before your scheduled time"
    else:
        timing_part = "30 minutes before your scheduled time"

    if tone == "supportive":
        tone_part = "with a gentle, supportive message"
    else:
        tone_part = "with a clear, direct reminder"

    # Contextual personalisation note
    if total_trials >= 10:
        learning_note = (
            f"Based on your past {total_trials} reminder responses, "
            f"ByteCare now sends your reminders {timing_part} {tone_part}. "
            "This pattern helps you stay on track with your medication."
        )
    else:
        learning_note = (
            f"ByteCare has started personalising your reminders. "
            f"Your reminders are sent {timing_part} {tone_part}."
        )

    return {
        "has_personalization": True,
        "insight_message": learning_note,
        "timing_label": timing_label,
        "best_action": best_action,
        "trials_count": total_trials,
        "best_offset_minutes": offset,
    }


# ---------------------------------------------------------------------------
# Tone-aware reminder message builder
# ---------------------------------------------------------------------------

def build_reminder_message(
    med_name: str,
    scheduled_time: str,
    tone: str,
    patient_name: str = "there",
    is_personalized: bool = False,
) -> str:
    """Generate a reminder chat message using the chosen tone."""
    personalized_tag = " · Smart reminder" if is_personalized else ""

    if tone == "supportive":
        return (
            f"⏰ Hi {patient_name}! Just a gentle reminder — "
            f"it's almost time for your {med_name} (scheduled at {scheduled_time}). "
            f"You're doing great, keep it up lah!{personalized_tag}"
        )
    else:  # direct
        return (
            f"⏰ Reminder: Time for your {med_name}. "
            f"Scheduled at {scheduled_time}. "
            f"Please take it now.{personalized_tag}"
        )
