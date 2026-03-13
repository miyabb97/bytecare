"""SQLAlchemy database connection and session management."""

from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

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
