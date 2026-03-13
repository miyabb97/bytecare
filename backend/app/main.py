"""Main FastAPI application entry point."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4
import random

from dotenv import load_dotenv

# Load .env from project root (one level up from backend/)
_env_file = Path(__file__).resolve().parents[2] / ".env"
if _env_file.exists():
    load_dotenv(_env_file)

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import SessionLocal, _hash_password, get_db, init_db
from app.models import (
    Account,
    Appointment,
    DoseEvent,
    Medication,
    MesScore,
    Simulation,
    User,
)
from app.routers.agent import router as agent_router
from app.routers.appointments import router as appointments_router
from app.routers.chat import router as chat_router
from app.routers.community import router as community_router
from app.routers.drift import router as drift_router
from app.routers.nutrition import router as nutrition_router
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


# -------------------------
# Auth Models
# -------------------------

class SignUpRequest(BaseModel):
    name: str
    email: str
    password: str = Field(min_length=6)
    role: Literal["patient", "caregiver"]


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
    timezone: str = "Asia/Singapore"
    language_preference: str = "English"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    timezone: Optional[str] = None
    language_preference: Optional[str] = None


class UserOut(BaseModel):
    user_id: str
    name: str
    age: int
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
        candidates.append((diff_minutes, ev.to_dict()))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])
    diff, ev_dict = candidates[0]
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


@app.put("/api/v1/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user.to_dict()


@app.post("/api/v1/users/{user_id}/medications", response_model=MedicationOut, status_code=201)
def add_medication(user_id: str, payload: MedicationCreate, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
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
def update_medication(user_id: str, medication_id: str, payload: MedicationCreate, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
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
def delete_medication(user_id: str, medication_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    med = db.query(Medication).filter_by(medication_id=medication_id, user_id=user_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    db.delete(med)
    db.commit()
    return None


@app.post("/api/v1/users/{user_id}/appointments", response_model=AppointmentOut, status_code=201)
def add_appointment(user_id: str, payload: AppointmentCreate, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
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
def update_appointment(user_id: str, appointment_id: str, payload: AppointmentCreate, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
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
def delete_appointment(user_id: str, appointment_id: str, db: Session = Depends(get_db)):
    get_user_or_404(db, user_id)
    appt = db.query(Appointment).filter_by(appointment_id=appointment_id, user_id=user_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    db.delete(appt)
    db.commit()
    return None


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

            db.add(DoseEvent(
                event_id=str(uuid4()),
                user_id=user_id,
                medication_id=med["medication_id"],
                event_type="pillbox_open",
                source="simulator",
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


app.include_router(drift_router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(nutrition_router, prefix="/api/v1")
app.include_router(appointments_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(tcm_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(voice_router, prefix="/api/v1")
app.include_router(report_router, prefix="/api/v1")
