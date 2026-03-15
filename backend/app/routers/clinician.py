"""Clinician-specific API endpoints: patient list, care plan CRUD, assignment, outcomes."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Account, Appointment, DoseEvent, InterventionLog, Medication, MesScore, User

router = APIRouter(prefix="/clinician", tags=["clinician"])


# --------------- helpers ---------------

def _require_clinician(account_id: str, db: Session) -> Account:
    """Return the Account if it has the clinician role, else 403."""
    account = db.query(Account).filter_by(account_id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.role != "clinician":
        raise HTTPException(status_code=403, detail="Clinician role required")
    return account


def _get_clinician_user(account: Account, db: Session) -> User:
    """Return the User profile linked to the clinician account."""
    user = db.query(User).filter_by(account_id=account.account_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Clinician user profile not found")
    return user


def _get_assigned_patient(clinician_user_id: str, patient_user_id: str, db: Session) -> User:
    """Return a patient who is assigned to the given clinician, else 403."""
    patient = db.query(User).filter_by(user_id=patient_user_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if patient.assigned_clinician_id != clinician_user_id:
        raise HTTPException(status_code=403, detail="Patient not assigned to you")
    return patient


# --------------- request / response models ---------------

class PatientSummary(BaseModel):
    user_id: str
    name: str
    age: int
    conditions: List[str]
    medication_count: int
    appointment_count: int


class PatientListOut(BaseModel):
    items: List[PatientSummary]


class AssignPatientRequest(BaseModel):
    patient_user_id: str


class Schedule(BaseModel):
    frequency: Literal["once_daily", "twice_daily", "thrice_daily", "as_needed"]
    times: List[str] = Field(default_factory=list)


class CarePlanMedCreate(BaseModel):
    name: str
    dose_text: str = ""
    schedule: Schedule
    time_window_minutes: int = 120
    criticality: Literal["low", "medium", "high"] = "medium"


class CarePlanApptCreate(BaseModel):
    datetime: str
    location: str = ""
    notes: str = ""


class ConditionsUpdate(BaseModel):
    conditions: List[str]


# --------------- routes ---------------

@router.get("/patients", response_model=PatientListOut)
def list_my_patients(account_id: str, db: Session = Depends(get_db)):
    """List all patients assigned to this clinician."""
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)

    patients = (
        db.query(User)
        .filter(User.assigned_clinician_id == clinician_user.user_id)
        .order_by(User.name)
        .all()
    )

    items = []
    for p in patients:
        med_count = db.query(Medication).filter_by(user_id=p.user_id).count()
        appt_count = db.query(Appointment).filter_by(user_id=p.user_id).count()
        items.append(PatientSummary(
            user_id=p.user_id,
            name=p.name,
            age=p.age,
            conditions=p.conditions,
            medication_count=med_count,
            appointment_count=appt_count,
        ))

    return PatientListOut(items=items)


@router.post("/patients/assign", status_code=200)
def assign_patient(payload: AssignPatientRequest, account_id: str, db: Session = Depends(get_db)):
    """Assign a patient to this clinician."""
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)

    patient = db.query(User).filter_by(user_id=payload.patient_user_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient.assigned_clinician_id = clinician_user.user_id
    db.commit()
    return {"status": "assigned", "patient_user_id": patient.user_id, "clinician_user_id": clinician_user.user_id}


@router.delete("/patients/{patient_user_id}/unassign", status_code=200)
def unassign_patient(patient_user_id: str, account_id: str, db: Session = Depends(get_db)):
    """Remove a patient from this clinician's list."""
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    patient = _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    patient.assigned_clinician_id = None
    db.commit()
    return {"status": "unassigned", "patient_user_id": patient.user_id}


