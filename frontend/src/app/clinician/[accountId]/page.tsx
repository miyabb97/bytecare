"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LayoutDashboard, Users, FileText, LogOut } from "lucide-react";
import {
  api,
  type Account,
  type ClinicianPatientSummary,
  type ClinicianAllPatientItem,
  type MedicationItem,
  type AppointmentItem,
  type MEEScoreResponse,
  type DriftResponse,
  type InterventionItem,
  type ReportSummaryResponse,
  type WeeklySummaryResponse,
  type TCMWarningItem,
  type CommunityEventItem,
  type DoseEventItem,
} from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type Tab = "dashboard" | "patients" | "summary" | "profile";

export default function ClinicianDashboard() {
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
      if (acc.role !== "clinician") { router.replace("/auth/signin"); return; }
      setAccount(acc);
    } catch { router.replace("/auth/signin"); }
  }, [router]);

  // View state
  const [tab, setTab] = useState<Tab>("dashboard");
  const [detailView, setDetailView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Patient list
  const [myPatients, setMyPatients] = useState<ClinicianPatientSummary[]>([]);

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [allPatients, setAllPatients] = useState<ClinicianAllPatientItem[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  // Patient detail
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState(0);
  const [patientConditions, setPatientConditions] = useState<string[]>([]);
  const [patientMeds, setPatientMeds] = useState<MedicationItem[]>([]);
  const [patientAppts, setPatientAppts] = useState<AppointmentItem[]>([]);

  // Adherence / risk overlay data
  const [meeScore, setMeeScore] = useState<MEEScoreResponse | null>(null);
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [interventions, setInterventions] = useState<InterventionItem[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummaryResponse | null>(null);

  // New enriched data from expanded patient detail
  const [doseEvents, setDoseEvents] = useState<DoseEventItem[]>([]);
  const [foodRecommendations, setFoodRecommendations] = useState<string[]>([]);
  const [communityJoined, setCommunityJoined] = useState<CommunityEventItem[]>([]);
  const [tcmWarnings, setTcmWarnings] = useState<TCMWarningItem[]>([]);

  // Weekly summary
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Conditions edit
  const [editingConditions, setEditingConditions] = useState(false);
  const [conditionsText, setConditionsText] = useState("");
  const [conditionsSaving, setConditionsSaving] = useState(false);

  // Med form
  const [showMedForm, setShowMedForm] = useState(false);
  const [editMedId, setEditMedId] = useState<string | null>(null);
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [medFreq, setMedFreq] = useState("once_daily");
  const [medTimes, setMedTimes] = useState("08:00");
  const [medWindow, setMedWindow] = useState("120");
  const [medCrit, setMedCrit] = useState("medium");
  const [medSaving, setMedSaving] = useState(false);
  const [medMsg, setMedMsg] = useState<string | null>(null);

  // Appt form
  const [showApptForm, setShowApptForm] = useState(false);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [apptDatetime, setApptDatetime] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [apptSaving, setApptSaving] = useState(false);
  const [apptMsg, setApptMsg] = useState<string | null>(null);

  // Load my patients
  const loadMyPatients = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.clinicianGetPatients(accountId);
      setMyPatients(res.items ?? []);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (account) void loadMyPatients();
  }, [account, loadMyPatients]);

  // Load all patients for assign
  async function loadAllPatients() {
    setAssignLoading(true);
    try {
      const res = await api.clinicianGetAllPatients(accountId);
      setAllPatients(res.items ?? []);
    } catch { setAllPatients([]); }
    finally { setAssignLoading(false); }
  }

  async function handleAssign(patientUserId: string) {
    try {
      await api.clinicianAssignPatient(accountId, patientUserId);
      await loadAllPatients();
      await loadMyPatients();
    } catch (e) {
      setError(safeMessage(e));
    }
  }

  async function handleUnassign(patientUserId: string) {
    try {
      await api.clinicianUnassignPatient(accountId, patientUserId);
      await loadMyPatients();
      if (selectedPatientId === patientUserId) {
        setDetailView(false);
        setSelectedPatientId(null);
      }
    } catch (e) {
      setError(safeMessage(e));
    }
  }

  // Open patient detail — also fetch adherence/risk data
  async function openPatientDetail(patientUserId: string) {
    setLoading(true);
    setError(null);
    setMeeScore(null);
    setDrift(null);
    setInterventions([]);
    setReportSummary(null);
    setDoseEvents([]);
    setFoodRecommendations([]);
    setCommunityJoined([]);
    setTcmWarnings([]);
    setWeeklySummary(null);
    try {
      const [res, rptRes] = await Promise.all([
        api.clinicianGetPatientDetail(accountId, patientUserId),
        api.getReportSummary(patientUserId).catch(() => null),
      ]);
      setSelectedPatientId(patientUserId);
      setPatientName(res.patient.name);
      setPatientAge(res.patient.age);
      setPatientConditions(res.patient.conditions ?? []);
      setPatientMeds(res.medications ?? []);
      setPatientAppts(res.appointments ?? []);

      // Set enriched data from expanded detail endpoint
      setDoseEvents(res.dose_events ?? []);
      setInterventions(res.interventions ?? []);
      if (res.drift) setDrift(res.drift);
      if (res.mee) setMeeScore(res.mee);
      if (res.food_recommendations?.recommendations) {
        setFoodRecommendations(res.food_recommendations.recommendations);
      }
      setCommunityJoined(res.community_events?.joined ?? []);
      setTcmWarnings(res.tcm_warnings ?? []);
      setReportSummary(rptRes);
      setDetailView(true);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function reloadPatientDetail() {
    if (!selectedPatientId) return;
    try {
      const res = await api.clinicianGetPatientDetail(accountId, selectedPatientId);
      setPatientConditions(res.patient.conditions ?? []);
      setPatientMeds(res.medications ?? []);
      setPatientAppts(res.appointments ?? []);
      setDoseEvents(res.dose_events ?? []);
      setInterventions(res.interventions ?? []);
      if (res.drift) setDrift(res.drift);
      if (res.mee) setMeeScore(res.mee);
      if (res.food_recommendations?.recommendations) {
        setFoodRecommendations(res.food_recommendations.recommendations);
      }
      setCommunityJoined(res.community_events?.joined ?? []);
      setTcmWarnings(res.tcm_warnings ?? []);
    } catch {}
  }

  // Conditions
  function startEditConditions() {
    setConditionsText(patientConditions.join(", "));
    setEditingConditions(true);
  }

  async function handleSaveConditions() {
    if (!selectedPatientId) return;
    setConditionsSaving(true);
    try {
      const conditions = conditionsText.split(",").map(c => c.trim()).filter(Boolean);
      await api.clinicianUpdateConditions(accountId, selectedPatientId, conditions);
      setPatientConditions(conditions);
      setEditingConditions(false);
    } catch (e) { setError(safeMessage(e)); }
    finally { setConditionsSaving(false); }
  }

  // Med CRUD
  function resetMedForm() {
    setShowMedForm(false); setEditMedId(null);
    setMedName(""); setMedDose(""); setMedFreq("once_daily");
    setMedTimes("08:00"); setMedWindow("120"); setMedCrit("medium"); setMedMsg(null);
  }

  function startEditMed(med: MedicationItem) {
    setEditMedId(med.medication_id);
    setMedName(med.name); setMedDose(med.dose_text);
    setMedFreq(med.schedule.frequency); setMedTimes(med.schedule.times.join(", "));
    setMedWindow(String(med.time_window_minutes)); setMedCrit(med.criticality);
    setShowMedForm(true); setMedMsg(null);
  }

  async function handleSaveMed() {
    if (!selectedPatientId) return;
    if (!medName.trim()) { setMedMsg("Name is required."); return; }
    const times = medTimes.split(",").map(t => t.trim()).filter(Boolean);
    const payload = {
      name: medName.trim(), dose_text: medDose.trim(),
      schedule: { frequency: medFreq, times },
      time_window_minutes: parseInt(medWindow, 10) || 120, criticality: medCrit,
    };
    setMedSaving(true); setMedMsg(null);
    try {
      if (editMedId) {
        await api.clinicianUpdateMedication(accountId, selectedPatientId, editMedId, payload);
      } else {
        await api.clinicianAddMedication(accountId, selectedPatientId, payload);
      }
      resetMedForm();
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setMedMsg(safeMessage(e)); }
    finally { setMedSaving(false); }
  }

  async function handleDeleteMed(medId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteMedication(accountId, selectedPatientId, medId);
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setMedMsg(safeMessage(e)); }
  }

  // Appt CRUD
  function resetApptForm() {
    setShowApptForm(false); setEditApptId(null);
    setApptDatetime(""); setApptLocation(""); setApptNotes(""); setApptMsg(null);
  }

  function startEditAppt(appt: AppointmentItem) {
    setEditApptId(appt.appointment_id);
    setApptDatetime(appt.datetime.slice(0, 16));
    setApptLocation(appt.location); setApptNotes(appt.notes);
    setShowApptForm(true); setApptMsg(null);
  }

  async function handleSaveAppt() {
    if (!selectedPatientId) return;
    if (!apptDatetime) { setApptMsg("Date & time required."); return; }
    const payload = { datetime: apptDatetime, location: apptLocation.trim(), notes: apptNotes.trim() };
    setApptSaving(true); setApptMsg(null);
    try {
      if (editApptId) {
        await api.clinicianUpdateAppointment(accountId, selectedPatientId, editApptId, payload);
      } else {
        await api.clinicianAddAppointment(accountId, selectedPatientId, payload);
      }
      resetApptForm();
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setApptMsg(safeMessage(e)); }
    finally { setApptSaving(false); }
  }

  async function handleDeleteAppt(apptId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteAppointment(accountId, selectedPatientId, apptId);
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setApptMsg(safeMessage(e)); }
  }

  function handleSignOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  // Load weekly summary for the selected patient
  async function loadWeeklySummary(patientUserId: string) {
    setSummaryLoading(true);
    setWeeklySummary(null);
    try {
      const res = await api.clinicianGetWeeklySummary(accountId, patientUserId);
      setWeeklySummary(res);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setSummaryLoading(false);
    }
  }

  if (!account) return null;

  const navTabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={20} /> },
    { key: "patients",  label: "Patients",  icon: <Users size={20} /> },
    { key: "summary",   label: "Outcomes",   icon: <FileText size={20} /> },
    { key: "profile",   label: "Profile",   icon: <LogOut size={20} /> },
  ];

  // Helper: input styles
  const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none";
  const selectCls = inputCls;
  const btnPrimary = "rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50";
  const btnSecondary = "rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200";
  const btnDanger = "rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100";

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="relative flex min-h-screen w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col bg-slate-100">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {detailView ? `👤 ${patientName}` : tab === "summary" ? "📊 Weekly Outcomes" : tab === "profile" ? "⚙️ Profile" : "🩺 Clinician Dashboard"}
              </h1>
              <p className="text-sm text-slate-500">{account.name} (Clinician)</p>
            </div>
            {detailView && (
              <button type="button" onClick={() => { setDetailView(false); setSelectedPatientId(null); }} className={btnSecondary}>
                ← Back
              </button>
            )}
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {loading && <div className="py-8 text-center text-slate-500">Loading…</div>}

          {/* ============ DASHBOARD TAB — overview cards ============ */}
          {tab === "dashboard" && !detailView && !loading && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">📊 Overview</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-blue-50 p-4 text-center">
                    <span className="text-3xl font-bold text-blue-600">{myPatients.length}</span>
                    <p className="text-xs text-slate-500">Patients</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4 text-center">
                    <span className="text-3xl font-bold text-emerald-600">{myPatients.reduce((a, p) => a + p.medication_count, 0)}</span>
                    <p className="text-xs text-slate-500">Total Meds</p>
                  </div>
                </div>
              </section>
              {myPatients.length > 0 && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-lg font-bold text-slate-900">⚡ Quick Access</h3>
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
                    {myPatients.slice(0, 5).map((p) => (
                      <button key={p.user_id} type="button" onClick={() => { setTab("patients"); void openPatientDetail(p.user_id); }}
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:border-blue-200">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-500">Age {p.age} &middot; {p.medication_count} meds</p>
                        </div>
                        <span className="text-xs text-slate-400">&rarr;</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* ============ PATIENTS TAB — list view ============ */}
          {tab === "patients" && !detailView && !loading && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">👥 My Patients</h3>
                  <button type="button" className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                    onClick={() => { setShowAssign(true); void loadAllPatients(); }}>
                    + Assign
                  </button>
                </div>

                {myPatients.length === 0 ? (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-slate-500">No patients assigned yet.</p>
                    <p className="text-xs text-slate-400">Use &ldquo;+ Assign&rdquo; to add patients.</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
                    {myPatients.map((p) => (
                      <div key={p.user_id}
                        className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 cursor-pointer transition hover:border-blue-200"
                        onClick={() => void openPatientDetail(p.user_id)}>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            Age {p.age} &middot; {p.medication_count} med(s) &middot; {p.appointment_count} appt(s)
                          </p>
                          {p.conditions.length > 0 && <p className="text-xs text-slate-400">{p.conditions.join(", ")}</p>}
                        </div>
                        <button type="button" className={btnDanger} onClick={(e) => { e.stopPropagation(); void handleUnassign(p.user_id); }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Assign Patient Modal */}
              {showAssign && (
                <section className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">➕ Assign a Patient</h3>
                    <button type="button" className={btnSecondary} onClick={() => setShowAssign(false)}>Close</button>
                  </div>
                  {assignLoading && <p className="mt-2 text-sm text-slate-500">Loading patients…</p>}
                  <div className="mt-3 space-y-2">
                    {allPatients.map((p) => {
                      const isAssignedToMe = myPatients.some(mp => mp.user_id === p.user_id);
                      const isAssignedToOther = !isAssignedToMe && !!p.assigned_clinician_id;
                      return (
                        <div key={p.user_id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                            <p className="text-xs text-slate-500">
                              Age {p.age}
                              {isAssignedToMe ? " — Assigned to you" : ""}
                              {isAssignedToOther ? " — Assigned to another clinician" : ""}
                            </p>
                          </div>
                          {!isAssignedToMe && !isAssignedToOther && (
                            <button type="button" className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                              onClick={() => void handleAssign(p.user_id)}>
                              Assign
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {/* ============ PATIENT DETAIL ============ */}
          {detailView && selectedPatientId && !loading && (
            <>
              {/* Patient Info + Adherence Score */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{patientName}</h3>
                    <p className="text-sm text-slate-500">Age: {patientAge}</p>
                  </div>
                  <button type="button" className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                    onClick={() => { setTab("summary"); setDetailView(false); void loadWeeklySummary(selectedPatientId); }}>
                    📊 Review Outcomes
                  </button>
                </div>

                {/* Adherence Score */}
                {meeScore && (
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-4xl font-bold text-blue-600">{Math.round(meeScore.score)}%</span>
                      <span className="text-xs text-slate-500">Adherence</span>
                    </div>
                    <div className="flex-1 space-y-1 text-sm text-slate-600">
                      <p>Taken: <span className="font-semibold text-emerald-600">{meeScore.counts.taken}</span></p>
                      <p>Missed: <span className="font-semibold text-red-600">{meeScore.counts.missed}</span></p>
                      <p>Late: <span className="font-semibold text-amber-600">{meeScore.counts.late}</span></p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                      meeScore.score < 50 ? "bg-red-100 text-red-600"
                      : meeScore.score < 75 ? "bg-amber-100 text-amber-600"
                      : "bg-emerald-100 text-emerald-600"
                    }`}>
                      {meeScore.score < 50 ? "HIGH RISK" : meeScore.score < 75 ? "MEDIUM" : "LOW RISK"}
                    </span>
                  </div>
                )}

                {/* Drift Alert */}
                {drift && drift.drift_detected && (
                  <div className={`mt-3 flex items-center gap-2 rounded-2xl p-3 ${
                    drift.severity === "red" ? "border border-red-200 bg-red-50"
                    : drift.severity === "orange" ? "border border-orange-200 bg-orange-50"
                    : "border border-amber-200 bg-amber-50"
                  }`}>
                    <span className="text-lg">⚠</span>
                    <div>
                      <p className={`text-sm font-bold ${
                        drift.severity === "red" ? "text-red-700"
                        : drift.severity === "orange" ? "text-orange-700"
                        : "text-amber-700"
                      }`}>
                        Drift Detected — {drift.severity.toUpperCase()}
                      </p>
                      <p className={`text-xs ${
                        drift.severity === "red" ? "text-red-600"
                        : drift.severity === "orange" ? "text-orange-600"
                        : "text-amber-600"
                      }`}>
                        {drift.trigger} &middot; {drift.details.missed_doses} missed &middot; {drift.details.late_doses} late &middot; Avg MES {drift.details.avg_mes}
                      </p>
                    </div>
                  </div>
                )}

                {/* Conditions */}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">Conditions</span>
                  {!editingConditions && (
                    <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={startEditConditions}>Edit</button>
                  )}
                </div>
                {!editingConditions ? (
                  <p className="text-sm text-slate-500">{patientConditions.length > 0 ? patientConditions.join(", ") : "None listed"}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <input value={conditionsText} onChange={(e) => setConditionsText(e.target.value)} placeholder="e.g. Hypertension, Diabetes"
                      className={inputCls} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleSaveConditions()} disabled={conditionsSaving} className={btnPrimary}>
                        {conditionsSaving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className={btnSecondary} onClick={() => setEditingConditions(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </section>

              {/* TCM Safety Warnings */}
              {tcmWarnings.length > 0 && (
                <section className="rounded-3xl border border-red-200 bg-red-50/50 p-5 shadow-sm">
                  <h3 className="mb-3 text-lg font-bold text-red-800">🌿 TCM Safety Alerts</h3>
                  <div className="space-y-2">
                    {tcmWarnings.map((w, idx) => (
                      <div key={idx} className="rounded-2xl border border-red-100 bg-white px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">{w.herb}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            w.risk_level === "high" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                          }`}>{w.risk_level.toUpperCase()}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">Affects: {w.flagged_medications.join(", ")}</p>
                        {w.guidance && <p className="mt-1 text-xs text-slate-500">{w.guidance}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Medications */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">💊 Medications</h3>
                  <button type="button" className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                    onClick={() => { resetMedForm(); setShowMedForm(true); }}>+ Add</button>
                </div>

                {showMedForm && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
                    <label className="text-xs font-medium text-slate-600">Name</label>
                    <input value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="e.g. Amlodipine 5mg" className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Dose Text</label>
                    <input value={medDose} onChange={(e) => setMedDose(e.target.value)} placeholder="e.g. 5mg" className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Frequency</label>
                    <select value={medFreq} onChange={(e) => setMedFreq(e.target.value)} className={selectCls}>
                      <option value="once_daily">Once daily</option>
                      <option value="twice_daily">Twice daily</option>
                      <option value="thrice_daily">Thrice daily</option>
                      <option value="as_needed">As needed</option>
                    </select>
                    <label className="text-xs font-medium text-slate-600">Times (comma-separated)</label>
                    <input value={medTimes} onChange={(e) => setMedTimes(e.target.value)} placeholder="08:00" className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Window (minutes)</label>
                    <input type="number" value={medWindow} onChange={(e) => setMedWindow(e.target.value)} className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Criticality</label>
                    <select value={medCrit} onChange={(e) => setMedCrit(e.target.value)} className={selectCls}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    {medMsg && <p className="text-xs text-red-600">{medMsg}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleSaveMed()} disabled={medSaving} className={btnPrimary}>
                        {medSaving ? "Saving…" : editMedId ? "Update" : "Add Medication"}
                      </button>
                      <button type="button" className={btnSecondary} onClick={resetMedForm}>Cancel</button>
                    </div>
                  </div>
                )}

                {patientMeds.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No medications prescribed yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {patientMeds.map((med) => (
                      <div key={med.medication_id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{med.name}</p>
                          <p className="text-xs text-slate-500">{med.dose_text} &middot; {med.schedule.frequency} &middot; {med.schedule.times.join(", ")} &middot; {med.criticality}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={() => startEditMed(med)}>Edit</button>
                          <button type="button" className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => void handleDeleteMed(med.medication_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Appointments */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">📅 Appointments</h3>
                  <button type="button" className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                    onClick={() => { resetApptForm(); setShowApptForm(true); }}>+ Add</button>
                </div>

                {showApptForm && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
                    <label className="text-xs font-medium text-slate-600">Date &amp; Time</label>
                    <input type="datetime-local" value={apptDatetime} onChange={(e) => setApptDatetime(e.target.value)} className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Location</label>
                    <input value={apptLocation} onChange={(e) => setApptLocation(e.target.value)} placeholder="e.g. Polyclinic" className={inputCls} />
                    <label className="text-xs font-medium text-slate-600">Notes</label>
                    <textarea value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} placeholder="e.g. Follow-up visit"
                      className={inputCls + " min-h-[60px] resize-none"} />
                    {apptMsg && <p className="text-xs text-red-600">{apptMsg}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleSaveAppt()} disabled={apptSaving} className={btnPrimary}>
                        {apptSaving ? "Saving…" : editApptId ? "Update" : "Add Appointment"}
                      </button>
                      <button type="button" className={btnSecondary} onClick={resetApptForm}>Cancel</button>
                    </div>
                  </div>
                )}

                {patientAppts.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No appointments scheduled.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {patientAppts.map((appt) => (
                      <div key={appt.appointment_id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{new Date(appt.datetime).toLocaleString()}</p>
                          <p className="text-xs text-slate-500">{appt.location}{appt.notes ? ` — ${appt.notes}` : ""}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={() => startEditAppt(appt)}>Edit</button>
                          <button type="button" className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => void handleDeleteAppt(appt.appointment_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {apptMsg && !showApptForm && <p className="mt-2 text-xs text-red-600">{apptMsg}</p>}
              </section>

              {/* Food / Lifestyle Recommendations */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">🍽️ Nutrition & Lifestyle</h3>
                {foodRecommendations.length > 0 ? (
                  <ul className="space-y-1.5">
                    {foodRecommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="mt-0.5 text-emerald-500">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No food recommendations available.</p>
                )}
              </section>

              {/* Community Activity */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">🏘️ Community Activities</h3>
                {communityJoined.length > 0 ? (
                  <div className="space-y-2">
                    {communityJoined.map((ev) => (
                      <div key={ev.event_id} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">{ev.title}</p>
                        <p className="text-xs text-slate-500">{ev.location} &middot; {new Date(ev.datetime).toLocaleString()}</p>
                        <p className="text-xs text-slate-400">{ev.type} &middot; {ev.organiser}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No community activities joined yet.</p>
                )}
              </section>

              {/* Intervention History */}
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-lg font-bold text-slate-900">🛡️ Intervention History</h3>
                {interventions.length === 0 ? (
                  <p className="text-sm text-slate-500">No interventions triggered yet.</p>
                ) : (
                  <div className="space-y-2">
                    {interventions.slice(0, 10).map((iv, idx) => (
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
            </>
          )}

          {/* ============ SUMMARY TAB — Weekly Outcomes Review ============ */}
          {tab === "summary" && !detailView && !loading && (
            <>
              {/* Patient selector if no summary loaded */}
              {!weeklySummary && !summaryLoading && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900">📊 Weekly Outcomes</h3>
                  {myPatients.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">No patients assigned. Assign a patient first.</p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-slate-500">Select a patient to review their weekly outcomes.</p>
                      <div className="mt-3 space-y-2">
                        {myPatients.map((p) => (
                          <button key={p.user_id} type="button"
                            onClick={() => void loadWeeklySummary(p.user_id)}
                            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/30">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                              <p className="text-xs text-slate-500">Age {p.age} &middot; {p.conditions.join(", ") || "No conditions"}</p>
                            </div>
                            <span className="text-xs text-indigo-600 font-medium">Review →</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}

              {summaryLoading && <div className="py-8 text-center text-slate-500">Loading weekly outcomes…</div>}

              {/* Weekly Outcomes Report */}
              {weeklySummary && !summaryLoading && (
                <>
                  {/* Header + Overall Status */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{weeklySummary.patient_name}</h3>
                        <p className="text-xs text-slate-500">Age {weeklySummary.patient_age} &middot; {weeklySummary.conditions.join(", ") || "—"}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                        weeklySummary.overall_status === "On track" ? "bg-emerald-100 text-emerald-700"
                        : weeklySummary.overall_status === "Needs attention" ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                      }`}>
                        {weeklySummary.overall_status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{weeklySummary.period}</p>
                    <button type="button" className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      onClick={() => setWeeklySummary(null)}>
                      ← Choose Another Patient
                    </button>
                  </section>

                  {/* Summary Bullets */}
                  <section className="rounded-3xl border border-indigo-100 bg-indigo-50/30 p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-indigo-900">📋 Weekly Summary</h3>
                    <ul className="space-y-2">
                      {weeklySummary.summary_bullets.map((bullet, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="mt-0.5 text-indigo-500">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {/* Adherence Trend */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">📈 Adherence Trends</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl bg-blue-50 p-3 text-center">
                        <span className="text-2xl font-bold text-blue-600">{weeklySummary.adherence.current_score}%</span>
                        <p className="text-xs text-slate-500">This Week</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3 text-center">
                        <span className="text-2xl font-bold text-slate-600">{weeklySummary.adherence.prior_score}%</span>
                        <p className="text-xs text-slate-500">Prior</p>
                      </div>
                      <div className={`rounded-2xl p-3 text-center ${
                        weeklySummary.adherence.delta > 0 ? "bg-emerald-50" : weeklySummary.adherence.delta < 0 ? "bg-red-50" : "bg-slate-50"
                      }`}>
                        <span className={`text-2xl font-bold ${
                          weeklySummary.adherence.delta > 0 ? "text-emerald-600" : weeklySummary.adherence.delta < 0 ? "text-red-600" : "text-slate-600"
                        }`}>
                          {weeklySummary.adherence.delta > 0 ? "+" : ""}{weeklySummary.adherence.delta}%
                        </span>
                        <p className="text-xs text-slate-500">Change</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                      <div>
                        <span className="text-lg font-bold text-emerald-600">{weeklySummary.adherence.taken}</span>
                        <p className="text-xs text-slate-500">Taken</p>
                      </div>
                      <div>
                        <span className="text-lg font-bold text-red-600">{weeklySummary.adherence.missed}</span>
                        <p className="text-xs text-slate-500">Missed</p>
                      </div>
                      <div>
                        <span className="text-lg font-bold text-amber-600">{weeklySummary.adherence.late}</span>
                        <p className="text-xs text-slate-500">Late</p>
                      </div>
                    </div>
                  </section>

                  {/* Drift */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">🔍 Drift Detection</h3>
                    {weeklySummary.drift.drift_detected ? (
                      <div className={`rounded-2xl p-4 ${
                        weeklySummary.drift.severity === "red" ? "border border-red-200 bg-red-50"
                        : weeklySummary.drift.severity === "orange" ? "border border-orange-200 bg-orange-50"
                        : "border border-amber-200 bg-amber-50"
                      }`}>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">⚠</span>
                          <span className={`text-sm font-bold ${
                            weeklySummary.drift.severity === "red" ? "text-red-700"
                            : weeklySummary.drift.severity === "orange" ? "text-orange-700"
                            : "text-amber-700"
                          }`}>
                            {weeklySummary.drift.severity.toUpperCase()} — {weeklySummary.drift.trigger}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          {weeklySummary.drift.details.missed_doses} missed doses &middot; {weeklySummary.drift.details.late_doses} late doses &middot; Avg MES: {weeklySummary.drift.details.avg_mes}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-sm font-semibold text-emerald-700">✓ No adherence drift detected</p>
                        <p className="text-xs text-emerald-600">Patient is maintaining a stable routine.</p>
                      </div>
                    )}
                  </section>

                  {/* Intervention History */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">🔔 Interventions ({weeklySummary.intervention_count})</h3>
                    {weeklySummary.interventions.length === 0 ? (
                      <p className="text-sm text-slate-500">No system interventions triggered this week.</p>
                    ) : (
                      <div className="space-y-2">
                        {weeklySummary.interventions.slice(0, 10).map((iv, idx) => (
                          <div key={idx} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-800">{iv.action_type.replace(/_/g, " ")}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                iv.risk_level === "HIGH" ? "bg-red-100 text-red-600"
                                : iv.risk_level === "MEDIUM" ? "bg-amber-100 text-amber-600"
                                : "bg-emerald-50 text-emerald-600"
                              }`}>{iv.risk_level}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{iv.message}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{new Date(iv.timestamp).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* TCM Safety */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">🌿 TCM Safety</h3>
                    {weeklySummary.tcm_warnings.length > 0 ? (
                      <div className="space-y-2">
                        {weeklySummary.tcm_warnings.map((w, idx) => (
                          <div key={idx} className="rounded-2xl border border-red-100 bg-red-50/50 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-800">{w.herb}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                w.risk_level === "high" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                              }`}>{w.risk_level.toUpperCase()}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">Affects: {w.flagged_medications.join(", ")}</p>
                            {w.guidance && <p className="mt-1 text-xs text-slate-500">{w.guidance}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-sm text-emerald-700">✓ {weeklySummary.tcm_status}</p>
                      </div>
                    )}
                  </section>

                  {/* Community Activities */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">🏘️ Community Activities ({weeklySummary.community_joined_count})</h3>
                    {weeklySummary.community_events_joined.length > 0 ? (
                      <div className="space-y-2">
                        {weeklySummary.community_events_joined.map((ev) => (
                          <div key={ev.event_id} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                            <p className="text-sm font-semibold text-slate-800">{ev.title}</p>
                            <p className="text-xs text-slate-500">{ev.location} &middot; {new Date(ev.datetime).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No community activities joined this period.</p>
                    )}
                  </section>

                  {/* Nutrition / Food */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-base font-bold text-slate-900">🍽️ Nutrition & Meal Guidance</h3>
                    {weeklySummary.food_recommendations.length > 0 ? (
                      <ul className="space-y-1.5">
                        {weeklySummary.food_recommendations.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="mt-0.5 text-emerald-500">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">{weeklySummary.food_summary}</p>
                    )}
                  </section>

                  {/* Report summary if available */}
                  {reportSummary && (
                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="mb-2 text-base font-bold text-slate-900">📄 Clinician Report</h3>
                      <p className="text-sm text-slate-700 whitespace-pre-line">{reportSummary.summary}</p>
                      <p className="mt-3 text-xs text-slate-500">
                        <span className="font-semibold">Follow-up:</span> {reportSummary.recommended_follow_up}
                      </p>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {/* ============ PROFILE TAB ============ */}
          {tab === "profile" && !detailView && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">👤 {account.name}</h3>
              <p className="text-sm text-slate-500">{account.email}</p>
              <p className="mt-1 text-xs text-slate-400">Role: Clinician</p>
              <button type="button" onClick={handleSignOut}
                className="mt-6 w-full rounded-2xl bg-red-50 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100">
                Sign Out
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
              onClick={() => { setTab(t.key); if (t.key !== "patients") setDetailView(false); }}
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
