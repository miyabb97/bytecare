"""End-to-end test for Phase 11 backend features."""
import requests, json

BASE = "http://127.0.0.1:8000/api/v1"

def _items(resp):
    """Extract list from response - handles both list and {items:[...]} formats."""
    data = resp.json()
    if isinstance(data, dict) and "items" in data:
        return data["items"]
    if isinstance(data, list):
        return data
    return [data]

def test():
    # 1. Sign in as caregiver
    r = requests.post(f"{BASE}/auth/signin", json={"email": "grace.lim@demo.com", "password": "demo123"})
    print("1. Caregiver login:", r.status_code)
    cg = r.json()
    cg_account = cg.get("account_id", "FAIL")
    print("   account_id:", cg_account)

    # 2. List caregiver's patients
    r = requests.get(f"{BASE}/caregiver/{cg_account}/patients")
    patients = _items(r)
    print("2. Caregiver patients:", r.status_code, "count:", len(patients))
    if patients:
        patient = patients[0]
        print("   Patient:", patient["name"], "uid:", patient["user_id"])

    # 3. Sign in as Mdm Lim
    r = requests.post(f"{BASE}/auth/signin", json={"email": "mdm.lim@demo.com", "password": "demo123"})
    print("3. Patient login:", r.status_code)
    p = r.json()
    uid = p["user_id"]
    print("   user_id:", uid)

    # 4. MEE score (no events yet)
    r = requests.get(f"{BASE}/users/{uid}/mee")
    print("4. MEE score:", r.status_code, r.json())

    # 5. Drift
    r = requests.get(f"{BASE}/users/{uid}/drift")
    print("5. Drift:", r.status_code, r.json())

    # 6. Simulate some dose events
    meds_r = requests.get(f"{BASE}/users/{uid}/medications")
    meds = _items(meds_r)
    if meds:
        med_id = meds[0]["medication_id"]
        print("6. First med:", meds[0]["name"], med_id)

        # Log some events: 3 taken, 1 missed, 1 late
        from datetime import datetime
        now = datetime.now().isoformat(timespec="seconds")
        for status in ["taken", "taken", "taken", "missed", "late"]:
            r = requests.post(f"{BASE}/users/{uid}/dose-events/intake", json={
                "medication_ids": [med_id],
                "scheduled_for": now,
                "response_status": status,
                "source": "smart_tracker"
            })
            print(f"   Log {status}:", r.status_code)
    else:
        print("6. No medications found")

    # 7. MEE score after events
    r = requests.get(f"{BASE}/users/{uid}/mee")
    print("7. MEE after events:", r.status_code, r.json())

    # 8. Per-medication scores
    r = requests.get(f"{BASE}/users/{uid}/mee/medications")
    print("8. Per-med MEE:", r.status_code, r.json())

    # 9. Orchestrate
    r = requests.post(f"{BASE}/users/{uid}/orchestrate")
    print("9. Orchestrate:", r.status_code)
    if r.status_code == 200:
        orch = r.json()
        print("   risk:", orch.get("risk_level"), "action:", orch.get("action"))
        print("   message:", orch.get("message", "")[:100])

    # 10. Intervention log
    r = requests.get(f"{BASE}/users/{uid}/interventions")
    interventions = _items(r)
    print("10. Interventions:", r.status_code, "count:", len(interventions))

    # 11. Chat messages (should have system message from orchestrator)
    r = requests.get(f"{BASE}/users/{uid}/chat/messages")
    msgs = _items(r)
    print("11. Chat messages:", r.status_code, "count:", len(msgs))
    for m in msgs:
        print(f"    [{m['role']}] read={m['is_read']}: {m['content'][:80]}")

    # 12. Unread count
    r = requests.get(f"{BASE}/users/{uid}/chat/unread-count")
    print("12. Unread count:", r.status_code, r.json())

    # 13. Caregiver view of patient detail
    r = requests.get(f"{BASE}/caregiver/{cg_account}/patients/{uid}")
    print("13. Caregiver patient detail:", r.status_code)
    if r.status_code == 200:
        detail = r.json()
        print("   dose_events:", len(detail.get("dose_events", [])))
        print("   interventions:", len(detail.get("interventions", [])))

    # 14. Test chat persistence
    r = requests.post(f"{BASE}/users/{uid}/chat", json={"message": "How are my medications?", "language": "en"})
    print("14. Chat:", r.status_code)
    if r.status_code == 200:
        print("   reply:", r.json().get("reply", "")[:100])

    # 15. Check messages again (should have user+assistant)
    r = requests.get(f"{BASE}/users/{uid}/chat/messages")
    msgs2 = _items(r)
    print("15. All messages now:", len(msgs2))
    for m in msgs2[-3:]:
        print(f"    [{m['role']}] {m['content'][:80]}")

    # 16. Verify existing features - clinician login
    r = requests.post(f"{BASE}/auth/signin", json={"email": "drchan@bytecare.com", "password": "clinician123"})
    print("16. Clinician login:", r.status_code, "role:", r.json().get("role"))

    print("\n=== ALL TESTS COMPLETE ===")

if __name__ == "__main__":
    test()
