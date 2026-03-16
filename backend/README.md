# ByteCare Backend

FastAPI-based backend for the ByteCare medication safety platform.

## Getting Started

### Installation

```bash
pip install -r requirements.txt
```

### Running the Application

```bash
uvicorn app.main:app --reload
```

## Project Structure

- `app/` - Main application package
  - `main.py` - FastAPI application entry point
  - `db.py` - Database configuration
  - `models.py` - SQLAlchemy ORM models
  - `schemas.py` - Pydantic validation schemas
  - `crud.py` - CRUD operations
  - `services/` - Business logic services
  - `planner_service.py` - Day Planner aggregation logic
  - `routers/` - API endpoint routers
  - `tests/` - Test suite

## Day Planner API

GET `/api/v1/planner/today?user_id={id}&date={YYYY-MM-DD}`

Returns a normalized timeline for the specified user and date combining:

- Medication schedule items
- Appointments
- Community events
- Wellness prompts (meal/walk/sleep)

Response includes `items` (sorted by start_time) with fields: `id`, `type`, `title`, `subtitle`, `start_time`, `end_time`, `source`, `priority`, `status`, optional `cta_label` and `cta_route`.

