"""SQLAlchemy database connection and session management."""

from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from typing import Any, Dict

DATABASE_PATH = Path(__file__).resolve().parent.parent / "bytecare.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# Shared runtime store for hackathon-only ephemeral state.
# This complements SQL storage and resets on server restart.
RUNTIME_DB: Dict[str, Any] = {
    "user_events": {}
}

# Backward-compatible alias for lightweight in-memory modules.
DB = RUNTIME_DB


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a SQLAlchemy session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _hash_password(password: str) -> str:
    """Simple SHA-256 hash for MVP auth. Not for production use."""
    return hashlib.sha256(password.encode()).hexdigest()


def init_db():
    """Create all tables and seed the default admin account."""
    from app.models import Account  # noqa: avoid circular import

    Base.metadata.create_all(bind=engine)

    # Lightweight schema migration for local SQLite development.
    with engine.connect() as conn:
        user_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
        if "conditions_json" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN conditions_json TEXT DEFAULT '[]'"))

        dose_event_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(dose_events)"))]
        if "scheduled_for" not in dose_event_cols:
            conn.execute(text("ALTER TABLE dose_events ADD COLUMN scheduled_for TEXT DEFAULT ''"))
        if "response_status" not in dose_event_cols:
            conn.execute(text("ALTER TABLE dose_events ADD COLUMN response_status TEXT DEFAULT ''"))

        if "assigned_clinician_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN assigned_clinician_id TEXT DEFAULT NULL"))

        if "caregiver_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN caregiver_id TEXT DEFAULT NULL"))

        conn.commit()

    db = SessionLocal()
    try:
        existing = db.query(Account).filter_by(email="admin@bytecare.com").first()
        if not existing:
            admin = Account(
                account_id=str(uuid4()),
                name="Admin",
                email="admin@bytecare.com",
                password_hash=_hash_password("admin123"),
                role="admin",
            )
            db.add(admin)
            db.commit()

        # Seed demo clinician account
        from app.models import User
        from datetime import datetime

        existing_clinician = db.query(Account).filter_by(email="drchan@bytecare.com").first()
        if not existing_clinician:
            clinician_account_id = str(uuid4())
            clinician_user_id = str(uuid4())
            clinician_account = Account(
                account_id=clinician_account_id,
                name="Dr Chan",
                email="drchan@bytecare.com",
                password_hash=_hash_password("clinician123"),
                role="clinician",
            )
            db.add(clinician_account)
            clinician_user = User(
                user_id=clinician_user_id,
                account_id=clinician_account_id,
                name="Dr Chan",
                age=45,
                timezone="Asia/Singapore",
                language_preference="English",
                created_at=datetime.utcnow().isoformat(),
            )
            db.add(clinician_user)
            db.commit()

        # Seed demo patients (idempotent — skips if emails already exist)
        _seed_demo_patients(db)

    finally:
        db.close()


def _seed_demo_patients(db) -> None:
    """Create the 3 demo patients on first run (skips if already present)."""
    import json
    from datetime import datetime as _dt
    from uuid import uuid4 as _uuid4

    from app.models import Account, Appointment, Medication, User  # noqa

    SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "seeds"
    SEED_FILES = ["demo_mdm_lim.json", "demo_mr_ong.json", "demo_mrs_wong.json"]

    for filename in SEED_FILES:
        seed_path = SEED_DIR / filename
        if not seed_path.exists():
            continue
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        user_data = seed["user"]

        email = user_data.get("email", "").strip().lower()
        password = user_data.get("password", "demo123")

        # Skip if already seeded
        if email and db.query(Account).filter_by(email=email).first():
            continue

        account_id = str(_uuid4())
        user_id = str(_uuid4())

        if email:
            db.add(Account(
                account_id=account_id,
                name=user_data["display_name"],
                email=email,
                password_hash=_hash_password(password),
                role="patient",
            ))

        db.add(User(
            user_id=user_id,
            account_id=account_id if email else None,
            name=user_data["display_name"],
            age=user_data["age"],
            conditions_json=json.dumps(user_data.get("conditions", [])),
            timezone=user_data.get("timezone", "Asia/Singapore"),
            language_preference="English",
            created_at=_dt.utcnow().isoformat(),
        ))
        db.flush()

        for med in seed.get("medications", []):
            db.add(Medication(
                medication_id=str(_uuid4()),
                user_id=user_id,
                name=med["name"],
                dose_text=med.get("dose_text", ""),
                schedule_json=json.dumps(med["schedule"]),
                time_window_minutes=med.get("time_window_minutes", 120),
                criticality=med.get("criticality", "medium"),
                created_at=_dt.utcnow().isoformat(),
            ))

        for appt in seed.get("appointments", []):
            db.add(Appointment(
                appointment_id=str(_uuid4()),
                user_id=user_id,
                datetime_str=appt["datetime"],
                location=appt.get("location", ""),
                notes=appt.get("notes", ""),
                created_at=_dt.utcnow().isoformat(),
            ))

        db.commit()

    # --- Seed demo caregivers and link to patients ---
    _seed_demo_caregivers(db)


def _seed_demo_caregivers(db) -> None:
    """Create demo caregiver accounts and link each to a demo patient."""
    from datetime import datetime as _dt
    from uuid import uuid4 as _uuid4

    from app.models import Account, User  # noqa

    CAREGIVERS = [
        {"name": "Grace Lim",   "email": "grace.lim@demo.com",   "patient_email": "mdm.lim@demo.com"},
        {"name": "Daniel Ong",  "email": "daniel.ong@demo.com",  "patient_email": "mr.ong@demo.com"},
        {"name": "Angela Wong", "email": "angela.wong@demo.com", "patient_email": "mrs.wong@demo.com"},
    ]

    for cg in CAREGIVERS:
        # Skip if already seeded
        if db.query(Account).filter_by(email=cg["email"]).first():
            continue

        cg_account_id = str(_uuid4())
        cg_user_id = str(_uuid4())

        db.add(Account(
            account_id=cg_account_id,
            name=cg["name"],
            email=cg["email"],
            password_hash=_hash_password("demo123"),
            role="caregiver",
        ))
        db.add(User(
            user_id=cg_user_id,
            account_id=cg_account_id,
            name=cg["name"],
            age=0,
            timezone="Asia/Singapore",
            language_preference="English",
            created_at=_dt.utcnow().isoformat(),
        ))
        db.flush()

        # Link patient → caregiver
        patient_account = db.query(Account).filter_by(email=cg["patient_email"]).first()
        if patient_account:
            patient_user = db.query(User).filter_by(account_id=patient_account.account_id).first()
            if patient_user:
                patient_user.caregiver_id = cg_user_id

        db.commit()
