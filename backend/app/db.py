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

        # Medication table new columns
        med_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(medications)"))]
        for col_name, col_default in [
            ("routine_period", "NULL"),
            ("meal_relation", "NULL"),
            ("recommended_default_time", "NULL"),
            ("learned_usual_time", "NULL"),
            ("window_minutes", "NULL"),
            ("missed_threshold_hours", "NULL"),
            ("routine_type", "NULL"),
        ]:
            if col_name not in med_cols:
                conn.execute(text(f"ALTER TABLE medications ADD COLUMN {col_name} TEXT DEFAULT {col_default}"))

        # MedicationBehaviorPattern weekend columns
        bp_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(medication_behavior_patterns)"))]
        for col_name, col_default in [
            ("learned_time_weekend", "NULL"),
            ("sample_count_weekend", "0"),
            ("average_deviation_minutes_weekend", "0"),
        ]:
            if col_name not in bp_cols:
                conn.execute(text(f"ALTER TABLE medication_behavior_patterns ADD COLUMN {col_name} TEXT DEFAULT {col_default}"))

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
                total_supply=med.get("total_supply", 0),
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

    # --- Assign all demo patients to Dr Chan ---
    _seed_clinician_assignments(db)

    # --- Seed memory check sessions for demo patients ---
    _seed_memory_check_sessions(db)


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


def _seed_clinician_assignments(db) -> None:
    """Assign all 3 demo patients to Dr Chan."""
    from app.models import Account, User

    clinician_account = db.query(Account).filter_by(email="drchan@bytecare.com").first()
    if not clinician_account:
        return
    clinician_user = db.query(User).filter_by(account_id=clinician_account.account_id).first()
    if not clinician_user:
        return

    for email in ["mdm.lim@demo.com", "mr.ong@demo.com", "mrs.wong@demo.com"]:
        patient_account = db.query(Account).filter_by(email=email).first()
        if not patient_account:
            continue
        patient_user = db.query(User).filter_by(account_id=patient_account.account_id).first()
        if patient_user and not patient_user.assigned_clinician_id:
            patient_user.assigned_clinician_id = clinician_user.user_id

    db.commit()


