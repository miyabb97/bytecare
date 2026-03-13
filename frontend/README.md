# ByteCare Frontend

Next.js-based frontend for the ByteCare medication safety platform.

## Getting Started

### Installation

```bash
npm install
```

### Running the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How to Run the App

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

This starts the API server at [http://localhost:8000](http://localhost:8000).

### Frontend (Next.js)

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

This starts the frontend at [http://localhost:3000](http://localhost:3000).

Run both simultaneously — the frontend talks to the backend API.

## Seeding Demo Data

You need to run the seed script while the backend is running. In a terminal from the project root:

```bash
python scripts/seed_and_demo.py
```

Make sure your backend (`uvicorn`) is already running on [http://localhost:8000](http://localhost:8000) before executing this. The script will create a demo user ("Mr Tan") with medications and other seed data via the API.

After it finishes, go back to the frontend and tap **Refresh users** — the demo user should appear.

## Project Structure

- `src/` - Source code
  - `app/` - Next.js app directory
  - `components/` - React components
  - `lib/` - Utility functions and API client
