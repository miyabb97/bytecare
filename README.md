# ByteCare – Medication Safety Platform

ByteCare is a medication safety platform that helps caregivers and healthcare providers manage patient medications and reduce medication errors.

The system consists of:

- **Backend**: FastAPI API server
- **Frontend**: Next.js web interface
- **Database**: SQLite database

## Project Structure

```
bytecare/
│
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── main.py       # API entry point
│   │   ├── db.py         # Database configuration
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Pydantic schemas
│   │   ├── crud.py       # CRUD operations
│   │   ├── routers/      # API endpoints
│   │   └── services/     # Business logic
│   │
│   └── tests/            # Backend tests
│
├── frontend/             # Next.js frontend
│   └── src/
│       ├── app/          # App pages
│       ├── components/   # React components
│       └── lib/          # API utilities
│
├── scripts/
│   └── seed_and_demo.py  # Script to create demo data
│
└── bytecare.db           # SQLite database
```

## Installation

### 1. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
```

## Running the Application

You need two terminals.

### Start Backend (FastAPI)

```bash
cd backend
uvicorn app.main:app --reload
```

Backend will run at: http://localhost:8000

### Start Frontend (Next.js)

In another terminal:

```bash
cd frontend
npm run dev
```

Frontend will run at: http://localhost:3000

The frontend communicates with the FastAPI backend.

## Resetting the Demo Database

Demo data is seeded automatically on backend startup — no script needed.

To reset to clean demo data (e.g. after code changes), you must stop the backend first as the DB file is locked while the server is running.

**Windows:**
```cmd
taskkill /F /IM python.exe
del backend\bytecare.db
```

**Mac/Linux:**
```bash
pkill -f uvicorn
rm backend/bytecare.db
```

Then restart the backend. The DB will be recreated and all demo data re-seeded automatically.

## Viewing the Database

The project uses a SQLite database (`bytecare.db`).

To view the tables:

1. Install a VS Code extension: **SQLite Viewer**
2. Open the file: `bytecare.db`
3. The extension will display the database tables visually

## Demo Accounts

Demo patients and their caregivers are auto-seeded on first startup. 14 days of realistic dose history (with weekday/weekend timing differences and Thompson Sampling bandit data) is also auto-seeded so that adaptive learning features work immediately.

### Patient–Caregiver Pairs

| Patient | Email | Password | Caregiver | Email | Password |
|---------|-------|----------|-----------|-------|----------|
| Mdm Lim (72, Diabetes/Hypertension) | mdm.lim@demo.com | demo123 | Grace Lim | grace.lim@demo.com | demo123 |
| Mr Ong (65, AFib/Warfarin) | mr.ong@demo.com | demo123 | Daniel Ong | daniel.ong@demo.com | demo123 |
| Mrs Wong (58, Hypertension/CKD) | mrs.wong@demo.com | demo123 | Angela Wong | angela.wong@demo.com | demo123 |

### Clinician

| Email | Password |
|-------|----------|
| drchan@bytecare.com | clinician123 |

### Admin

| Email | Password |
|-------|----------|
| admin@bytecare.com | admin123 |

## Tech Stack

### Backend

- FastAPI
- SQLAlchemy
- Pydantic
- SQLite

### Frontend

- Next.js
- React
- TypeScript

