"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, type Account, type UserProfile } from "../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

export default function SelectUserPage() {
  const router = useRouter();

  const [account, setAccount] = useState<Account | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setAccount(parsed);
        sessionStorage.setItem("bytecare_account", raw);
      } catch { /* ignore */ }
    }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    if (authChecked && !account) {
      router.replace("/auth/signin");
    }
  }, [authChecked, account, router]);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-patient form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("");
  const [newTimezone, setNewTimezone] = useState("Asia/Singapore");
  const [newLang, setNewLang] = useState("English");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.getUsers();
      const items = response.items ?? [];
      setUsers(items);

      if (items.length > 0) {
        setSelectedUserId((prev) => (prev && items.some((x) => x.user_id === prev) ? prev : items[0].user_id));
      } else {
        setSelectedUserId("");
      }
    } catch (loadError) {
      setUsers([]);
      setSelectedUserId("");
      setError(safeMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) void loadUsers();
  }, [account, loadUsers]);

  async function handleCreatePatient() {
    const trimmedName = newName.trim();
    const ageNum = parseInt(newAge, 10);
    if (!trimmedName || isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      setCreateError("Please enter a valid name and age (0–120).");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const created = await api.createUser({
        name: trimmedName,
        age: ageNum,
        timezone: newTimezone.trim() || "Asia/Singapore",
        language_preference: newLang.trim() || "English",
      });
      setShowCreate(false);
      setNewName("");
      setNewAge("");
      setNewTimezone("Asia/Singapore");
      setNewLang("English");
      await loadUsers();
      setSelectedUserId(created.user_id);
    } catch (e) {
      setCreateError(safeMessage(e));
    } finally {
      setCreateLoading(false);
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  if (!authChecked || !account) {
    return null;
  }

  return (
    <main className="demo-shell">
      <div className="phone-frame auth-frame">
        <header className="app-header">
          <div className="header-left">
            <div className="avatar">BC</div>
            <div className="header-copy">
              <h1>ByteCare</h1>
              <p className="muted">{account.name} ({account.role})</p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={handleSignOut}>Sign Out</button>
        </header>

        <section className="tab-body">
          {/* Create Patient Form */}
          <section className="card">
            <button
              type="button"
              className={showCreate ? "secondary-button" : ""}
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "Create New Patient"}
            </button>

            {showCreate ? (
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Mr Tan" />

                <label className="form-label">Age</label>
                <input type="number" min={0} max={120} value={newAge} onChange={(e) => setNewAge(e.target.value)} placeholder="e.g. 68" />

                <label className="form-label">Timezone</label>
                <input value={newTimezone} onChange={(e) => setNewTimezone(e.target.value)} placeholder="Asia/Singapore" />

                <label className="form-label">Language Preference</label>
                <input value={newLang} onChange={(e) => setNewLang(e.target.value)} placeholder="English" />

                {createError ? <p className="status-error">{createError}</p> : null}

                <button type="button" onClick={() => void handleCreatePatient()} disabled={createLoading}>
                  {createLoading ? "Creating..." : "Save Patient"}
                </button>
              </div>
            ) : null}
          </section>

          {/* Select Existing Patient */}
          <section className="card">
            <h2 className="auth-title">Select a Patient Profile</h2>
            <p className="muted">Choose an available demo user from the backend in-memory database.</p>

            <button type="button" className="secondary-button" onClick={() => void loadUsers()} disabled={loading}>
              {loading ? "Refreshing users..." : "Refresh users"}
            </button>

            {error ? <p className="status-error">{error}</p> : null}

            {!loading && users.length === 0 ? (
              <div className="empty-state">
                <p>No demo users found. Please seed a user first.</p>
                <p className="muted">Run `python scripts/seed_and_demo.py` on the backend, then tap Refresh users.</p>
              </div>
            ) : null}

            <div className="user-list">
              {users.map((user) => {
                const isActive = selectedUserId === user.user_id;
                return (
                  <button
                    key={user.user_id}
                    type="button"
                    className={isActive ? "user-card user-card-active" : "user-card"}
                    onClick={() => setSelectedUserId(user.user_id)}
                  >
                    <div className="user-card-name">{user.name}</div>
                    <div className="user-card-meta">Age {user.age} | {user.timezone}</div>
                    <div className="user-card-id">{user.user_id}</div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => router.push(`/dashboard/${selectedUserId}`)}
              disabled={!selectedUserId || loading}
            >
              Continue to Dashboard
            </button>
          </section>
        </section>
      </div>
    </main>
  );
}
