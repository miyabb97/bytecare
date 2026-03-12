"""Main FastAPI application entry point."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from datetime import timedelta
import random

from app.db import DB
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


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")

def parse_hhmm(hhmm: str) -> tuple[int, int]:
    hour, minute = hhmm.split(":")
    return int(hour), int(minute)


def scheduled_datetimes_for_med(days: int, med: Dict[str, Any]) -> List[datetime]:
    """
    Generate scheduled dose datetimes counting backwards from now for the last N days.
    """
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
    user_id: str,
    medication_id: str,
    scheduled_dt: datetime,
    window_minutes: int
) -> Optional[Dict[str, Any]]:
    """
    Find the nearest matching dose event within the same day and return it.
    """
    candidates = []
    for ev in DB["dose_events"]:
        if ev["user_id"] != user_id or ev["medication_id"] != medication_id:
            continue
        ev_dt = datetime.fromisoformat(ev["timestamp"])
        if ev_dt.date() != scheduled_dt.date():
            continue
        diff_minutes = abs((ev_dt - scheduled_dt).total_seconds()) / 60
        candidates.append((diff_minutes, ev))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])
    diff, ev = candidates[0]
    ev = {**ev, "_diff_minutes": diff, "_within_window": diff <= window_minutes}
    return ev


def compute_mes_for_scheduled_dose(
    user_id: str,
    med: Dict[str, Any],
    scheduled_dt: datetime
) -> Dict[str, Any]:
    """
    Exact MES algorithm for MVP.
    Score range: 0-100
    """
    score = 0
    explanations = []

    window_minutes = med["time_window_minutes"]
    event = nearest_event_for_schedule(user_id, med["medication_id"], scheduled_dt, window_minutes)

    # 1. Dose event evidence
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

        # 2. Timing consistency
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

    # 3. Behavioural penalty: missed streak in last 7 days
    recent_events = [
        ev for ev in DB["dose_events"]
        if ev["user_id"] == user_id and ev["medication_id"] == med["medication_id"]
    ]
    recent_dates = {
        datetime.fromisoformat(ev["timestamp"]).date()
        for ev in recent_events
    }

    last_7_days = [
        (datetime.now().date() - timedelta(days=i))
        for i in range(1, 8)
    ]

    missed_days = 0
    for d in last_7_days:
        if d not in recent_dates:
            missed_days += 1

    if missed_days >= 3:
        score -= 10
        explanations.append("missed streak penalty applied")

    # Clamp 0-100
    score = max(0, min(100, score))

    return {
        "user_id": user_id,
        "medication_id": med["medication_id"],
        "scheduled_datetime": scheduled_dt.isoformat(timespec="seconds"),
        "mes": score,
        "explanations": explanations,
        "computed_at": now_iso(),
    }


def recompute_mes_for_user(user_id: str, days: int = 14) -> List[Dict[str, Any]]:
    """
    Recompute MES timeline for all medications for a user.
    """
    meds = [m for m in DB["medications"].values() if m["user_id"] == user_id]
    results = []

    for med in meds:
        schedules = scheduled_datetimes_for_med(days, med)
        for scheduled_dt in schedules:
            results.append(compute_mes_for_scheduled_dose(user_id, med, scheduled_dt))

    DB["mes_scores"] = [x for x in DB["mes_scores"] if x["user_id"] != user_id]
    DB["mes_scores"].extend(results)

    return results

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


@app.get("/api/v1/users")
def list_users():
    items = sorted(DB["users"].values(), key=lambda x: x.get("created_at", ""))
    return {"items": items}


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


@app.post("/api/v1/users/{user_id}/simulate/pillbox")
@app.post("/api/v1/users/{user_id}/simulate/pillbox")
def simulate_pillbox(user_id: str, payload: SimulatorRun):
    get_user_or_404(user_id)
    meds = [m for m in DB["medications"].values() if m["user_id"] == user_id]

    rng = random.Random(payload.seed)
    DB["dose_events"] = [ev for ev in DB["dose_events"] if ev["user_id"] != user_id]

    missed_doses = 0
    late_doses = 0
    events_created = 0
    total_scheduled_doses = 0

    now = datetime.now()

    for med in meds:
        schedules = scheduled_datetimes_for_med(payload.days, med)

        for idx, scheduled_dt in enumerate(schedules):
            total_scheduled_doses += 1

            # travel_confusion pattern:
            # first week mostly adherent
            # second week some missed + late doses
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

            DB["dose_events"].append({
                "event_id": str(uuid4()),
                "user_id": user_id,
                "medication_id": med["medication_id"],
                "event_type": "pillbox_open",
                "source": "simulator",
                "timestamp": ev_dt.isoformat(timespec="seconds"),
                "created_at": now_iso(),
            })
            events_created += 1

    sim = {
        "user_id": user_id,
        "days": payload.days,
        "seed": payload.seed,
        "pattern": payload.pattern,
        "total_medications": len(meds),
        "created_at": now_iso(),
    }
    DB["simulations"][user_id] = sim

    recompute_mes_for_user(user_id, payload.days)

    return {
        "generated_days": payload.days,
        "total_scheduled_doses": total_scheduled_doses,
        "events_created": events_created,
        "missed_doses": missed_doses,
        "late_doses": late_doses,
    }

@app.get("/api/v1/users/{user_id}/mes")
def get_mes(user_id: str):
    get_user_or_404(user_id)

    results = [x for x in DB["mes_scores"] if x["user_id"] == user_id]
    if not results:
        results = recompute_mes_for_user(user_id, days=14)

    return {"items": results}


app.include_router(drift_router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(nutrition_router, prefix="/api/v1")
app.include_router(appointments_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(tcm_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(voice_router, prefix="/api/v1")
app.include_router(report_router, prefix="/api/v1")
