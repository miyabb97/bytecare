"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default function SignUpPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "caregiver" | "clinician">("patient");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    setError(null);
    try {
      await api.signUp({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
      router.push("/auth/signin");
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="demo-shell">
      <div className="phone-frame auth-frame">
        <header className="app-header">
          <div className="header-left">
            <div className="avatar">BC</div>
            <div className="header-copy">
              <h1>ByteCare</h1>
              <p className="muted">Create Account</p>
            </div>
          </div>
        </header>

        <section className="tab-body">
          <section className="card">
            <h2 className="auth-title">Sign Up</h2>
            <p className="muted">Register as a patient, caregiver, or clinician.</p>

            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
              />

              <label className="form-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />

              <label className="form-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />

              <label className="form-label">I am a...</label>
              <div className="role-picker">
                <button
                  type="button"
                  className={role === "patient" ? "role-btn role-btn-active" : "role-btn"}
                  onClick={() => setRole("patient")}
                >
                  Patient
                </button>
                <button
                  type="button"
                  className={role === "caregiver" ? "role-btn role-btn-active" : "role-btn"}
                  onClick={() => setRole("caregiver")}
                >
                  Caregiver
                </button>
                <button
                  type="button"
                  className={role === "clinician" ? "role-btn role-btn-active" : "role-btn"}
                  onClick={() => setRole("clinician")}
                >
                  Clinician
                </button>
              </div>

              {error ? <p className="status-error">{error}</p> : null}

              <button type="button" onClick={() => void handleSignUp()} disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => router.push("/auth/signin")}
              >
                Already have an account? Sign In
              </button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
