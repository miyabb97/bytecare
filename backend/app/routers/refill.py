"""Medication refill reminder router."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Medication
from app.services.refill_engine import check_and_notify_refills, compute_refill_status

router = APIRouter()


class RefillStatusItem(BaseModel):
    medication_id: str
    name: str
    dose_text: str
    total_supply: int
    taken_count: int
    doses_remaining: Optional[int] = None
    days_remaining: Optional[float] = None
    is_low: bool
    needs_refill: bool
    tracking_enabled: bool


class RefillStatusResponse(BaseModel):
    items: List[RefillStatusItem]


class SupplyUpdate(BaseModel):
    remaining: int = Field(ge=0, description="How many doses/pills the patient has right now (0 = disable tracking)")


@router.get("/users/{user_id}/refill-status", response_model=RefillStatusResponse)
def get_refill_status(user_id: str):
    """Get current refill status for all of a patient's medications."""
    statuses = compute_refill_status(user_id)
    return {"items": statuses}


@router.post("/users/{user_id}/refill-check")
def run_refill_check(user_id: str):
    """Run refill check and send a chat notification if any medication is running low.

    Safe to call repeatedly — upserts a single unread system message (no duplicates).
    """
    result = check_and_notify_refills(user_id)
    return result


@router.post("/users/{user_id}/medications/{medication_id}/refill-request")
def request_refill(
    user_id: str,
    medication_id: str,
    db: Session = Depends(get_db),
):
    """Log a patient-initiated refill request as a clinician_alert intervention."""
    from app.models import User, InterventionLog  # local import
    from datetime import datetime
    from uuid import uuid4

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    log = InterventionLog(
        intervention_id=str(uuid4()),
        user_id=user_id,
        action_type="refill_request",
        risk_level="MEDIUM",
        reason=f"Patient requested refill for {med.name}",
        message=(
            f"{user.name} has requested a refill for {med.name} ({med.dose_text}). "
            "Please review and arrange accordingly."
        ),
        timestamp=datetime.now().isoformat(timespec="seconds"),
    )
    db.add(log)
    db.commit()
    return {"success": True, "medication": med.name}


@router.put("/users/{user_id}/medications/{medication_id}/supply")
def update_medication_supply(
    user_id: str,
    medication_id: str,
    payload: SupplyUpdate,
    db: Session = Depends(get_db),
):
    """Set how many doses the patient has *right now*.

    total_supply is stored as remaining + taken_count so that
    doses_remaining == payload.remaining immediately after saving.
    Set remaining=0 to disable tracking.
    """
    from app.models import DoseEvent  # local import to avoid circular
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    taken_count = db.query(DoseEvent).filter(
        DoseEvent.medication_id == medication_id,
        DoseEvent.user_id == user_id,
        DoseEvent.response_status == "taken",
    ).count()

    # Store total_supply = remaining + taken so doses_remaining == remaining
    med.total_supply = payload.remaining + taken_count
    db.commit()
    db.refresh(med)
    result = med.to_dict()
    # Return remaining directly so UI can confirm
    result["doses_remaining"] = payload.remaining
    return result
