"""Main FastAPI application entry point."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4
import random

from dotenv import load_dotenv

# Load env with backend/.env as primary, root .env as fallback.
_backend_env_file = Path(__file__).resolve().parents[1] / ".env"
if _backend_env_file.exists():
    load_dotenv(_backend_env_file)

_root_env_file = Path(__file__).resolve().parents[2] / ".env"
if _root_env_file.exists():
    load_dotenv(_root_env_file, override=False)

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import SessionLocal, _hash_password, get_db, init_db
from app.models import (
    Account,
    Appointment,
    ChatMessage,
    DoseEvent,
    InterventionLog,
    Medication,
    MesScore,
    Simulation,
    User,
    MedicationTimingDeviation,
    MedicationBehaviorPattern,
)
from app.routers.adaptive_timing import router as adaptive_timing_router
from app.routers.agent import router as agent_router
from app.routers.appointments import router as appointments_router
from app.routers.chat import router as chat_router
from app.routers.clinician import router as clinician_router
from app.routers.community import router as community_router
from app.routers.drift import router as drift_router
from app.routers.nutrition import router as nutrition_router
from app.routers.orchestrator import router as orchestrator_router
from app.routers.refill import router as refill_router
from app.routers.reminders import router as reminders_router
from app.routers.report import router as report_router
from app.routers.tcm import router as tcm_router
from app.routers.voice import router as voice_router

app = FastAPI(title="ByteCare API", version="0.1.0")

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    # Idempotent column migration: add total_supply to medications if not present
    from sqlalchemy import text as _text
    from app.db import engine as _engine
    with _engine.connect() as conn:
        try:
            conn.execute(_text("ALTER TABLE medications ADD COLUMN total_supply INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass  # Column already exists — safe to ignore
        try:
            conn.execute(_text("ALTER TABLE medications ADD COLUMN reminder_offset_minutes INTEGER"))
            conn.commit()
        except Exception:
            pass  # Column already exists — safe to ignore
        try:
            conn.execute(_text("ALTER TABLE medications ADD COLUMN routine_type TEXT DEFAULT 'morning'"))
            conn.commit()
        except Exception:
            pass  # Column already exists — safe to ignore
        try:
            conn.execute(_text("ALTER TABLE medication_behavior_patterns ADD COLUMN schedule_time TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(_text("ALTER TABLE medication_behavior_patterns ADD COLUMN sample_count INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
    # Pre-load CLIP model in a background thread so the first /tcm-identify
    # request doesn't block long enough to trigger a proxy timeout.
    import threading

    def _preload_clip():
        try:
            from app.services.herb_classifier import _load_model
            _load_model()
        except Exception:
            pass  # non-fatal; will retry on first request

    threading.Thread(target=_preload_clip, daemon=True).start()


# -------------------------
# Auth Models
# -------------------------

class SignUpRequest(BaseModel):
    name: str
    email: str
    password: str = Field(min_length=6)
    role: Literal["patient", "caregiver", "clinician"]


class SignInRequest(BaseModel):
    email: str
    password: str


class AccountOut(BaseModel):
    account_id: str
    name: str
    email: str
    role: str
    user_id: Optional[str] = None


# -------------------------
# Auth Routes
# -------------------------

@app.post("/api/v1/auth/signup", response_model=AccountOut, status_code=201)
def sign_up(payload: SignUpRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    existing = db.query(Account).filter_by(email=email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    account_id = str(uuid4())
    account = Account(
        account_id=account_id,
        name=payload.name.strip(),
        email=email,
        password_hash=_hash_password(payload.password),
        role=payload.role,
    )
    db.add(account)

    # Auto-create a linked patient profile
    user_id = str(uuid4())
    user = User(
        user_id=user_id,
        account_id=account_id,
        name=payload.name.strip(),
        age=0,
        timezone="Asia/Singapore",
        language_preference="English",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(user)
    db.commit()
    return AccountOut(account_id=account_id, name=account.name, email=email, role=payload.role, user_id=user_id)


@app.post("/api/v1/auth/signin", response_model=AccountOut)
def sign_in(payload: SignInRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    account = db.query(Account).filter_by(email=email).first()
    if not account or account.password_hash != _hash_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Look up linked user profile
    linked_user = db.query(User).filter_by(account_id=account.account_id).first()
    return AccountOut(
        account_id=account.account_id,
        name=account.name,
        email=account.email,
        role=account.role,
        user_id=linked_user.user_id if linked_user else None,
    )


@app.get("/api/v1/auth/me")
def get_current_account(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter_by(account_id=account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return AccountOut(
        account_id=account.account_id,
        name=account.name,
        email=account.email,
        role=account.role,
    )


# -------------------------
# Models (MVP)
# -------------------------

class UserCreate(BaseModel):
    name: str
    age: int = Field(ge=0, le=120)
    conditions: List[str] = Field(default_factory=list)
    timezone: str = "Asia/Singapore"
    language_preference: str = "English"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    conditions: Optional[List[str]] = None
    timezone: Optional[str] = None
    language_preference: Optional[str] = None


class UserOut(BaseModel):
    user_id: str
    name: str
    age: int
    conditions: List[str] = Field(default_factory=list)
    timezone: str
    language_preference: str
    created_at: str


class Schedule(BaseModel):
    frequency: Literal["once_daily", "twice_daily", "thrice_daily", "as_needed"]
    times: List[str] = Field(default_factory=list)


class MedicationCreate(BaseModel):
    name: str
    dose_text: str = ""
    schedule: Schedule
    time_window_minutes: int = 120
    criticality: Literal["low", "medium", "high"] = "medium"


class MedicationOut(BaseModel):
    medication_id: str
    user_id: str
    name: str
    dose_text: str
    schedule: Schedule
    time_window_minutes: int
    criticality: str
    created_at: str


class AppointmentCreate(BaseModel):
    datetime: str
    location: str = ""
    notes: str = ""


class AppointmentOut(BaseModel):
    appointment_id: str
    user_id: str
    datetime: str
    location: str
    notes: str
    created_at: str


class SimulatorRun(BaseModel):
    days: int = Field(ge=1, le=30)
    seed: int = 42
    pattern: Literal["default", "travel_confusion"] = "default"


class DoseEventOut(BaseModel):
    event_id: str
    user_id: str
    medication_id: str
    event_type: str
    source: str
    scheduled_for: str = ""
    response_status: str = ""
    timestamp: str
    created_at: str


class DoseEventListOut(BaseModel):
    items: List[DoseEventOut]


class IntakeResponseCreate(BaseModel):
    medication_ids: List[str] = Field(min_length=1)
    scheduled_for: str
    response_status: Literal["taken", "skipped", "snoozed", "missed", "late"]
    source: str = "dashboard_popup"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")

def parse_hhmm(hhmm: str) -> tuple[int, int]:
    hour, minute = hhmm.split(":")
    return int(hour), int(minute)


def scheduled_datetimes_for_med(days: int, med: Dict[str, Any]) -> List[datetime]:
    result = []
    now = datetime.now()
    times = med["schedule"]["times"]
    for day_offset in range(days, 0, -1):
        base_date = (now - timedelta(days=day_offset)).date()
        for t in times:
            h, m = parse_hhmm(t)
            result.append(datetime.combine(base_date, datetime.min.time()).replace(hour=h, minute=m))
    return result


def nearest_event_for_schedule(
    db: Session,
    user_id: str,
    medication_id: str,
    scheduled_dt: datetime,
    window_minutes: int,
) -> Optional[Dict[str, Any]]:
    events = (
        db.query(DoseEvent)
        .filter_by(user_id=user_id, medication_id=medication_id)
        .all()
    )
    candidates = []
    for ev in events:
        ev_dt = datetime.fromisoformat(ev.timestamp)
        if ev_dt.date() != scheduled_dt.date():
            continue
        diff_minutes = abs((ev_dt - scheduled_dt).total_seconds()) / 60
        ev_dict = ev.to_dict()
        priority = 3
        if ev.event_type in {"pillbox_open", "tap_confirm", "voice_confirm"} or ev.response_status == "taken":
            priority = 0
        elif ev.response_status == "skipped" or ev.event_type == "dose_skipped":
            priority = 1
        elif ev.response_status == "snoozed" or ev.event_type == "dose_snoozed":
            priority = 2
        candidates.append((priority, diff_minutes, ev_dict))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (x[0], x[1]))
    _, diff, ev_dict = candidates[0]
    ev_dict["_diff_minutes"] = diff
    ev_dict["_within_window"] = diff <= window_minutes
    return ev_dict


def compute_mes_for_scheduled_dose(
    db: Session,
    user_id: str,
    med: Dict[str, Any],
    scheduled_dt: datetime,
) -> Dict[str, Any]:
    score = 0
    explanations = []

    window_minutes = med["time_window_minutes"]
    event = nearest_event_for_schedule(db, user_id, med["medication_id"], scheduled_dt, window_minutes)

    if event:
        if event["event_type"] == "pillbox_open":
            score += 50
            explanations.append("pillbox_open recorded")
        elif event["event_type"] == "tap_confirm":
            score += 30
            explanations.append("manual confirmation recorded")
        elif event["event_type"] == "voice_confirm":
            score += 30
            explanations.append("voice confirmation recorded")
        elif event["event_type"] == "dose_skipped":
            explanations.append("dose marked as skipped")
        elif event["event_type"] == "dose_snoozed":
            explanations.append("dose reminder snoozed")
        else:
            explanations.append(f"event recorded: {event['event_type']}")

        if event["event_type"] in {"pillbox_open", "tap_confirm", "voice_confirm"}:
            diff = event["_diff_minutes"]
            if diff <= 30:
                score += 20
                explanations.append("taken within 30 minutes")
            elif diff <= window_minutes:
                score += 10
                explanations.append("taken within allowed time window")
            else:
                score += 5
                explanations.append("taken outside preferred window")
    else:
        explanations.append("no supporting event found")

    recent_events = (
        db.query(DoseEvent)
        .filter_by(user_id=user_id, medication_id=med["medication_id"])
        .all()
    )
    recent_dates = {
        datetime.fromisoformat(ev.timestamp).date() for ev in recent_events
    }
    last_7_days = [
        (datetime.now().date() - timedelta(days=i)) for i in range(1, 8)
    ]
    missed_days = sum(1 for d in last_7_days if d not in recent_dates)
    if missed_days >= 3:
        score -= 10
        explanations.append("missed streak penalty applied")

    score = max(0, min(100, score))

    return {
        "user_id": user_id,
        "medication_id": med["medication_id"],
        "scheduled_datetime": scheduled_dt.isoformat(timespec="seconds"),
        "mes": score,
        "explanations": explanations,
        "computed_at": now_iso(),
    }


def recompute_mes_for_user(db: Session, user_id: str, days: int = 14) -> List[Dict[str, Any]]:
    meds = db.query(Medication).filter_by(user_id=user_id).all()
    med_dicts = [m.to_dict() for m in meds]
    results = []

    for med in med_dicts:
        schedules = scheduled_datetimes_for_med(days, med)
        for scheduled_dt in schedules:
            results.append(compute_mes_for_scheduled_dose(db, user_id, med, scheduled_dt))

    db.query(MesScore).filter_by(user_id=user_id).delete()
    for r in results:
        db.add(MesScore(
            user_id=r["user_id"],
            medication_id=r["medication_id"],
            scheduled_datetime=r["scheduled_datetime"],
            mes=r["mes"],
            explanations_json=json.dumps(r["explanations"]),
            computed_at=r["computed_at"],
        ))
    db.commit()
    return results


def get_user_or_404(db: Session, user_id: str) -> User:
    u = db.query(User).filter_by(user_id=user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


def _require_clinician_for_care_plan(db: Session, user: User, account_id: Optional[str]):
    """If a patient has an assigned clinician, only that clinician may modify their care plan."""
    if not user.assigned_clinician_id:
        return  # no clinician assigned — legacy behaviour, anyone can edit
    if not account_id:
        raise HTTPException(status_code=403, detail="This patient's care plan is managed by a clinician")
    account = db.query(Account).filter_by(account_id=account_id).first()
    if not account or account.role != "clinician":
        raise HTTPException(status_code=403, detail="This patient's care plan is managed by a clinician")
    clinician_user = db.query(User).filter_by(account_id=account.account_id).first()
    if not clinician_user or clinician_user.user_id != user.assigned_clinician_id:
        raise HTTPException(status_code=403, detail="Patient not assigned to you")


# -------------------------
# Routes
# -------------------------

@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": "ByteCare"}


@app.post("/api/v1/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user_id = str(uuid4())
    user = User(
        user_id=user_id,
        name=payload.name,
        age=payload.age,
        conditions_json=json.dumps(payload.conditions),
        timezone=payload.timezone,
        language_preference=payload.language_preference,
        created_at=now_iso(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user.to_dict()


@app.get("/api/v1/users")
def list_users(db: Session = Depends(get_db)):
    items = db.query(User).order_by(User.created_at).all()
    return {"items": [u.to_dict() for u in items]}


@app.get("/api/v1/users/{user_id}", response_model=UserOut)
def get_user(user_id: str, db: Session = Depends(get_db)):
    return get_user_or_404(db, user_id).to_dict()


@app.get("/api/v1/users/{user_id}/care-plan-status")
def get_care_plan_status(user_id: str, db: Session = Depends(get_db)):
    """Check if this patient's care plan is managed by a clinician."""
    user = get_user_or_404(db, user_id)
    managed = bool(user.assigned_clinician_id)
    clinician_name = None
    if managed:
        clinician_user = db.query(User).filter_by(user_id=user.assigned_clinician_id).first()
        if clinician_user:
            clinician_name = clinician_user.name
    return {"managed_by_clinician": managed, "clinician_name": clinician_name}


