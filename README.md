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

## Seeding Demo Data

To populate the system with demo data:

1. Ensure the backend server is already running.
2. From the project root:

```bash
python scripts/seed_and_demo.py
```

This will create a demo user "Mr Tan" with medications and related records.

After running the script:
- Go to the frontend
- Click **Refresh Users**
- The demo user should appear

## Viewing the Database

The project uses a SQLite database (`bytecare.db`).

To view the tables:

1. Install a VS Code extension: **SQLite Viewer**
2. Open the file: `bytecare.db`
3. The extension will display the database tables visually

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
