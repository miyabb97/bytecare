"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, type UserProfile } from "../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

export default function SelectUserPage() {
  const router = useRouter();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void loadUsers();
  }, [loadUsers]);

  return (
    <main className="demo-shell">
      <div className="phone-frame auth-frame">
        <header className="app-header">
          <div className="header-left">
            <div className="avatar">BC</div>
            <div>
              <h1>ByteCare</h1>
              <p className="muted">Demo Patient Access</p>
            </div>
          </div>
        </header>

        <section className="tab-body">
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
