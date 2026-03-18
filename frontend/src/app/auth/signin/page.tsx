"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default function SignInPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill saved credentials on mount
  useEffect(() => {
    const saved = localStorage.getItem("bytecare_remember");
    if (saved) {
      try {
        const { email: savedEmail, password: savedPassword } = JSON.parse(saved);
        setEmail(savedEmail ?? "");
        setPassword(savedPassword ?? "");
        setRememberMe(true);
      } catch { /* ignore */ }
    }
  }, []);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const account = await api.signIn({ email: email.trim(), password });
      // Store session (also persist account so redirected pages can read it)
      sessionStorage.setItem("bytecare_account", JSON.stringify(account));
      localStorage.setItem("bytecare_account", JSON.stringify(account));
      // Remember credentials if checked
      if (rememberMe) {
        localStorage.setItem("bytecare_remember", JSON.stringify({ email: email.trim(), password }));
      } else {
        localStorage.removeItem("bytecare_remember");
        // keep `bytecare_account` persisted so a reload still shows the caregiver view
      }
      // Go directly to dashboard if user profile is linked, otherwise to profile select
      if (account.role === "clinician") {
        router.push(`/clinician/${account.account_id}`);
      } else if (account.role === "caregiver") {
        router.push(`/caregiver/${account.account_id}`);
      } else if (account.role === "admin") {
        router.push(`/admin/${account.account_id}`);
      } else if (account.user_id) {
        router.push(`/dashboard/${account.user_id}`);
      } else {
        router.push("/");
      }
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
              <p className="muted">Sign In</p>
            </div>
          </div>
        </header>

        <section className="tab-body">
          <section className="card">
            <h2 className="auth-title">Sign In</h2>
            <p className="muted">Log into your ByteCare account.</p>

            <div className="form-group">
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
                placeholder="Enter password"
                onKeyDown={(e) => { if (e.key === "Enter") void handleSignIn(); }}
              />

              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>

              {error ? <p className="status-error">{error}</p> : null}

              <button type="button" onClick={() => void handleSignIn()} disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => router.push("/auth/signup")}
              >
                Don&apos;t have an account? Sign Up
              </button>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <p className="muted" style={{ marginBottom: "0.5rem" }}>Quick login:</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {/* --- Mdm Lim & Caregiver --- */}
                <p className="muted" style={{ fontSize: "0.7rem", margin: 0, fontWeight: 600 }}>Mdm Lim (72, Diabetes/Hypertension)</p>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {[
                    { label: "Patient", email: "mdm.lim@demo.com", password: "demo123" },
                    { label: "Caregiver (Grace)", email: "grace.lim@demo.com", password: "demo123" },
                  ].map((demo) => (
                    <button key={demo.email} type="button" className="secondary-button"
                      style={{ flex: 1, textAlign: "center", padding: "0.35rem 0.5rem", fontSize: "0.75rem" }}
                      onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>
                      {demo.label}
                    </button>
                  ))}
                </div>

                {/* --- Mr Ong & Caregiver --- */}
                <p className="muted" style={{ fontSize: "0.7rem", margin: 0, fontWeight: 600 }}>Mr Ong (65, AFib/Warfarin)</p>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {[
                    { label: "Patient", email: "mr.ong@demo.com", password: "demo123" },
                    { label: "Caregiver (Daniel)", email: "daniel.ong@demo.com", password: "demo123" },
                  ].map((demo) => (
                    <button key={demo.email} type="button" className="secondary-button"
                      style={{ flex: 1, textAlign: "center", padding: "0.35rem 0.5rem", fontSize: "0.75rem" }}
                      onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>
                      {demo.label}
                    </button>
                  ))}
                </div>

                {/* --- Mrs Wong & Caregiver --- */}
                <p className="muted" style={{ fontSize: "0.7rem", margin: 0, fontWeight: 600 }}>Mrs Wong (58, Hypertension/CKD)</p>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {[
                    { label: "Patient", email: "mrs.wong@demo.com", password: "demo123" },
                    { label: "Caregiver (Angela)", email: "angela.wong@demo.com", password: "demo123" },
                  ].map((demo) => (
                    <button key={demo.email} type="button" className="secondary-button"
                      style={{ flex: 1, textAlign: "center", padding: "0.35rem 0.5rem", fontSize: "0.75rem" }}
                      onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>
                      {demo.label}
                    </button>
                  ))}
                </div>

                {/* --- Clinician --- */}
                <p className="muted" style={{ fontSize: "0.7rem", margin: 0, fontWeight: 600 }}>Clinician</p>
                <button type="button" className="secondary-button"
                  style={{ textAlign: "center", padding: "0.35rem 0.5rem", fontSize: "0.75rem" }}
                  onClick={() => { setEmail("drchan@bytecare.com"); setPassword("clinician123"); }}>
                  Dr Chan
                </button>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
