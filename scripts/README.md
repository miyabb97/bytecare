# ByteCare Demo Setup

Demo data is seeded automatically on backend startup for the 3 demo patients:
- **Mdm Lim** (`mdm.lim@demo.com`) — best adherence, LOW risk
- **Mr Ong** (`mr.ong@demo.com`) — good adherence with some late doses, LOW risk
- **Mrs Wong** (`mrs.wong@demo.com`) — poor adherence, HIGH risk

---

## Resetting the Demo Database

You may need to reset the DB to get fresh seeded data (e.g. after code changes to the seeding logic).

**Step 1 — Stop the backend first** (the DB file is locked while the server is running):

On Windows CMD:
```
taskkill /F /IM python.exe
```

On Mac/Linux:
```
pkill -f uvicorn
```

**Step 2 — Delete the database:**

On Windows CMD:
```
del backend\bytecare.db
```

On Mac/Linux:
```
rm backend/bytecare.db
```

**Step 3 — Restart the backend:**

```
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The server will recreate the DB and seed all demo data automatically on startup.

> **Note:** Seed data is deterministic — everyone who resets and restarts gets the same starting data. Patient interactions after startup (marking doses, chat, etc.) will diverge from there.

---

## Legacy seed scripts

The original `seed_and_demo.*` scripts loaded `data/seeds/bytecare_seed_mrtan.json` via the API.
These are no longer needed — seeding is now handled automatically by the backend at startup.
