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
  - `routers/` - API endpoint routers
  - `tests/` - Test suite
