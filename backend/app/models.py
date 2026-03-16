"""SQLAlchemy ORM models."""

from __future__ import annotations

import json

from sqlalchemy import Column, Integer, String, Text, UniqueConstraint

from app.db import Base


class Account(Base):
    __tablename__ = "accounts"

    account_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True)
    account_id = Column(String, nullable=True, index=True)
    assigned_clinician_id = Column(String, nullable=True, index=True)
    caregiver_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    conditions_json = Column(Text, default="[]")
    timezone = Column(String, default="Asia/Singapore")
    language_preference = Column(String, default="English")
    created_at = Column(String, nullable=False)

    @property
    def conditions(self):
        return json.loads(self.conditions_json) if self.conditions_json else []

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "name": self.name,
            "age": self.age,
            "conditions": self.conditions,
            "timezone": self.timezone,
            "language_preference": self.language_preference,
            "created_at": self.created_at,
        }


class Medication(Base):
    __tablename__ = "medications"

    medication_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    dose_text = Column(String, default="")
    schedule_json = Column(Text, nullable=False)
    time_window_minutes = Column(Integer, default=120)
    criticality = Column(String, default="medium")
    total_supply = Column(Integer, default=0)   # 0 = not tracked
    reminder_offset_minutes = Column(Integer, nullable=True)  # None = no reminder
    created_at = Column(String, nullable=False)

    @property
    def schedule(self):
        return json.loads(self.schedule_json) if self.schedule_json else {}

    def to_dict(self):
        return {
            "medication_id": self.medication_id,
            "user_id": self.user_id,
            "name": self.name,
            "dose_text": self.dose_text,
            "schedule": self.schedule,
            "time_window_minutes": self.time_window_minutes,
            "criticality": self.criticality,
            "total_supply": self.total_supply or 0,
            "reminder_offset_minutes": self.reminder_offset_minutes,
            "created_at": self.created_at,
        }


class Appointment(Base):
    __tablename__ = "appointments"

    appointment_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    datetime_str = Column("datetime", String, nullable=False)
    location = Column(String, default="")
    notes = Column(String, default="")
    created_at = Column(String, nullable=False)

    def to_dict(self):
        return {
            "appointment_id": self.appointment_id,
            "user_id": self.user_id,
            "datetime": self.datetime_str,
            "location": self.location,
            "notes": self.notes,
            "created_at": self.created_at,
        }


class DoseEvent(Base):
    __tablename__ = "dose_events"

    event_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    medication_id = Column(String, nullable=False, index=True)
    event_type = Column(String, nullable=False)
    source = Column(String, default="")
    scheduled_for = Column(String, default="", index=True)
    response_status = Column(String, default="")
    timestamp = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

    def to_dict(self):
        return {
            "event_id": self.event_id,
            "user_id": self.user_id,
            "medication_id": self.medication_id,
            "event_type": self.event_type,
            "source": self.source,
            "scheduled_for": self.scheduled_for,
            "response_status": self.response_status,
            "timestamp": self.timestamp,
            "created_at": self.created_at,
        }


class MesScore(Base):
    __tablename__ = "mes_scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    medication_id = Column(String, nullable=False)
    scheduled_datetime = Column(String, nullable=False)
    mes = Column(Integer, nullable=False)
    explanations_json = Column(Text, default="[]")
    computed_at = Column(String, nullable=False)

    @property
    def explanations(self):
        return json.loads(self.explanations_json) if self.explanations_json else []

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "medication_id": self.medication_id,
            "scheduled_datetime": self.scheduled_datetime,
            "mes": self.mes,
            "explanations": self.explanations,
            "computed_at": self.computed_at,
        }


class Simulation(Base):
    __tablename__ = "simulations"

    user_id = Column(String, primary_key=True)
    days = Column(Integer, nullable=False)
    seed = Column(Integer, nullable=False)
    pattern = Column(String, nullable=False)
    total_medications = Column(Integer, nullable=False)
    created_at = Column(String, nullable=False)


class VoiceLog(Base):
    __tablename__ = "voice_logs"

    log_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    transcript = Column(Text, nullable=False)
    result_json = Column(Text, default="{}")
    source = Column(String, default="")
    created_at = Column(String, nullable=False)


class InterventionLog(Base):
    __tablename__ = "intervention_logs"

    intervention_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    action_type = Column(String, nullable=False)  # gentle_reminder | chatbot_support | caregiver_alert | clinician_alert
    risk_level = Column(String, nullable=False)     # LOW | MEDIUM | HIGH
    reason = Column(Text, default="")
    message = Column(Text, default="")
    timestamp = Column(String, nullable=False)

    def to_dict(self):
        return {
            "intervention_id": self.intervention_id,
            "user_id": self.user_id,
            "action_type": self.action_type,
            "risk_level": self.risk_level,
            "reason": self.reason,
            "message": self.message,
            "timestamp": self.timestamp,
        }


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    message_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)           # user | assistant | system
    content = Column(Text, nullable=False)
    language = Column(String, default="en")
    is_read = Column(Integer, default=1)            # 0=unread, 1=read (SQLite has no bool)
    created_at = Column(String, nullable=False)

    def to_dict(self):
        return {
            "message_id": self.message_id,
            "user_id": self.user_id,
            "role": self.role,
            "content": self.content,
            "language": self.language,
            "is_read": bool(self.is_read),
            "created_at": self.created_at,
        }


class UserEvent(Base):
    __tablename__ = "user_events"
    __table_args__ = (
        UniqueConstraint("user_id", "event_id", "status", name="uq_user_event_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    event_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, index=True)  # joined | saved
    created_at = Column(String, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "event_id": self.event_id,
            "status": self.status,
            "created_at": self.created_at,
        }