# -------------------------
# Caregiver endpoints
# -------------------------

@app.get("/api/v1/caregiver/{account_id}/patients")
def caregiver_get_patients(account_id: str, db: Session = Depends(get_db)):
    """List patients linked to this caregiver."""
    account = db.query(Account).filter_by(account_id=account_id).first()
    if not account or account.role != "caregiver":
        raise HTTPException(status_code=403, detail="Not a caregiver account")
    cg_user = db.query(User).filter_by(account_id=account_id).first()
    if not cg_user:
        raise HTTPException(status_code=404, detail="Caregiver profile not found")
    patients = db.query(User).filter(User.caregiver_id == cg_user.user_id).all()
    items = []
    for p in patients:
        med_count = db.query(Medication).filter_by(user_id=p.user_id).count()
        appt_count = db.query(Appointment).filter_by(user_id=p.user_id).count()
        items.append({
            "user_id": p.user_id,
            "name": p.name,
            "age": p.age,
            "conditions": p.conditions,
            "medication_count": med_count,
            "appointment_count": appt_count,
        })
    return {"items": items}


@app.get("/api/v1/caregiver/{account_id}/patients/{patient_user_id}/briefing")
def caregiver_get_briefing(account_id: str, patient_user_id: str):
    """Return an AI-generated caregiver action briefing for a linked patient."""
    from app.services.caregiver_briefing import generate_caregiver_briefing
    try:
        return generate_caregiver_briefing(account_id, patient_user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/caregiver/{account_id}/patients/{patient_user_id}/medications/{med_id}/recommendations")
def caregiver_med_recommendations(account_id: str, patient_user_id: str, med_id: str):
    """Return focused, agentic next-step recommendations for a medication."""
    from app.services.caregiver_briefing import generate_med_recommendations
    try:
        return generate_med_recommendations(account_id, patient_user_id, med_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/caregiver/{account_id}/patients/{patient_user_id}")
def caregiver_get_patient_detail(account_id: str, patient_user_id: str, db: Session = Depends(get_db)):
    """Get full patient detail for a caregiver's linked patient."""
    account = db.query(Account).filter_by(account_id=account_id).first()
    if not account or account.role != "caregiver":
        raise HTTPException(status_code=403, detail="Not a caregiver account")
    cg_user = db.query(User).filter_by(account_id=account_id).first()
    if not cg_user:
        raise HTTPException(status_code=404, detail="Caregiver profile not found")
    patient = db.query(User).filter_by(user_id=patient_user_id, caregiver_id=cg_user.user_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not linked to this caregiver")
    meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=patient_user_id).all()]
    appts = [a.to_dict() for a in db.query(Appointment).filter_by(user_id=patient_user_id).all()]

    # Recent dose events (last 7 days)
    since = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
    dose_events = [
        e.to_dict() for e in
        db.query(DoseEvent).filter(DoseEvent.user_id == patient_user_id, DoseEvent.timestamp >= since)
        .order_by(DoseEvent.timestamp.desc()).all()
    ]

    # Recent interventions
    interventions = [
        i.to_dict() for i in
        db.query(InterventionLog).filter_by(user_id=patient_user_id)
        .order_by(InterventionLog.timestamp.desc()).limit(10).all()
    ]

    return {
        "patient": patient.to_dict(),
        "medications": meds,
        "appointments": appts,
        "dose_events": dose_events,
        "interventions": interventions,
    }


@app.put("/api/v1/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        if key == "conditions":
            user.conditions_json = json.dumps(value)
        else:
            setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user.to_dict()


@app.post("/api/v1/users/{user_id}/medications", response_model=MedicationOut, status_code=201)
def add_medication(user_id: str, payload: MedicationCreate, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    med_id = str(uuid4())
    med = Medication(
        medication_id=med_id,
        user_id=user_id,
        name=payload.name,
        dose_text=payload.dose_text,
        schedule_json=json.dumps(payload.schedule.model_dump()),
        time_window_minutes=payload.time_window_minutes,
        criticality=payload.criticality,
        created_at=now_iso(),
    )
    db.add(med)
    db.commit()
    db.refresh(med)
    return med.to_dict()


@app.get("/api/v1/users/{user_id}/medications")
def list_medications(user_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    items = db.query(Medication).filter_by(user_id=user_id).all()
    return {"items": [m.to_dict() for m in items]}


@app.get("/api/v1/users/{user_id}/medications/{medication_id}", response_model=MedicationOut)
def get_medication(user_id: str, medication_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    return med.to_dict()


@app.put("/api/v1/users/{user_id}/medications/{medication_id}", response_model=MedicationOut)
def update_medication(user_id: str, medication_id: str, payload: MedicationCreate, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
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


@app.delete("/api/v1/users/{user_id}/medications/{medication_id}", status_code=204)
def delete_medication(user_id: str, medication_id: str, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    db.delete(med)
    db.commit()
    return None


@app.post("/api/v1/users/{user_id}/appointments", response_model=AppointmentOut, status_code=201)
def add_appointment(user_id: str, payload: AppointmentCreate, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    appt_id = str(uuid4())
    appt = Appointment(
        appointment_id=appt_id,
        user_id=user_id,
        datetime_str=payload.datetime,
        location=payload.location,
        notes=payload.notes,
        created_at=now_iso(),
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return appt.to_dict()


@app.get("/api/v1/users/{user_id}/appointments/all")
def list_all_appointments(user_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    items = db.query(Appointment).filter_by(user_id=user_id).all()
    return {"items": [a.to_dict() for a in items]}


@app.get("/api/v1/users/{user_id}/appointments/{appointment_id}", response_model=AppointmentOut)
def get_appointment(user_id: str, appointment_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return appt.to_dict()


@app.put("/api/v1/users/{user_id}/appointments/{appointment_id}", response_model=AppointmentOut)
def update_appointment(user_id: str, appointment_id: str, payload: AppointmentCreate, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appt.datetime_str = payload.datetime
    appt.location = payload.location
    appt.notes = payload.notes
    db.commit()
    db.refresh(appt)
    return appt.to_dict()


@app.delete("/api/v1/users/{user_id}/appointments/{appointment_id}", status_code=204)
def delete_appointment(user_id: str, appointment_id: str, account_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    _require_clinician_for_care_plan(db, user, account_id)
    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    db.delete(appt)
    db.commit()
    return None


@app.get("/api/v1/users/{user_id}/dose-events", response_model=DoseEventListOut)
def list_dose_events(user_id: str, days: int = 7, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    days = max(1, min(days, 30))
    since = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    items = (
        db.query(DoseEvent)
        .filter(DoseEvent.user_id == user_id, DoseEvent.timestamp >= since)
        .order_by(DoseEvent.timestamp.desc(), DoseEvent.created_at.desc())
        .all()
    )
    return {"items": [item.to_dict() for item in items]}


@app.post("/api/v1/users/{user_id}/dose-events/intake", response_model=DoseEventListOut, status_code=201)
def record_medication_intake(user_id: str, payload: IntakeResponseCreate, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)

    medication_ids = list(dict.fromkeys(payload.medication_ids))
    medications = (
        db.query(Medication)
        .filter(Medication.user_id == user_id, Medication.medication_id.in_(medication_ids))
        .all()
    )
    if len(medications) != len(medication_ids):
        raise HTTPException(status_code=404, detail="One or more medications were not found")

    event_type_map = {
        "taken": "tap_confirm",
        "skipped": "dose_skipped",
        "snoozed": "dose_snoozed",
        "missed": "dose_missed",
        "late": "dose_late",
    }
    timestamp = now_iso()
    created_events: List[Dict[str, Any]] = []

    for medication in medications:
        dose_event = DoseEvent(
            event_id=str(uuid4()),
            user_id=user_id,
            medication_id=medication.medication_id,
            event_type=event_type_map[payload.response_status],
            source=payload.source,
            scheduled_for=payload.scheduled_for,
            response_status=payload.response_status,
            timestamp=timestamp,
            created_at=timestamp,
        )
        db.add(dose_event)
        created_events.append(dose_event.to_dict())

    db.commit()

    # Detect timing deviations for taken doses
    if payload.response_status == "taken":
        # fetch user for timezone if needed
        user = get_user_or_404(db, user_id)

        # Hardcoded fallback routine windows
        routine_windows = {
            "morning": ("05:00", "11:00"),
            "afternoon": ("11:00", "17:00"),
            "evening": ("17:00", "23:00"),
        }

        # Load learned patterns to use adaptive windows when available
        from app.models import MedicationBehaviorPattern
        learned_patterns = (
            db.query(MedicationBehaviorPattern)
            .filter_by(patient_id=user_id)
            .all()
        )
        pattern_lookup = {}
        for p in learned_patterns:
            if p.learned_time and (p.sample_count or 0) >= 3:
                pattern_lookup[f"{p.medication_id}:{p.schedule_time}"] = p

        for medication, created in zip(medications, created_events):
            routine = getattr(medication, "routine_type", "morning") or "morning"
            half_window = (medication.time_window_minutes or 120) // 2

            # Try to use learned window centered on usual time
            sched_time_str = payload.scheduled_for[11:16] if len(payload.scheduled_for) >= 16 else ""
            pattern_key = f"{medication.medication_id}:{sched_time_str}"
            pattern = pattern_lookup.get(pattern_key)

            if pattern and pattern.learned_time:
                # Adaptive window centered on learned time
                lh, lm = map(int, pattern.learned_time.split(":"))
                learned_mins = lh * 60 + lm
                start_mins = max(0, learned_mins - half_window)
                end_mins = min(23 * 60 + 59, learned_mins + half_window)
                expected_start = f"{start_mins // 60:02d}:{start_mins % 60:02d}"
                expected_end = f"{end_mins // 60:02d}:{end_mins % 60:02d}"
            else:
                # Fallback to hardcoded routine windows
                expected_start, expected_end = routine_windows.get(routine, ("05:00", "11:00"))

            try:
                actual_dt = datetime.fromisoformat(timestamp)
            except Exception:
                actual_dt = datetime.utcnow()

            # construct expected datetimes on same day
            ymd = actual_dt.date()
            sh, sm = map(int, expected_start.split(":"))
            eh, em = map(int, expected_end.split(":"))
            expected_start_dt = datetime.combine(ymd, datetime.min.time()).replace(hour=sh, minute=sm)
            expected_end_dt = datetime.combine(ymd, datetime.min.time()).replace(hour=eh, minute=em)

            # check if within expected window
            if expected_start_dt <= actual_dt <= expected_end_dt:
                continue

            # compute deviation minutes
            if actual_dt < expected_start_dt:
                deviation_minutes = int((expected_start_dt - actual_dt).total_seconds() / 60)
            else:
                deviation_minutes = int((actual_dt - expected_end_dt).total_seconds() / 60)

            # severity classification
            if deviation_minutes <= 60:
                severity = "minor"
            elif deviation_minutes <= 180:
                severity = "moderate"
            else:
                severity = "major"

            # record deviation
            dev = MedicationTimingDeviation(
                patient_id=user_id,
                medication_id=medication.medication_id,
                routine_type=routine,
                expected_start_time=expected_start,
                expected_end_time=expected_end,
                actual_taken_time=timestamp,
                deviation_minutes=deviation_minutes,
                severity=severity,
                created_at=now_iso(),
            )
            db.add(dev)

            # gentle patient notification via chat assistant
            try:
                msg = ChatMessage(
                    message_id=str(uuid4()),
                    user_id=user_id,
                    role="assistant",
                    content=(
                        f"It looks like your {routine} medication ({medication.name}) was taken later than usual. "
                        "If this happens often, it may affect how the medicine works."
                    ),
                    language=user.language_preference or "en",
                    is_read=0,
                    created_at=now_iso(),
                )
                db.add(msg)
            except Exception:
                pass

        db.commit()

    # Recompute learned behavior patterns after any dose event
    if payload.response_status in {"taken", "skipped", "missed", "late"}:
        try:
            from app.services.routine_learning import update_behavior_patterns
            update_behavior_patterns(db, user_id)
        except Exception:
            pass  # non-fatal: learning update should not block intake
        recompute_mes_for_user(db, user_id, days=14)

    return {"items": created_events}


@app.delete("/api/v1/users/{user_id}/dose-events/{event_id}", status_code=200)
def delete_dose_event(user_id: str, event_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    ev = db.query(DoseEvent).filter_by(event_id=event_id, user_id=user_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Dose event not found")
    db.delete(ev)
    db.commit()
    recompute_mes_for_user(db, user_id, days=14)
    return {"status": "deleted", "event_id": event_id}


@app.post("/api/v1/users/{user_id}/simulate/pillbox")
def simulate_pillbox(user_id: str, payload: SimulatorRun, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    meds = [m.to_dict() for m in db.query(Medication).filter_by(user_id=user_id).all()]

    rng = random.Random(payload.seed)

    # Clear old dose events for this user
    db.query(DoseEvent).filter_by(user_id=user_id).delete()

    missed_doses = 0
    late_doses = 0
    events_created = 0
    total_scheduled_doses = 0

    for med in meds:
        schedules = scheduled_datetimes_for_med(payload.days, med)

        for idx, scheduled_dt in enumerate(schedules):
            total_scheduled_doses += 1

            if payload.pattern == "travel_confusion":
                if idx >= len(schedules) // 2:
                    roll = rng.random()
                    if roll < 0.25:
                        missed_doses += 1
                        continue
                    elif roll < 0.45:
                        ev_dt = scheduled_dt + timedelta(minutes=150)
                        late_doses += 1
                    else:
                        ev_dt = scheduled_dt + timedelta(minutes=rng.randint(0, 25))
                else:
                    ev_dt = scheduled_dt + timedelta(minutes=rng.randint(0, 20))
            else:
                roll = rng.random()
                if roll < 0.1:
                    missed_doses += 1
                    continue
                elif roll < 0.2:
                    ev_dt = scheduled_dt + timedelta(minutes=130)
                    late_doses += 1
                else:
                    ev_dt = scheduled_dt + timedelta(minutes=rng.randint(0, 20))

            # Determine response_status based on timing
            delta_mins = int((ev_dt - scheduled_dt).total_seconds() / 60)
            if delta_mins > 90:
                sim_status = "late"
            else:
                sim_status = "taken"

            db.add(DoseEvent(
                event_id=str(uuid4()),
                user_id=user_id,
                medication_id=med["medication_id"],
                event_type="pillbox_open",
                source="simulator",
                scheduled_for=scheduled_dt.isoformat(timespec="seconds"),
                response_status=sim_status,
                timestamp=ev_dt.isoformat(timespec="seconds"),
                created_at=now_iso(),
            ))
            events_created += 1

    # Upsert simulation record
    existing_sim = db.query(Simulation).filter_by(user_id=user_id).first()
    if existing_sim:
        existing_sim.days = payload.days
        existing_sim.seed = payload.seed
        existing_sim.pattern = payload.pattern
        existing_sim.total_medications = len(meds)
        existing_sim.created_at = now_iso()
    else:
        db.add(Simulation(
            user_id=user_id,
            days=payload.days,
            seed=payload.seed,
            pattern=payload.pattern,
            total_medications=len(meds),
            created_at=now_iso(),
        ))

    db.commit()

    recompute_mes_for_user(db, user_id, payload.days)

    return {
        "generated_days": payload.days,
        "total_scheduled_doses": total_scheduled_doses,
        "events_created": events_created,
        "missed_doses": missed_doses,
        "late_doses": late_doses,
    }


@app.get("/api/v1/users/{user_id}/mes")
def get_mes(user_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)

    scores = db.query(MesScore).filter_by(user_id=user_id).all()
    if not scores:
        results = recompute_mes_for_user(db, user_id, days=14)
        return {"items": results}

    return {"items": [s.to_dict() for s in scores]}


# -------------------------
# MEE (Medication Evidence Engine) endpoint
# -------------------------

@app.get("/api/v1/users/{user_id}/mee")
def get_mee_score(user_id: str, days: int = 7, db: Session = Depends(get_db)):
    """Get patient-level adherence confidence score from the MEE."""
    get_user_or_404(db, user_id)
    from app.services.mee import compute_adherence_score
    return compute_adherence_score(user_id, days)


@app.get("/api/v1/users/{user_id}/mee/medications")
def get_mee_per_medication(user_id: str, days: int = 7, db: Session = Depends(get_db)):
    """Get per-medication adherence scores."""
    get_user_or_404(db, user_id)
    from app.services.mee import compute_per_medication_scores
    return {"items": compute_per_medication_scores(user_id, days)}


# -------------------------
# Intervention log endpoints
# -------------------------

@app.get("/api/v1/users/{user_id}/interventions")
def list_interventions(user_id: str, limit: int = 20, db: Session = Depends(get_db)):
    """Get recent intervention log entries for a patient."""
    get_user_or_404(db, user_id)
    items = (
        db.query(InterventionLog)
        .filter_by(user_id=user_id)
        .order_by(InterventionLog.timestamp.desc())
        .limit(min(limit, 100))
        .all()
    )
    return {"items": [i.to_dict() for i in items]}


# -------------------------
# Admin endpoints
# -------------------------

@app.get("/api/v1/admin/accounts")
def admin_list_accounts(db: Session = Depends(get_db)):
    """List all accounts (admin view)."""
    accounts = db.query(Account).order_by(Account.created_at.desc()).all()
    items = []
    for a in accounts:
        linked = db.query(User).filter_by(account_id=a.account_id).first()
        items.append({
            "account_id": a.account_id,
            "name": a.name,
            "email": a.email,
            "role": a.role,
            "user_id": linked.user_id if linked else None,
            "created_at": a.created_at,
        })
    return {"items": items}


@app.get("/api/v1/admin/interventions")
def admin_list_all_interventions(limit: int = 50, db: Session = Depends(get_db)):
    """List recent interventions across all patients (admin view)."""
    items = (
        db.query(InterventionLog)
        .order_by(InterventionLog.timestamp.desc())
        .limit(min(limit, 200))
        .all()
    )
    result = []
    for i in items:
        d = i.to_dict()
        user = db.query(User).filter_by(user_id=i.user_id).first()
        d["patient_name"] = user.name if user else i.user_id
        result.append(d)
    return {"items": result}


# -------------------------
# Chat message endpoints
# -------------------------

@app.get("/api/v1/users/{user_id}/chat/messages")
def list_chat_messages(user_id: str, limit: int = 50, db: Session = Depends(get_db)):
    """Get chat message history for a patient."""
    get_user_or_404(db, user_id)
    items = (
        db.query(ChatMessage)
        .filter_by(user_id=user_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(min(limit, 200))
        .all()
    )
    return {"items": [m.to_dict() for m in items]}


@app.get("/api/v1/users/{user_id}/chat/unread-count")
def get_unread_count(user_id: str, db: Session = Depends(get_db)):
    """Get count of unread system messages for badge display."""
    get_user_or_404(db, user_id)
    count = (
        db.query(ChatMessage)
        .filter_by(user_id=user_id, role="system", is_read=0)
        .count()
    )
    return {"unread_count": count}


@app.post("/api/v1/users/{user_id}/chat/mark-read")
def mark_chat_read(user_id: str, db: Session = Depends(get_db)):
    """Mark all system messages as read for a patient."""
    get_user_or_404(db, user_id)
    db.query(ChatMessage).filter_by(user_id=user_id, role="system", is_read=0).update({"is_read": 1})
    db.commit()
    return {"status": "ok"}


app.include_router(drift_router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(nutrition_router, prefix="/api/v1")
app.include_router(appointments_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(tcm_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(voice_router, prefix="/api/v1")
app.include_router(report_router, prefix="/api/v1")
app.include_router(clinician_router, prefix="/api/v1")
app.include_router(orchestrator_router, prefix="/api/v1")
app.include_router(refill_router, prefix="/api/v1")
app.include_router(reminders_router, prefix="/api/v1")
app.include_router(adaptive_timing_router, prefix="/api/v1")


# -------------------------
# Demo Seed Endpoint
# -------------------------

_DEMO_SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "seeds"
_DEMO_FILES = ["demo_mdm_lim.json", "demo_mr_ong.json", "demo_mrs_wong.json"]


@app.post("/api/v1/demo/seed")
def seed_demo_patients(db: Session = Depends(get_db)):
    """Create 3 demo patients with accounts, medications, and appointments."""
    created = []
    for filename in _DEMO_FILES:
        seed_path = _DEMO_SEED_DIR / filename
        if not seed_path.exists():
            continue
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        user_data = seed["user"]

        email = user_data.get("email", "").strip().lower()
        password = user_data.get("password", "demo123")

        # Skip if account with this email already exists
        if email and db.query(Account).filter_by(email=email).first():
            existing_account = db.query(Account).filter_by(email=email).first()
            linked_user = db.query(User).filter_by(account_id=existing_account.account_id).first()
            if linked_user:
                created.append({
                    "user_id": linked_user.user_id,
                    "name": existing_account.name,
                    "email": email,
                    "password": password,
                    "age": linked_user.age,
                    "conditions": linked_user.conditions,
                    "medication_count": db.query(Medication).filter_by(user_id=linked_user.user_id).count(),
                    "already_existed": True,
                })
            continue

        account_id = str(uuid4())
        user_id = str(uuid4())

        # Create Account for login
        if email:
            account = Account(
                account_id=account_id,
                name=user_data["display_name"],
                email=email,
                password_hash=_hash_password(password),
                role="patient",
            )
            db.add(account)

        user = User(
            user_id=user_id,
            account_id=account_id if email else None,
            name=user_data["display_name"],
            age=user_data["age"],
            conditions_json=json.dumps(user_data.get("conditions", [])),
            timezone=user_data.get("timezone", "Asia/Singapore"),
            language_preference="English",
            created_at=now_iso(),
        )
        db.add(user)
        db.flush()

        for med in seed.get("medications", []):
            med_id = str(uuid4())
            db.add(Medication(
                medication_id=med_id,
                user_id=user_id,
                name=med["name"],
                dose_text=med.get("dose_text", ""),
                schedule_json=json.dumps(med["schedule"]),
                time_window_minutes=med.get("time_window_minutes", 120),
                criticality=med.get("criticality", "medium"),
                created_at=now_iso(),
            ))

        for appt in seed.get("appointments", []):
            appt_id = str(uuid4())
            db.add(Appointment(
                appointment_id=appt_id,
                user_id=user_id,
                datetime_str=appt["datetime"],
                location=appt.get("location", ""),
                notes=appt.get("notes", ""),
                created_at=now_iso(),
            ))

        created.append({
            "user_id": user_id,
            "name": user_data["display_name"],
            "email": email,
            "password": password,
            "age": user_data["age"],
            "conditions": user_data.get("conditions", []),
            "medication_count": len(seed.get("medications", [])),
        })

    db.commit()
    return {"patients": created, "count": len(created)}


# ---------------------------------------------------------------------------
# Seed adaptive-timing test data
# ---------------------------------------------------------------------------

class SeedAdaptiveRequest(BaseModel):
    days: int = Field(default=5, ge=3, le=14, description="Number of past days to generate taken events for")
    offset_minutes: int = Field(default=30, description="Average offset from scheduled time (positive = later)")

@app.post("/api/v1/users/{user_id}/seed-adaptive-data")
def seed_adaptive_data(user_id: str, payload: SeedAdaptiveRequest, db: Session = Depends(get_db)):
    """Generate fake 'taken' dose events over recent days so adaptive learning can be tested.

    For each medication and each schedule time, creates one taken event per day
    at schedule_time + offset_minutes ± small random jitter.
    Then triggers the learning service to recompute patterns.
    """
    user = get_user_or_404(db, user_id)
    meds = db.query(Medication).filter_by(user_id=user_id).all()
    if not meds:
        raise HTTPException(status_code=404, detail="No medications found for this user")

    created_count = 0
    now = datetime.now()

    for med in meds:
        schedule = med.schedule or {}
        times: List[str] = schedule.get("times", [])

        for sched_time in times:
            if not sched_time:
                continue
            sh, sm = map(int, sched_time.split(":"))
            sched_mins = sh * 60 + sm

            for day_offset in range(1, payload.days + 1):
                day = now - timedelta(days=day_offset)
                # Add the configured offset plus a small random jitter (-10 to +10 min)
                jitter = random.randint(-10, 10)
                taken_mins = sched_mins + payload.offset_minutes + jitter
                taken_h = max(0, min(23, taken_mins // 60))
                taken_m = max(0, min(59, taken_mins % 60))

                taken_dt = day.replace(hour=taken_h, minute=taken_m, second=0, microsecond=0)
                scheduled_dt = day.replace(hour=sh, minute=sm, second=0, microsecond=0)

                ev = DoseEvent(
                    event_id=str(uuid4()),
                    user_id=user_id,
                    medication_id=med.medication_id,
                    event_type="tap_confirm",
                    source="seed_adaptive_test",
                    scheduled_for=scheduled_dt.isoformat(timespec="seconds"),
                    response_status="taken",
                    timestamp=taken_dt.isoformat(timespec="seconds"),
                    created_at=taken_dt.isoformat(timespec="seconds"),
                )
                db.add(ev)
                created_count += 1

    db.commit()

    # Trigger learning recomputation
    from app.services.routine_learning import update_behavior_patterns
    patterns = update_behavior_patterns(db, user_id)

    return {
        "message": f"Seeded {created_count} dose events across {payload.days} days with ~{payload.offset_minutes}min offset",
        "events_created": created_count,
        "learned_patterns": patterns,
    }
