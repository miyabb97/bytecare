"""Contextual Bandit for adaptive reminder timing — Thompson Sampling.

Instead of a fixed reminder offset (e.g., always 10 minutes before), this
service learns the best offset per patient per medication using Thompson
Sampling with Beta-distributed arms.

Arms (actions):  5, 10, 15, 20, 25, 30 minutes before the dose time.
Reward signal:
  +1.0  if patient takes dose on time (response_status = "taken")
  +0.5  if patient takes dose late     (response_status = "late")
  -1.0  if dose is not taken           (response_status = "not_taken")

The reward is mapped to a Bernoulli outcome for the Beta distribution:
  - reward >= 0.5 → success (alpha += 1)
  - reward <  0.5 → failure (beta  += 1)

Each (patient, medication, schedule_time) combo has its own set of arms.
Arms start with alpha=1, beta=1 (uniform prior = no preference).
"""
from __future__ import annotations

import random
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import ReminderBanditArm

# Available offset actions (minutes before dose)
DEFAULT_OFFSETS = [5, 10, 15, 20, 25, 30]


def _ensure_arms(
    db: Session,
    patient_id: str,
    medication_id: str,
    schedule_time: str,
) -> List[ReminderBanditArm]:
    """Ensure all arms exist for a given (patient, med, schedule_time) combo.

    Creates missing arms with uniform prior (alpha=1, beta=1).
    Returns the full list of arms.
    """
    existing = (
        db.query(ReminderBanditArm)
        .filter_by(
            patient_id=patient_id,
            medication_id=medication_id,
            schedule_time=schedule_time,
        )
        .all()
    )
    existing_offsets = {arm.offset_minutes for arm in existing}
    now_str = datetime.now().isoformat(timespec="seconds")

    for offset in DEFAULT_OFFSETS:
        if offset not in existing_offsets:
            arm = ReminderBanditArm(
                patient_id=patient_id,
                medication_id=medication_id,
                schedule_time=schedule_time,
                offset_minutes=offset,
                alpha=1,
                beta=1,
                times_selected=0,
                last_updated=now_str,
            )
            db.add(arm)
            existing.append(arm)

    db.flush()
    return existing


def select_offset(
    db: Session,
    patient_id: str,
    medication_id: str,
    schedule_time: str,
) -> int:
    """Select the best reminder offset using Thompson Sampling.

    Samples from Beta(alpha, beta) for each arm and picks the arm with
    the highest sampled value. Returns the offset in minutes.
    """
    arms = _ensure_arms(db, patient_id, medication_id, schedule_time)

    best_arm = None
    best_sample = -1.0

    for arm in arms:
        # Sample from Beta distribution
        sample = random.betavariate(max(arm.alpha, 1), max(arm.beta, 1))
        if sample > best_sample:
            best_sample = sample
            best_arm = arm

    if best_arm is None:
        return 10  # fallback

    # Record selection
    now_str = datetime.now().isoformat(timespec="seconds")
    best_arm.times_selected = (best_arm.times_selected or 0) + 1
    best_arm.last_selected = now_str
    db.flush()

    return best_arm.offset_minutes


def update_reward(
    db: Session,
    patient_id: str,
    medication_id: str,
    schedule_time: str,
    response_status: str,
) -> Optional[Dict[str, Any]]:
    """Update the bandit arm that was most recently selected for this slot.

    Maps dose outcome to reward:
      taken    → success (alpha += 1)
      late     → weak success + weak failure (alpha += 1, beta += 1)
      not_taken → failure (beta += 1)
      snoozed  → no update (outcome pending)

    Returns the updated arm dict, or None if no arm found.
    """
    if response_status == "snoozed":
        return None  # outcome still pending

    # Find the most recently selected arm for this slot
    arm = (
        db.query(ReminderBanditArm)
        .filter_by(
            patient_id=patient_id,
            medication_id=medication_id,
            schedule_time=schedule_time,
        )
        .filter(ReminderBanditArm.last_selected.isnot(None))
        .order_by(ReminderBanditArm.last_selected.desc())
        .first()
    )

    if not arm:
        return None

    now_str = datetime.now().isoformat(timespec="seconds")

    if response_status == "taken":
        # On-time dose → strong success signal
        arm.alpha = (arm.alpha or 1) + 1
    elif response_status == "late":
        # Late but still took it → weak success + weak penalty
        arm.alpha = (arm.alpha or 1) + 1
        arm.beta = (arm.beta or 1) + 1
    elif response_status in ("not_taken", "missed", "skipped"):
        # Missed dose → failure signal
        arm.beta = (arm.beta or 1) + 1

    arm.last_updated = now_str
    db.flush()

    return arm.to_dict()


def get_bandit_stats(
    db: Session,
    patient_id: str,
    medication_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return all bandit arm stats for a patient (optionally filtered by med)."""
    query = db.query(ReminderBanditArm).filter_by(patient_id=patient_id)
    if medication_id:
        query = query.filter_by(medication_id=medication_id)
    return [arm.to_dict() for arm in query.all()]
