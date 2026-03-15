"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LayoutDashboard, Users, FileText, LogOut } from "lucide-react";
import {
  api,
  type Account,
  type AdminAccountItem,
  type AdminInterventionItem,
  type UserProfile,
} from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type Tab = "dashboard" | "users" | "logs" | "profile";

export default function AdminDashboard() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const accountId = decodeURIComponent(
    Array.isArray(params.accountId) ? params.accountId[0] : params.accountId ?? ""
  );

  // Auth
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
    if (!raw) { router.replace("/auth/signin"); return; }
    try {
      const acc = JSON.parse(raw) as Account;
      if (acc.role !== "admin") { router.replace("/auth/signin"); return; }
      setAccount(acc);
    } catch { router.replace("/auth/signin"); }
  }, [router]);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [accounts, setAccounts] = useState<AdminAccountItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [interventions, setInterventions] = useState<AdminInterventionItem[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acctRes, userRes, ivRes] = await Promise.all([
        api.adminGetAccounts().catch(() => ({ items: [] as AdminAccountItem[] })),
        api.getUsers().catch(() => ({ items: [] as UserProfile[] })),
        api.adminGetAllInterventions().catch(() => ({ items: [] as AdminInterventionItem[] })),
      ]);
      setAccounts(acctRes.items ?? []);
      setUsers(userRes.items ?? []);
      setInterventions(ivRes.items ?? []);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) void loadDashboard();
  }, [account, loadDashboard]);

  function handleSignOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  if (!account) return null;

  const navTabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={20} /> },
    { key: "users",     label: "Users",     icon: <Users size={20} /> },
    { key: "logs",      label: "Logs",      icon: <FileText size={20} /> },
    { key: "profile",   label: "Profile",   icon: <LogOut size={20} /> },
  ];

  const roleCounts = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.role] = (acc[a.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="relative flex min-h-screen w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col bg-slate-100">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {tab === "users" ? "👥 All Users" : tab === "logs" ? "📋 Intervention Logs" : tab === "profile" ? "⚙️ Profile" : "🏠 Admin Dashboard"}
              </h1>
              <p className="text-sm text-slate-500">{account.name} (Admin)</p>
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {loading && <div className="py-8 text-center text-slate-500">Loading…</div>}

          {/* ──── Dashboard ──── */}
          {tab === "dashboard" && !loading && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">📊 System Overview</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-blue-50 p-4 text-center">
                    <span className="text-3xl font-bold text-blue-600">{accounts.length}</span>
                    <p className="text-xs text-slate-500">Accounts</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4 text-center">
                    <span className="text-3xl font-bold text-emerald-600">{users.length}</span>
                    <p className="text-xs text-slate-500">Patient Profiles</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4 text-center">
                    <span className="text-3xl font-bold text-amber-600">{interventions.length}</span>
                    <p className="text-xs text-slate-500">Interventions</p>
                  </div>
                  <div className="rounded-2xl bg-purple-50 p-4 text-center">
                    <span className="text-3xl font-bold text-purple-600">{roleCounts["clinician"] ?? 0}</span>
                    <p className="text-xs text-slate-500">Clinicians</p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">🗂️ Roles Breakdown</h3>
                {Object.entries(roleCounts).map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between py-1">
                    <span className="text-sm text-slate-700 capitalize">{role}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-bold text-slate-600">{count}</span>
                  </div>
                ))}
              </section>
            </>
          )}

          {/* ──── Users Tab ──── */}
          {tab === "users" && !loading && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-bold text-slate-900">👥 All Accounts ({accounts.length})</h3>
              <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
                {accounts.map((a) => (
                  <div key={a.account_id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{a.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${
                        a.role === "admin" ? "bg-purple-100 text-purple-600"
                        : a.role === "clinician" ? "bg-blue-100 text-blue-600"
                        : a.role === "caregiver" ? "bg-amber-100 text-amber-600"
                        : "bg-emerald-100 text-emerald-600"
                      }`}>
                        {a.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{a.email}</p>
                    {a.user_id && <p className="text-xs text-slate-400">User ID: {a.user_id.slice(0, 8)}…</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ──── Logs Tab ──── */}
          {tab === "logs" && !loading && (
            <>
              {interventions.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center">
                  <p className="text-lg text-slate-500">📭 No intervention logs</p>
                  <p className="mt-1 text-sm text-slate-400">System-wide intervention events will appear here.</p>
                </div>
              ) : (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-lg font-bold text-slate-900">📝 Recent Interventions</h3>
                  <div className="space-y-2">
                    {interventions.map((iv, idx) => (
                      <div key={idx} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">{iv.patient_name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            iv.risk_level === "HIGH" ? "bg-red-100 text-red-600"
                            : iv.risk_level === "MEDIUM" ? "bg-amber-100 text-amber-600"
                            : "bg-emerald-50 text-emerald-600"
                          }`}>
                            {iv.risk_level}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">{iv.action_type.replace(/_/g, " ")} — {iv.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{new Date(iv.timestamp).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* ──── Profile Tab ──── */}
          {tab === "profile" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">👤 {account.name}</h3>
              <p className="text-sm text-slate-500">{account.email}</p>
              <p className="mt-1 text-xs text-slate-400">Role: Admin</p>
              <button
                type="button"
                onClick={handleSignOut}
                className="mt-6 w-full rounded-2xl bg-red-50 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
              >
                🚪 Sign Out
              </button>
            </section>
          )}
        </div>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl -translate-x-1/2 border-t border-slate-200 bg-white">
          {navTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-3 text-xs font-medium transition ${
                tab === t.key ? "bg-blue-50 text-blue-600 font-semibold" : "text-slate-400 hover:text-blue-500 hover:bg-slate-50"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