@router.get("/patients/{patient_user_id}")
def get_patient_detail(patient_user_id: str, account_id: str, db: Session = Depends(get_db)):
    """Get full patient detail including medications, appointments, adherence data, and lifestyle."""
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    patient = _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    meds = db.query(Medication).filter_by(user_id=patient_user_id).all()
    appts = db.query(Appointment).filter_by(user_id=patient_user_id).all()

    # Recent dose events (last 7 days)
    since = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
    dose_events = [
        e.to_dict() for e in
        db.query(DoseEvent).filter(DoseEvent.user_id == patient_user_id, DoseEvent.timestamp >= since)
        .order_by(DoseEvent.timestamp.desc()).all()
    ]

    # Last 20 interventions
    interventions = [
        i.to_dict() for i in
        db.query(InterventionLog).filter_by(user_id=patient_user_id)
        .order_by(InterventionLog.timestamp.desc()).limit(20).all()
    ]

    # Drift
    from app.services.drift_engine import detect_adherence_drift
    drift = detect_adherence_drift(patient_user_id)

    # MEE score
    try:
        from app.services.mee import compute_adherence_score
        mee = compute_adherence_score(patient_user_id, 7)
    except Exception:
        mee = None

    # Food recommendations
    try:
        from app.services.nutrition_engine import recommend_food
        food = recommend_food(patient_user_id)
    except Exception:
        food = None

    # Community events (joined)
    try:
        from app.services.community_engine import get_user_community_events
        community = get_user_community_events(patient_user_id)
    except Exception:
        community = {"joined": [], "saved": []}

    # TCM safety — check all meds for common herb interactions
    tcm_warnings: List[Dict[str, Any]] = []
    try:
        from app.services.tcm_engine import HERB_INTERACTIONS, _check_medication_overlap
        med_name_list = [m.name for m in meds]
        for herb_key, info in HERB_INTERACTIONS.items():
            flagged = _check_medication_overlap(herb_key, med_name_list)
            if flagged:
                tcm_warnings.append({
                    "herb": info["display_name"],
                    "risk_level": info["risk_level"],
                    "flagged_medications": flagged,
                    "guidance": info.get("guidance", ""),
                })
    except Exception:
        pass

    return {
        "patient": patient.to_dict(),
        "medications": [m.to_dict() for m in meds],
        "appointments": [a.to_dict() for a in appts],
        "dose_events": dose_events,
        "interventions": interventions,
        "drift": drift,
        "mee": mee,
        "food_recommendations": food,
        "community_events": community,
        "tcm_warnings": tcm_warnings,
    }


@router.put("/patients/{patient_user_id}/conditions")
def update_patient_conditions(
    patient_user_id: str,
    payload: ConditionsUpdate,
    account_id: str,
    db: Session = Depends(get_db),
):
    """Update a patient's conditions list (clinician only)."""
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    patient = _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    patient.conditions_json = json.dumps(payload.conditions)
    db.commit()
    db.refresh(patient)
    return patient.to_dict()


# --- Clinician medication CRUD for assigned patients ---

