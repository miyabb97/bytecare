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
    finally:
        db.close()