def _seed_memory_check_sessions(db) -> None:
    """Seed memory check history for the 3 demo patients.

    - Mdm Lim & Mr Ong: good scores (2-3), all within_range
    - Mrs Wong: bad scores (0-1), mostly slightly_lower → triggers cognitive alert
    """
    import json
    from datetime import datetime as _dt, timedelta
    from uuid import uuid4 as _uuid4

    from app.models import Account, ChatMessage, InterventionLog, MemoryCheckSession, User

    # Only seed once — check if any memory sessions already exist for a demo patient
    mdm_lim_account = db.query(Account).filter_by(email="mdm.lim@demo.com").first()
    if not mdm_lim_account:
        return
    mdm_lim_user = db.query(User).filter_by(account_id=mdm_lim_account.account_id).first()
    if not mdm_lim_user:
        return
    existing = db.query(MemoryCheckSession).filter_by(user_id=mdm_lim_user.user_id).first()
    if existing:
        return  # already seeded

    # Look up all 3 patients
    patients = {}
    for email, key in [("mdm.lim@demo.com", "mdm_lim"), ("mr.ong@demo.com", "mr_ong"), ("mrs.wong@demo.com", "mrs_wong")]:
        acct = db.query(Account).filter_by(email=email).first()
        if acct:
            user = db.query(User).filter_by(account_id=acct.account_id).first()
            if user:
                patients[key] = user

    if len(patients) < 3:
        return

    now = _dt.utcnow()

    # ---- Helper to create a session ----
    def _make_session(user_id, day_offset, orient_q, orient_hint, orient_ans, orient_correct,
                      recall_words, recall_ans, recall_correct,
                      attn_q, attn_expected, attn_ans, attn_correct,
                      score, status):
        ts = (now - timedelta(days=day_offset, hours=10)).isoformat(timespec="seconds")
        questions = [
            {"type": "orientation", "question": orient_q, "answer_hint": orient_hint},
            {"type": "recall", "question": f"Remember these three words: {', '.join(recall_words)}.", "words": recall_words},
            {"type": "attention", "question": attn_q, "answer": attn_expected},
        ]
        expected = [orient_ans, ", ".join(recall_words), attn_expected]
        responses = [
            orient_ans if orient_correct else "I'm not sure",
            recall_ans,
            attn_ans,
        ]
        insight = ("Great job today! Your focus is looking steady. Keep it up!"
                   if status == "within_range"
                   else "A little harder than usual today \u2014 that\u2019s okay. Everyone has off days!")
        return MemoryCheckSession(
            session_id=str(_uuid4()),
            user_id=user_id,
            questions_json=json.dumps(questions),
            expected_answers_json=json.dumps(expected),
            user_responses_json=json.dumps(responses),
            score=score,
            status=status,
            insight=insight,
            completed=1,
            created_at=ts,
        )

    # ======================================================================
    # Mdm Lim — GOOD data: scores 2-3, all within_range
    # ======================================================================
    mdm_id = patients["mdm_lim"].user_id
    mdm_sessions = [
        _make_session(mdm_id, 7, "What day of the week is it today?", "day_of_week", "tuesday", True,
                      ["apple", "table", "penny"], "apple, table, penny", True,
                      "What is 20 minus 7?", "13", "13", True, 3, "within_range"),
        _make_session(mdm_id, 6, "What month are we in right now?", "current_month", "march", True,
                      ["river", "chair", "sunset"], "river, chair", True,
                      "What is 15 plus 8?", "23", "23", True, 3, "within_range"),
        _make_session(mdm_id, 5, "What year is it?", "current_year", "2026", True,
                      ["garden", "blanket", "orange"], "garden, blanket, orange", True,
                      "What is 30 minus 12?", "18", "18", True, 3, "within_range"),
        _make_session(mdm_id, 4, "What day of the week is it today?", "day_of_week", "saturday", True,
                      ["window", "rabbit", "candle"], "window, rabbit", True,
                      "What is 9 plus 14?", "23", "23", True, 3, "within_range"),
        _make_session(mdm_id, 3, "What month are we in right now?", "current_month", "march", True,
                      ["mountain", "pencil", "basket"], "mountain, pencil", True,
                      "What is 50 minus 17?", "33", "30", False, 2, "within_range"),
        _make_session(mdm_id, 2, "What year is it?", "current_year", "2026", True,
                      ["ocean", "pillow", "lemon"], "ocean, pillow, lemon", True,
                      "What is 7 plus 6?", "13", "13", True, 3, "within_range"),
        _make_session(mdm_id, 1, "What day of the week is it today?", "day_of_week", "tuesday", True,
                      ["forest", "bottle", "clock"], "forest, bottle, clock", True,
                      "What is 100 minus 7?", "93", "93", True, 3, "within_range"),
    ]

    # ======================================================================
    # Mr Ong — GOOD data: scores 2-3, all within_range
    # ======================================================================
    ong_id = patients["mr_ong"].user_id
    ong_sessions = [
        _make_session(ong_id, 7, "What month are we in right now?", "current_month", "march", True,
                      ["bridge", "mirror", "cherry"], "bridge, mirror, cherry", True,
                      "What is 20 minus 7?", "13", "13", True, 3, "within_range"),
        _make_session(ong_id, 6, "What day of the week is it today?", "day_of_week", "wednesday", True,
                      ["apple", "table", "penny"], "apple, table, penny", True,
                      "What is 15 plus 8?", "23", "23", True, 3, "within_range"),
        _make_session(ong_id, 5, "What year is it?", "current_year", "2026", True,
                      ["river", "chair", "sunset"], "river, chair", True,
                      "What is 30 minus 12?", "18", "18", True, 3, "within_range"),
        _make_session(ong_id, 4, "What month are we in right now?", "current_month", "march", True,
                      ["garden", "blanket", "orange"], "garden, orange", True,
                      "What is 9 plus 14?", "23", "25", False, 2, "within_range"),
        _make_session(ong_id, 3, "What day of the week is it today?", "day_of_week", "sunday", True,
                      ["window", "rabbit", "candle"], "window, rabbit, candle", True,
                      "What is 50 minus 17?", "33", "33", True, 3, "within_range"),
        _make_session(ong_id, 2, "What year is it?", "current_year", "2026", True,
                      ["mountain", "pencil", "basket"], "mountain, pencil, basket", True,
                      "Spell the word 'WORLD' backwards.", "dlrow", "dlrow", True, 3, "within_range"),
        _make_session(ong_id, 1, "What month are we in right now?", "current_month", "march", True,
                      ["ocean", "pillow", "lemon"], "ocean, pillow, lemon", True,
                      "What is 100 minus 7?", "93", "93", True, 3, "within_range"),
    ]

    # ======================================================================
    # Mrs Wong — BAD data: scores 0-1, mostly slightly_lower → triggers alert
    # ======================================================================
    wong_id = patients["mrs_wong"].user_id
    wong_sessions = [
        _make_session(wong_id, 7, "What day of the week is it today?", "day_of_week", "tuesday", True,
                      ["apple", "table", "penny"], "apple, table, penny", True,
                      "What is 20 minus 7?", "13", "13", True, 3, "within_range"),
        _make_session(wong_id, 6, "What month are we in right now?", "current_month", "march", True,
                      ["river", "chair", "sunset"], "river, chair", True,
                      "What is 15 plus 8?", "23", "23", True, 3, "within_range"),
        _make_session(wong_id, 5, "What year is it?", "current_year", "2026", False,
                      ["garden", "blanket", "orange"], "garden", False,
                      "What is 30 minus 12?", "18", "16", False, 0, "slightly_lower"),
        _make_session(wong_id, 4, "What day of the week is it today?", "day_of_week", "saturday", False,
                      ["window", "rabbit", "candle"], "window", False,
                      "What is 9 plus 14?", "23", "21", False, 0, "slightly_lower"),
        _make_session(wong_id, 3, "What month are we in right now?", "current_month", "march", True,
                      ["mountain", "pencil", "basket"], "mountain", False,
                      "What is 50 minus 17?", "33", "30", False, 1, "slightly_lower"),
        _make_session(wong_id, 2, "What year is it?", "current_year", "2026", False,
                      ["ocean", "pillow", "lemon"], "ocean", False,
                      "What is 7 plus 6?", "13", "15", False, 0, "slightly_lower"),
        _make_session(wong_id, 1, "What day of the week is it today?", "day_of_week", "tuesday", False,
                      ["forest", "bottle", "clock"], "forest", False,
                      "What is 100 minus 7?", "93", "90", False, 0, "slightly_lower"),
    ]

    for s in mdm_sessions + ong_sessions + wong_sessions:
        db.add(s)
    db.flush()

    # --- Fire cognitive alert for Mrs Wong (5 of last 5 are slightly_lower) ---
    alert_reason = (
        "memory_check: 5 of last 5 sessions 'slightly_lower' "
        "(scores: [0, 0, 1, 0, 0], dates: recent). "
        "Possible cognitive pattern flagged for clinical review."
    )
    alert_message = (
        "Hi Mrs Wong, we've noticed that your memory check-in scores have been "
        "lower than usual over your last few check-ins. Don't worry \u2014 your "
        "clinician and caregiver have been informed and will follow up with you soon."
    )
    alert_ts = (now - timedelta(hours=6)).isoformat(timespec="seconds")

    db.add(InterventionLog(
        intervention_id=str(_uuid4()),
        user_id=wong_id,
        action_type="clinician_alert",
        risk_level="MEDIUM",
        reason=alert_reason,
        message=alert_message,
        timestamp=alert_ts,
    ))
    db.add(InterventionLog(
        intervention_id=str(_uuid4()),
        user_id=wong_id,
        action_type="caregiver_alert",
        risk_level="MEDIUM",
        reason=alert_reason,
        message=alert_message,
        timestamp=alert_ts,
    ))

    # Inject unread system chat message for Mrs Wong
    db.add(ChatMessage(
        message_id=str(_uuid4()),
        user_id=wong_id,
        role="system",
        content=alert_message,
        language="en",
        is_read=0,
        created_at=alert_ts,
    ))

    db.commit()
