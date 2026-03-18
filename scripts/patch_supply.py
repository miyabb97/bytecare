"""Patch existing demo patient medication supply quantities without wiping data."""

import sys
from pathlib import Path

# Allow imports from backend/app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.db import SessionLocal
from app.models import Medication, User

# target display name → supply quantity per medication
SUPPLY_MAP = {
    "Mdm Lim": 50,
    "Mr Ong": 50,
    "Mrs Wong": 15,
}

with SessionLocal() as db:
    updated = 0
    for display_name, supply in SUPPLY_MAP.items():
        user = db.query(User).filter_by(name=display_name).first()
        if not user:
            print(f"  [!] User not found: {display_name}")
            continue
        meds = db.query(Medication).filter_by(user_id=user.user_id).all()
        for med in meds:
            med.total_supply = supply
            updated += 1
            print(f"  [+] {user.name} — {med.name}: total_supply = {supply}")
    db.commit()
    print(f"\nDone. Updated {updated} medication(s).")
