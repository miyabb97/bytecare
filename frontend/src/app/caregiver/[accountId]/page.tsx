"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Users, UserCircle, Bell, LogOut } from "lucide-react";
import {
  api,
  type Account,
  type CaregiverPatientSummary,
  type CaregiverPatientDetail,
  type InterventionItem,
  type MedicationItem,
  type MEEScoreResponse,
} from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type Tab = "dashboard" | "patient" | "alerts" | "profile";

export default function CaregiverDashboard() {
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
      if (acc.role !== "caregiver") { router.replace("/auth/signin"); return; }
      setAccount(acc);
    } catch { router.replace("/auth/signin"); }
  }, [router]);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Patient list
  const [patients, setPatients] = useState<CaregiverPatientSummary[]>([]);

  // Detail view
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaregiverPatientDetail | null>(null);
  const [meeScore, setMeeScore] = useState<MEEScoreResponse | null>(null);

  // Med name lookup helper
  const medNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (detail) {
      for (const m of detail.medications) map.set(m.medication_id, m.name);
    }
    return map;
  }, [detail]);

  function medLabel(medId: string): string {
    return medNameMap.get(medId) || medId.slice(0, 8) + "…";
  }

  const loadPatients = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.caregiverGetPatients(accountId);
      setPatients(res.items ?? []);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (account) void loadPatients();
  }, [account, loadPatients]);

  async function openPatientDetail(userId: string) {
    setSelectedUserId(userId);
    setTab("patient");
    setLoading(true);
    setError(null);
    setDetail(null);
    setMeeScore(null);
    try {
      const [det, mee] = await Promise.all([
        api.caregiverGetPatientDetail(accountId, userId),
        api.getMEEScore(userId).catch(() => null),
      ]);
      setDetail(det);
      setMeeScore(mee);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Collect all interventions across loaded detail for the Alerts tab
  const alertInterventions = detail?.interventions ?? [];

  function handleSignOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  if (!account) return null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "Dashboard", icon: <Users size={20} /> },
    { key: "patient",   label: "Patient",   icon: <UserCircle size={20} /> },
    { key: "alerts",    label: "Alerts",     icon: <Bell size={20} /> },
    { key: "profile",   label: "Profile",   icon: <LogOut size={20} /> },
  ];

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="relative flex min-h-screen w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col bg-slate-100">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {tab === "patient" && detail ? detail.patient.name : tab === "alerts" ? "Alerts" : tab === "profile" ? "Profile" : "My Patients"}
              </h1>
              <p className="text-sm text-slate-500">Caregiver: {account.name}</p>
            </div>
            {tab === "patient" && detail && (
              <button
                type="button"
                onClick={() => { setTab("dashboard"); setDetail(null); setSelectedUserId(null); }}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                ← Back
              </button>
            )}
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          )}

          {loading && (
            <div className="py-8 text-center text-slate-500">Loading…</div>
          )}

          {/* ──── Dashboard (Patient List) ──── */}
          {tab === "dashboard" && !loading && (
            <>
              {patients.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center">
                  <p className="text-lg text-slate-500">No linked patients found.</p>
                  <p className="mt-1 text-sm text-slate-400">Ask a clinician to assign patients to your account.</p>
                </div>
              ) : (
                patients.map((p) => (
                  <button
                    key={p.user_id}
                    type="button"
                    onClick={() => void openPatientDetail(p.user_id)}
                    className="w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                        <p className="text-sm text-slate-500">Age {p.age} &middot; {p.conditions.length > 0 ? p.conditions.join(", ") : "No conditions"}</p>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <p>{p.medication_count} meds</p>
                        <p>{p.appointment_count} appts</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}

          {/* ──── Patient Detail ──── */}
          {tab === "patient" && !loading && detail && (
            <>
              {/* Profile & Adherence Score */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-xl font-bold text-slate-900">{detail.patient.name}</h3>
                <p className="text-sm text-slate-500">
                  Age {detail.patient.age} &middot; {(detail.patient.conditions ?? []).join(", ") || "No conditions"}
                </p>

                {meeScore && (
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-4xl font-bold text-blue-600">{Math.round(meeScore.score)}%</span>
                      <span className="text-xs text-slate-500">Adherence</span>
                    </div>
                    <div className="flex-1 space-y-1 text-sm text-slate-600">
                      <p>Taken: <span className="font-semibold text-emerald-600">{meeScore.counts.taken}</span></p>
                      <p>Missed: <span className="font-semibold text-red-600">{meeScore.counts.missed}</span></p>
                      <p>Window: last {meeScore.period_days} days</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                      meeScore.score < 50 ? "bg-red-100 text-red-600"
                      : meeScore.score < 75 ? "bg-amber-100 text-amber-600"
                      : "bg-emerald-100 text-emerald-600"
                    }`}>
                      {meeScore.score < 50 ? "HIGH" : meeScore.score < 75 ? "MEDIUM" : "LOW"}
                    </span>
                  </div>
                )}

                {meeScore && meeScore.score < 75 && (
                  <div className={`mt-3 flex items-center gap-2 rounded-2xl p-3 ${
                    meeScore.score < 50 ? "border border-red-200 bg-red-50" : "border border-amber-200 bg-amber-50"
                  }`}>
                    <span className="text-lg">⚠</span>
                    <p className={`text-sm font-medium ${meeScore.score < 50 ? "text-red-700" : "text-amber-700"}`}>
                      {meeScore.score < 50
                        ? "High risk — multiple doses missed. Needs immediate attention."
                        : "Moderate risk — some doses missed recently."}
                    </p>
                  </div>
                )}
              </section>

              {/* Medications */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">Medications ({detail.medications.length})</h3>
                {detail.medications.length === 0 ? (
                  <p className="text-sm text-slate-500">No medications recorded.</p>
                ) : (
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                    {detail.medications.map((med) => (
                      <div key={med.medication_id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="font-semibold text-slate-800">{med.name}</p>
                        <p className="text-xs text-slate-500">{med.dose_text} &middot; {med.schedule.frequency} &middot; {med.schedule.times.join(", ")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Dose Events — show medication NAME instead of ID */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">Recent Doses</h3>
                {detail.dose_events.length === 0 ? (
                  <p className="text-sm text-slate-500">No dose records yet.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.dose_events.slice(0, 10).map((ev) => (
                      <div key={ev.event_id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{medLabel(ev.medication_id)}</p>
                          <p className="text-xs text-slate-500">{ev.scheduled_for ? ev.scheduled_for.slice(11, 16) : new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                          ev.response_status === "taken" ? "bg-emerald-100 text-emerald-600"
                          : ev.response_status === "snoozed" ? "bg-blue-100 text-blue-600"
                          : ev.response_status === "late" ? "bg-amber-100 text-amber-600"
                          : ev.response_status === "skipped" ? "bg-slate-200 text-slate-500"
                          : "bg-red-100 text-red-600"
                        }`}>
                          {(ev.response_status || ev.event_type || "recorded").charAt(0).toUpperCase() + (ev.response_status || ev.event_type || "recorded").slice(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Interventions */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">Recent Interventions</h3>
                {detail.interventions.length === 0 ? (
                  <p className="text-sm text-slate-500">No interventions triggered yet.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.interventions.slice(0, 8).map((iv: InterventionItem, idx: number) => (
                      <div key={idx} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">{iv.action_type.replace(/_/g, " ")}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            iv.risk_level === "HIGH" ? "bg-red-100 text-red-600"
                            : iv.risk_level === "MEDIUM" ? "bg-amber-100 text-amber-600"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                            {iv.risk_level}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{iv.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{new Date(iv.timestamp).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Appointments */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">Appointments</h3>
                {detail.appointments.length === 0 ? (
                  <p className="text-sm text-slate-500">No appointments scheduled.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.appointments.map((appt) => (
                      <div key={appt.appointment_id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="font-semibold text-slate-800">{new Date(appt.datetime).toLocaleString()}</p>
                        <p className="text-xs text-slate-500">{appt.location}{appt.notes ? ` — ${appt.notes}` : ""}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ──── Patient Detail placeholder when no patient selected ──── */}
          {tab === "patient" && !loading && !detail && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-lg text-slate-500">No patient selected.</p>
              <p className="mt-1 text-sm text-slate-400">Go to Dashboard and tap a patient to view their details.</p>
            </div>
          )}

          {/* ──── Alerts Tab ──── */}
          {tab === "alerts" && !loading && (
            <>
              {alertInterventions.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center">
                  <p className="text-lg text-slate-500">No alerts</p>
                  <p className="mt-1 text-sm text-slate-400">Interventions and risk alerts for the selected patient will appear here.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-500">Showing alerts for {detail?.patient.name}</p>
                  {alertInterventions.map((iv: InterventionItem, idx: number) => (
                    <div key={idx} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800">{iv.action_type.replace(/_/g, " ")}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          iv.risk_level === "HIGH" ? "bg-red-100 text-red-600"
                          : iv.risk_level === "MEDIUM" ? "bg-amber-100 text-amber-600"
                          : "bg-slate-200 text-slate-500"
                        }`}>
                          {iv.risk_level}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{iv.message}</p>
                      <p className="mt-1 text-xs text-slate-400">{new Date(iv.timestamp).toLocaleString()}</p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* ──── Profile Tab ──── */}
          {tab === "profile" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">{account.name}</h3>
              <p className="text-sm text-slate-500">{account.email}</p>
              <p className="mt-1 text-xs text-slate-400">Role: Caregiver</p>
              <button
                type="button"
                onClick={handleSignOut}
                className="mt-6 w-full rounded-2xl bg-red-50 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
              >
                Sign Out
              </button>
            </section>
          )}
        </div>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl -translate-x-1/2 border-t border-slate-200 bg-white">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium transition ${
                tab === t.key ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
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
