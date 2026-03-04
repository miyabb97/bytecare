"""Main FastAPI application entry point."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ByteCare API", version="0.1.0")


# -------------------------
# Models (MVP)
# -------------------------

class UserCreate(BaseModel):
    name: str
    age: int = Field(ge=0, le=120)
    timezone: str = "Asia/Singapore"


class UserOut(BaseModel):
    user_id: str
    name: str
    age: int
    timezone: str
    created_at: str


class Schedule(BaseModel):
    frequency: Literal["once_daily", "twice_daily", "thrice_daily", "as_needed"]
    times: List[str] = Field(default_factory=list)  # ["08:00", "20:00"]


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


# -------------------------
# In-memory store (MVP)
# Replace with SQLite later
# -------------------------

DB: Dict[str, Any] = {
    "users": {},          # user_id -> user dict
    "medications": {},    # med_id -> med dict
    "appointments": {},   # appt_id -> appt dict
    "simulations": {},    # user_id -> last simulation dict
}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_user_or_404(user_id: str) -> Dict[str, Any]:
    u = DB["users"].get(user_id)
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
def create_user(payload: UserCreate):
    user_id = str(uuid4())
    user = {
        "user_id": user_id,
        "name": payload.name,
        "age": payload.age,
        "timezone": payload.timezone,
        "created_at": now_iso(),
    }
    DB["users"][user_id] = user
    return user


@app.get("/api/v1/users/{user_id}", response_model=UserOut)
def get_user(user_id: str):
    return get_user_or_404(user_id)


@app.post("/api/v1/users/{user_id}/medications", response_model=MedicationOut, status_code=201)
def add_medication(user_id: str, payload: MedicationCreate):
    get_user_or_404(user_id)
    med_id = str(uuid4())
    med = {
        "medication_id": med_id,
        "user_id": user_id,
        "name": payload.name,
        "dose_text": payload.dose_text,
        "schedule": payload.schedule.model_dump(),
        "time_window_minutes": payload.time_window_minutes,
        "criticality": payload.criticality,
        "created_at": now_iso(),
    }
    DB["medications"][med_id] = med
    return med


@app.get("/api/v1/users/{user_id}/medications")
def list_medications(user_id: str):
    get_user_or_404(user_id)
    items = [m for m in DB["medications"].values() if m["user_id"] == user_id]
    return {"items": items}


@app.post("/api/v1/users/{user_id}/appointments", response_model=AppointmentOut, status_code=201)
def add_appointment(user_id: str, payload: AppointmentCreate):
    get_user_or_404(user_id)
    appt_id = str(uuid4())
    appt = {
        "appointment_id": appt_id,
        "user_id": user_id,
        "datetime": payload.datetime,
        "location": payload.location,
        "notes": payload.notes,
        "created_at": now_iso(),
    }
    DB["appointments"][appt_id] = appt
    return appt


@app.get("/api/v1/users/{user_id}/appointments")
def list_appointments(user_id: str):
    get_user_or_404(user_id)
    items = [a for a in DB["appointments"].values() if a["user_id"] == user_id]
    return {"items": items}


@app.post("/api/v1/users/{user_id}/simulate/pillbox")
def simulate_pillbox(user_id: str, payload: SimulatorRun):
    get_user_or_404(user_id)
    meds = [m for m in DB["medications"].values() if m["user_id"] == user_id]

    # MVP stub: just record the simulation config and return summary.
    sim = {
        "user_id": user_id,
        "days": payload.days,
        "seed": payload.seed,
        "pattern": payload.pattern,
        "total_medications": len(meds),
        "created_at": now_iso(),
    }
    DB["simulations"][user_id] = sim

    # Return something your seed script prints nicely
    return {
        "generated_days": payload.days,
        "total_scheduled_doses": payload.days * max(1, len(meds)),
        "events_created": payload.days * max(1, len(meds)) - (4 if payload.pattern == "travel_confusion" else 0),
        "missed_doses": 4 if payload.pattern == "travel_confusion" else 0,
        "late_doses": 3 if payload.pattern == "travel_confusion" else 0,
    }


# The below endpoints are placeholders so your seed script can proceed.
# You will implement real MES/drift/orchestrator logic next.

@app.get("/api/v1/users/{user_id}/mes")
def get_mes(user_id: str):
    get_user_or_404(user_id)
    return {"items": []}


@app.get("/api/v1/users/{user_id}/drift")
def get_drift(user_id: str):
    get_user_or_404(user_id)
    return {"items": []}


@app.get("/api/v1/users/{user_id}/next-action")
def next_action(user_id: str):
    get_user_or_404(user_id)
    return {
        "risk_level": "low",
        "next_action": "none",
        "reason": "MVP placeholder",
        "suggested_message": "Hi Mr Tan, I am here if you need help staying on track."
    }