@router.post("/patients/{patient_user_id}/medications", status_code=201)
def add_patient_medication(
    patient_user_id: str,
    payload: CarePlanMedCreate,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    from datetime import datetime
    med_id = str(uuid4())
    med = Medication(
        medication_id=med_id,
        user_id=patient_user_id,
        name=payload.name,
        dose_text=payload.dose_text,
        schedule_json=json.dumps(payload.schedule.model_dump()),
        time_window_minutes=payload.time_window_minutes,
        criticality=payload.criticality,
        created_at=datetime.now().isoformat(timespec="seconds"),
    )
    db.add(med)
    db.commit()
    db.refresh(med)
    return med.to_dict()


@router.put("/patients/{patient_user_id}/medications/{medication_id}")
def update_patient_medication(
    patient_user_id: str,
    medication_id: str,
    payload: CarePlanMedCreate,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=patient_user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    med.name = payload.name
    med.dose_text = payload.dose_text
    med.schedule_json = json.dumps(payload.schedule.model_dump())
    med.time_window_minutes = payload.time_window_minutes
    med.criticality = payload.criticality
    db.commit()
    db.refresh(med)
    return med.to_dict()


@router.delete("/patients/{patient_user_id}/medications/{medication_id}", status_code=204)
def delete_patient_medication(
    patient_user_id: str,
    medication_id: str,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=patient_user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    db.delete(med)
    db.commit()
    return None


# --- Clinician appointment CRUD for assigned patients ---

@router.post("/patients/{patient_user_id}/appointments", status_code=201)
def add_patient_appointment(
    patient_user_id: str,
    payload: CarePlanApptCreate,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    from datetime import datetime
    appt_id = str(uuid4())
    appt = Appointment(
        appointment_id=appt_id,
        user_id=patient_user_id,
        datetime_str=payload.datetime,
        location=payload.location,
        notes=payload.notes,
        created_at=datetime.now().isoformat(timespec="seconds"),
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return appt.to_dict()


@router.put("/patients/{patient_user_id}/appointments/{appointment_id}")
def update_patient_appointment(
    patient_user_id: str,
    appointment_id: str,
    payload: CarePlanApptCreate,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=patient_user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt.datetime_str = payload.datetime
    appt.location = payload.location
    appt.notes = payload.notes
    db.commit()
    db.refresh(appt)
    return appt.to_dict()


@router.delete("/patients/{patient_user_id}/appointments/{appointment_id}", status_code=204)
def delete_patient_appointment(
    patient_user_id: str,
    appointment_id: str,
    account_id: str,
    db: Session = Depends(get_db),
):
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=patient_user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    db.delete(appt)
    db.commit()
    return None


# --- List all patients (for assignment search) ---

@router.get("/all-patients")
def list_all_patients_for_assignment(account_id: str, db: Session = Depends(get_db)):
    """List all patient users so the clinician can assign them."""
    _require_clinician(account_id, db)

    # Find all accounts with patient role to get their user profiles
    patient_accounts = db.query(Account).filter(Account.role == "patient").all()
    patient_account_ids = {a.account_id for a in patient_accounts}

    users = db.query(User).filter(User.account_id.in_(patient_account_ids)).order_by(User.name).all()

    return {
        "items": [
            {
                "user_id": u.user_id,
                "name": u.name,
                "age": u.age,
                "conditions": u.conditions,
                "assigned_clinician_id": u.assigned_clinician_id,
            }
            for u in users
        ]
    }


# --------------- weekly outcomes summary ---------------

@router.get("/patients/{patient_user_id}/weekly-summary")
def get_patient_weekly_summary(patient_user_id: str, account_id: str, db: Session = Depends(get_db)):
    """
    Comprehensive weekly outcomes summary for a clinician reviewing a patient.
    Aggregates adherence trends, drift, interventions, TCM safety, community,
    nutrition, and overall progress into a single view.
    """
    account = _require_clinician(account_id, db)
    clinician_user = _get_clinician_user(account, db)
    patient = _get_assigned_patient(clinician_user.user_id, patient_user_id, db)

    meds = db.query(Medication).filter_by(user_id=patient_user_id).all()
    med_names = [m.name for m in meds]

    # ---- Adherence trends (current week vs prior week) ----
    try:
        from app.services.mee import compute_adherence_score
        current_mee = compute_adherence_score(patient_user_id, 7)
        prior_mee = compute_adherence_score(patient_user_id, 14)
    except Exception:
        current_mee = {"score": 0, "counts": {"taken": 0, "missed": 0, "late": 0, "skipped": 0, "snoozed": 0}}
        prior_mee = {"score": 0, "counts": {"taken": 0, "missed": 0, "late": 0, "skipped": 0, "snoozed": 0}}

    current_score = round(current_mee.get("score", 0), 1)
    prior_score = round(prior_mee.get("score", 0), 1)
    adherence_delta = round(current_score - prior_score, 1)

    # ---- Dose event breakdown (last 7 days) ----
    since_7d = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
    recent_events = db.query(DoseEvent).filter(
        DoseEvent.user_id == patient_user_id,
        DoseEvent.timestamp >= since_7d,
    ).all()

    taken_count = sum(1 for e in recent_events if e.event_type in ("pillbox_open", "tap_confirm", "voice_confirm") or e.response_status == "taken")
    missed_count = sum(1 for e in recent_events if e.event_type == "dose_skipped" or e.response_status in ("missed", "skipped"))
    late_count = sum(1 for e in recent_events if e.response_status == "late")

    # ---- Drift ----
    from app.services.drift_engine import detect_adherence_drift
    drift = detect_adherence_drift(patient_user_id)

    # ---- Interventions (last 7 days) ----
    recent_interventions = [
        i.to_dict() for i in
        db.query(InterventionLog).filter(
            InterventionLog.user_id == patient_user_id,
            InterventionLog.timestamp >= since_7d,
        ).order_by(InterventionLog.timestamp.desc()).all()
    ]

    # ---- TCM safety ----
    tcm_status = "No recent herb interactions detected"
    tcm_warnings: List[Dict[str, Any]] = []
    try:
        from app.services.tcm_engine import HERB_INTERACTIONS, _check_medication_overlap
        for herb_key, info in HERB_INTERACTIONS.items():
            flagged = _check_medication_overlap(herb_key, med_names)
            if flagged:
                tcm_warnings.append({
                    "herb": info["display_name"],
                    "risk_level": info["risk_level"],
                    "flagged_medications": flagged,
                    "guidance": info.get("guidance", ""),
                })
        if tcm_warnings:
            tcm_status = f"{len(tcm_warnings)} herb interaction warning(s) flagged"
    except Exception:
        tcm_status = "TCM check unavailable"

    # ---- Community activities ----
    community_joined_count = 0
    community_events_joined: List[Dict[str, Any]] = []
    try:
        from app.services.community_engine import get_user_community_events
        community = get_user_community_events(patient_user_id)
        community_events_joined = community.get("joined", [])
        community_joined_count = len(community_events_joined)
    except Exception:
        pass

    # ---- Nutrition / food ----
    food_summary = "No food recommendations available"
    food_recommendations: List[str] = []
    try:
        from app.services.nutrition_engine import recommend_food
        food = recommend_food(patient_user_id)
        food_recommendations = food.get("recommendations", [])
        if food_recommendations:
            food_summary = f"{len(food_recommendations)} daily food suggestion(s) available"
    except Exception:
        pass

    # ---- Build progress bullets ----
    bullets: List[str] = []
    if adherence_delta > 0:
        bullets.append(f"Adherence improved from {prior_score}% to {current_score}% (+{adherence_delta}%)")
    elif adherence_delta < 0:
        bullets.append(f"Adherence declined from {prior_score}% to {current_score}% ({adherence_delta}%)")
    else:
        bullets.append(f"Adherence stable at {current_score}%")

    if missed_count == 0:
        bullets.append("No missed doses this week")
    else:
        bullets.append(f"{missed_count} missed dose(s) this week")

    if community_joined_count > 0:
        bullets.append(f"Joined {community_joined_count} community activit{'y' if community_joined_count == 1 else 'ies'}")

    if food_recommendations:
        bullets.append("Meal guidance active and personalised")

    if not tcm_warnings:
        bullets.append("No high-risk herb interactions")
    else:
        bullets.append(f"{len(tcm_warnings)} herb interaction warning(s) — review recommended")

    if len(recent_interventions) > 0:
        bullets.append(f"{len(recent_interventions)} system intervention(s) triggered this week")

    # ---- Overall status ----
    if current_score >= 80 and not drift.get("drift_detected"):
        overall = "On track"
    elif current_score >= 60:
        overall = "Needs attention"
    else:
        overall = "At risk"

    return {
        "patient_name": patient.name,
        "patient_age": patient.age,
        "conditions": patient.conditions,
        "period": "Last 7 days",
        "overall_status": overall,
        "summary_bullets": bullets,
        "adherence": {
            "current_score": current_score,
            "prior_score": prior_score,
            "delta": adherence_delta,
            "taken": taken_count,
            "missed": missed_count,
            "late": late_count,
        },
        "drift": drift,
        "interventions": recent_interventions,
        "intervention_count": len(recent_interventions),
        "tcm_status": tcm_status,
        "tcm_warnings": tcm_warnings,
        "community_joined_count": community_joined_count,
        "community_events_joined": community_events_joined,
        "food_summary": food_summary,
        "food_recommendations": food_recommendations,
    }
