# ByteCare API Contract

Base path: /api/v1
All request/response bodies are JSON unless stated otherwise.
Time format: ISO-8601 with timezone (e.g., 2026-03-04T10:00:00+08:00)

## Health
GET /health
Response 200:
{ "status": "ok", "app": "ByteCare" }

---

## Users
POST /users
Request:
{
  "name": "Mr Tan",
  "age": 68,
  "timezone": "Asia/Singapore"
}
Response 201:
{
  "user_id": "uuid"
}

GET /users/{user_id}
Response 200:
{
  "user_id": "uuid",
  "name": "Mr Tan",
  "age": 68,
  "timezone": "Asia/Singapore",
  "created_at": "..."
}

---

## Medications
POST /users/{user_id}/medications
Request:
{
  "name": "Amlodipine",
  "dose_text": "5mg",
  "schedule": {
    "frequency": "once_daily",
    "times": ["08:00"]
  },
  "time_window_minutes": 120,
  "criticality": "high"
}
Response 201:
{
  "medication_id": "uuid"
}

GET /users/{user_id}/medications
Response 200:
{
  "items": [
    {
      "medication_id": "uuid",
      "name": "Amlodipine",
      "dose_text": "5mg",
      "schedule": { "frequency": "once_daily", "times": ["08:00"] },
      "time_window_minutes": 120,
      "criticality": "high",
      "created_at": "..."
    }
  ]
}

---

## Appointments
POST /users/{user_id}/appointments
Request:
{
  "datetime": "2026-03-20T10:00:00+08:00",
  "location": "Polyclinic",
  "notes": "Follow-up"
}
Response 201:
{ "appointment_id": "uuid" }

GET /users/{user_id}/appointments
Response 200:
{ "items": [ ... ] }

---

## Restock (Medication Supply)
POST /users/{user_id}/restocks
Request:
{
  "medication_id": "uuid",
  "supply_days": 30,
  "last_refill_date": "2026-03-01"
}
Response 201:
{ "restock_id": "uuid" }

GET /users/{user_id}/restocks
Response 200:
{ "items": [ ... ] }

---

## Dose Events (behaviour signals)
POST /users/{user_id}/dose-events
Request:
{
  "medication_id": "uuid",
  "event_type": "pillbox_open | tap_confirm | voice_confirm",
  "timestamp": "2026-03-04T08:10:00+08:00",
  "source": "simulator | ui | voice"
}
Response 201:
{ "event_id": "uuid" }

GET /users/{user_id}/dose-events?start=...&end=...
Response 200:
{ "items": [ ... ] }

---

## Simulator
POST /users/{user_id}/simulate/pillbox
Request:
{
  "days": 14,
  "seed": 42,
  "pattern": "default | travel_confusion"
}
Response 200:
{
  "generated_days": 14,
  "total_scheduled_doses": 28,
  "events_created": 26,
  "missed_doses": 4,
  "late_doses": 3
}

---

## MES (Medication Evidence Score)
GET /users/{user_id}/mes?start=...&end=...
Response 200:
{
  "items": [
    {
      "medication_id": "uuid",
      "scheduled_datetime": "2026-03-04T08:00:00+08:00",
      "mes": 85,
      "explanations": [
        "pillbox_open within window",
        "taken within 30 minutes"
      ],
      "computed_at": "..."
    }
  ]
}

---

## Drift
GET /users/{user_id}/drift?start=...&end=...
Response 200:
{
  "items": [
    {
      "detected_at": "2026-03-14T09:00:00+08:00",
      "drift_type": "adherence | timing",
      "severity": "yellow | orange | red",
      "evidence": {
        "missed_7d": 4,
        "late_outside_window_7d": 1,
        "rolling_mes_drop_7d": 23
      },
      "pattern": "morning doses missed on travel days"
    }
  ]
}

---

## Orchestrator (next best action)
GET /users/{user_id}/next-action
Response 200:
{
  "risk_level": "low | medium | high | critical",
  "next_action": "none | gentle_nudge | barrier_dialogue | plan_adjust | food_suggestion | jio_event | caregiver_alert | clinician_flag",
  "reason": "missed_7d=4 and rolling_mes_drop_7d=23",
  "suggested_message": "Hi Mr Tan, I noticed..."
}

POST /users/{user_id}/interventions
Request:
{
  "action": "gentle_nudge",
  "triggered_by": "drift_orchestrator",
  "message_sent": "Hi Mr Tan...",
  "user_response": "ok",
  "timestamp": "2026-03-14T09:05:00+08:00"
}
Response 201:
{ "intervention_id": "uuid" }

---

## TCM Safety Check
POST /users/{user_id}/tcm/check
Request (text-first MVP):
{
  "extracted_text": "Ginseng capsules 500mg",
  "notes": "bought from shop"
}
Response 200:
{
  "risk_level": "none | low | moderate | high",
  "matched_items": ["ginseng"],
  "explanation": "Ginseng may interact with certain blood thinners.",
  "guidance": "Please consult your doctor or pharmacist before combining."
}

GET /users/{user_id}/tcm/logs
Response 200:
{ "items": [ ... ] }

---

## Voice Logs (MVP: transcript logging)
POST /users/{user_id}/voice/transcript
Request:
{
  "transcript": "I feel sian today, no want go polyclinic",
  "language_hint": "Singlish",
  "emotion_tag": "negative | neutral | positive"
}
Response 201:
{ "voice_log_id": "uuid" }

GET /users/{user_id}/voice/logs
Response 200:
{ "items": [ ... ] }

---

## Clinician PDF
GET /users/{user_id}/reports/weekly.pdf?week_start=2026-03-01
Response 200:
Content-Type: application/pdf
(binary)