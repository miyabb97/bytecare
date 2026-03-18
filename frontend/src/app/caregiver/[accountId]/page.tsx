"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BrainCircuit,
  Calendar,
  Heart,
  MessageSquare,
  Phone,
  Pill,
  Siren,
  Sparkles,
  ArrowRight,
  Users,
} from "lucide-react";

import { api, type Account, type CaregiverBriefing, type CaregiverPatientDetail, type CaregiverPatientSummary } from "../../../lib/api";
import {
  ActionTile,
  AlertCard,
  BadgePill,
  ChartCard,
  Header,
  QuickActionRow,
  SectionTitle,
  TabBar,
} from "../../../components/mobile/DashboardPrimitives";
import ConsequenceModalCompact from "../../../components/ConsequenceModalCompact";
import CaregiverAssistantSummary from "../../../components/CaregiverAssistantSummary";
import MedicationEatingPatternCard from "../../../components/MedicationEatingPatternCard";
function loadAccount(router: ReturnType<typeof useRouter>, setAccount: (value: Account) => void) {
  const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
  if (!raw) { router.replace("/auth/signin"); return; }
  try {
    const parsed = JSON.parse(raw) as Account;
    if (parsed.role !== "caregiver") { router.replace("/auth/signin"); return; }
    setAccount(parsed);
  } catch { router.replace("/auth/signin"); }
}

function calcAdherence(detail: CaregiverPatientDetail) {
  const events = detail.dose_events;
  const taken = events.filter(e => e.response_status === "taken" || ['tap_confirm','voice_confirm'].includes(e.event_type)).length;
  const late = events.filter(e => e.response_status === "late" || e.event_type === "dose_late").length;
  const missed = events.filter(e =>
    ["not_taken", "missed", "skipped"].includes(e.response_status) ||
    ["dose_not_taken", "dose_missed", "dose_skipped"].includes(e.event_type)
  ).length;
  const total = taken + late + missed;
  const pct = total > 0 ? Math.round(((taken + 0.5 * late) / total) * 100) : 100;
  return { taken, missed, late, pct };
}

function getRisk(pct: number): { label: string; tone: "red" | "yellow" | "success"; badge: string } {
  if (pct < 70) return { label: "High Risk", tone: "red", badge: "HIGH RISK" };
  if (pct < 85) return { label: "Needs Follow-up", tone: "yellow", badge: "NEEDS FOLLOW-UP" };
  return { label: "On Track", tone: "success", badge: "ON TRACK" };
}

function getMissedMedNames(detail: CaregiverPatientDetail): string[] {
  const ids = [...new Set(
    detail.dose_events
      .filter(e => ["not_taken", "missed", "skipped"].includes(e.response_status))
      .map(e => e.medication_id)
  )];
  return ids.map(id => detail.medications.find(m => m.medication_id === id)?.name).filter(Boolean) as string[];
}

function getNextAppointment(detail: CaregiverPatientDetail) {
  const now = new Date().toISOString();
  return detail.appointments
    .filter(a => a.datetime > now)
    .sort((a, b) => a.datetime.localeCompare(b.datetime))[0] ?? null;
}

function getEncouragementSuggestions(pct: number, missed: number): string[] {
  if (missed === 0) return [
    "Praise the patient for their consistency this week",
    "Encourage a morning walk to maintain daily wellbeing",
    "A brief check-in call helps maintain trust and connection",
  ];
  if (pct < 70) return [
    "Call the patient — missed doses may signal difficulty",
    "Offer to help organise medications at home",
    "Suggest a visit to assess the patient's daily routine",
    "Remind them gently: regular doses protect their health",
  ];
  return [
    "Send a warm reminder about any missed doses",
    "Encourage the patient to attend a community social event",
    "Ask if they need help with appointment logistics",
  ];
}

function formatShortDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return iso as any;
  }
}

function computeMedStats(detail: CaregiverPatientDetail, medId: string) {
  const events = detail.dose_events.filter(e => e.medication_id === medId);
  const taken = events.filter(e => e.response_status === "taken" || ['tap_confirm','voice_confirm'].includes(e.event_type)).length;
  const missed = events.filter(e => ["not_taken", "missed", "skipped"].includes(e.response_status)).length;
  const late = events.filter(e => e.response_status === "late" || e.event_type === "dose_late").length;
  const lastTaken = events
    .filter(e => e.response_status === "taken")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  return { taken, missed, late, lastTaken: lastTaken ? lastTaken.timestamp : null, totalEvents: events.length };
}

function computeTrend(detail: CaregiverPatientDetail) {
  // Build missed counts per day for the last 7 days (oldest -> newest)
  const days: number[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23,59,59,999);
    const count = detail.dose_events.filter(ev => {
      const t = new Date(ev.timestamp || '');
      return t >= dayStart && t <= dayEnd && ['not_taken', 'missed', 'skipped'].includes(ev.response_status);
    }).length;
    days.push(count);
  }

  const recent = days.slice(4).reduce((s, v) => s + v, 0); // last 3 days
  const prior = days.slice(0,4).reduce((s, v) => s + v, 0); // previous 4 days
  const delta = recent - prior;
  let trendLabel = 'Stable';
  if (delta > 0) trendLabel = 'Slightly worsening';
  else if (delta < 0) trendLabel = 'Improving';

  return { days, recent, prior, delta, trendLabel };
}

export default function CaregiverDashboardPage({ params }: { params: { accountId: string } }) {
  const router = useRouter();
  const { accountId } = params;
  const [account, setAccount] = useState<Account | null>(null);
  const [patients, setPatients] = useState<CaregiverPatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaregiverPatientDetail | null>(null);
  const [briefing, setBriefing] = useState<CaregiverBriefing | null>(null);
  const [refillStatus, setRefillStatus] = useState<any[] | null>(null);
  const [requestedMedIds, setRequestedMedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [medViewMode, setMedViewMode] = useState<"consequences" | "history">("consequences");
  const [medRecommendations, setMedRecommendations] = useState<Record<string, { recommendations: string[]; confidence?: number | null; loading?: boolean }>>({});
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadAccount(router, setAccount); }, [router]);
  const shellRef = useRef<HTMLDivElement>(null);

  
  useEffect(() => {
    if (!account) return;
    api.caregiverGetPatients(accountId)
      .then(res => {
        setPatients(res.items);
        if (res.items.length > 0) setSelectedId(res.items[0].user_id);
        else setLoading(false);
      })
      .catch(err => { setError(String(err?.message ?? err)); setLoading(false); });
  }, [account, accountId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    setBriefing(null);
    api.caregiverGetPatientDetail(accountId, selectedId)
      .then(d => { setDetail(d); setLoading(false); })
      .catch(err => { setError(String(err?.message ?? err)); setLoading(false); });
  }, [selectedId, accountId]);

  // Load AI briefing after detail is ready
  useEffect(() => {
    if (!selectedId || !detail) return;
    setBriefingLoading(true);
    api.caregiverGetBriefing(accountId, selectedId)
      .then(b => { setBriefing(b); setBriefingLoading(false); })
      .catch(() => setBriefingLoading(false));

    // Load refill status for medications
    api.getRefillStatus(selectedId)
      .then(r => { setRefillStatus(r.items); })
      .catch(() => setRefillStatus(null));
  }, [selectedId, accountId, detail]);

  // index of currently-displayed medication in the Consequences view
  const [medIndex, setMedIndex] = useState(0);
  useEffect(() => { setMedIndex(0); }, [detail]);
  const [consequenceOpen, setConsequenceOpen] = useState(false);
  const [pendingRefillMedId, setPendingRefillMedId] = useState<string | null>(null);

  const stats = useMemo(() => detail ? calcAdherence(detail) : null, [detail]);
  const risk = useMemo(() => stats ? getRisk(stats.pct) : null, [stats]);
  const missedMeds = useMemo(() => detail ? getMissedMedNames(detail) : [], [detail]);
  const nextAppt = useMemo(() => detail ? getNextAppointment(detail) : null, [detail]);
  const fallbackSuggestions = useMemo(() => stats ? getEncouragementSuggestions(stats.pct, stats.missed) : [], [stats]);

  const currentMed = detail && detail.medications && detail.medications.length > 0 ? detail.medications[medIndex % detail.medications.length] : null;
  const currentMedStats = currentMed ? computeMedStats(detail!, currentMed.medication_id) : null;
  const trend = detail ? computeTrend(detail) : null;
  const predictedPct = (() => {
    if (!stats || !trend) return null;
    // simple conservative prediction: reduce pct by 2% per additional missed dose in recent window
    const adj = Math.max(0, trend.delta) * 2;
    return Math.max(0, stats.pct - adj);
  })();

  const tabs = useMemo(() => [
    { key: "dashboard", label: "Dashboard", icon: <Heart size={18} strokeWidth={2.1} /> },
    { key: "patients", label: "Patients", icon: <Users size={18} strokeWidth={2.1} /> },
    { key: "messages", label: "Messages", icon: <MessageSquare size={18} strokeWidth={2.1} /> },
  ], []);

  if (!account) return null;

  return (
    <main className="flex min-h-screen justify-center bg-white">
      <div ref={shellRef} className="relative min-h-screen w-full max-w-md bg-[#F8FAFC] pb-24">
        <Header
          title="Caregiver"
          left={
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#C9D9FF] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
              <Heart size={19} className="text-[#3B6EF5]" />
            </div>
          }
          right={
            <button type="button" className="relative grid h-11 w-11 place-items-center rounded-full bg-[#3B6EF5] text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]">
              <Bell size={19} />
            </button>
          }
        />

        <section className="space-y-5 px-3 pb-8 pt-4">

          {/* Debug banner - shows live counts from API while developing */}
          <div className="mb-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            Debug: account: {account?.name} · selectedId: {selectedId ?? '—'} · patients: {patients.length} · meds: {detail?.medications?.length ?? 0} · events: {detail?.dose_events?.length ?? 0}
          </div>

          {/* Patient selector — only shown when caregiver has multiple patients */}
          {patients.length > 1 && (
            <section className="space-y-2">
              <SectionTitle title="My Patients" />
              <div className="flex gap-2 overflow-x-auto pb-1">
                {patients.map(p => (
                  <button
                    key={p.user_id}
                    type="button"
                    onClick={() => setSelectedId(p.user_id)}
                    className={`shrink-0 rounded-2xl border px-4 py-2 text-[13px] font-semibold transition-colors ${
                      selectedId === p.user_id
                        ? "border-[#3B6EF5] bg-[#3B6EF5] text-white"
                        : "border-[#E9EEF7] bg-white text-[#344054]"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {loading && (
            <div className="flex items-center justify-center py-16 text-[14px] text-[#98A2B3]">
              Loading patient data…
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-[#FFD8D8] bg-[#FFF1F1] p-4 text-[13px] text-[#EF5A5A]">
              {error}
            </div>
          )}

          {!loading && !error && detail && stats && risk && (
            <>
              {/* Patient identity card */}
              <section className="overflow-hidden rounded-2xl border border-[#D7E2F3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="relative h-[90px] bg-[#235B6A] px-4 pt-4">
                  <BadgePill label={risk.badge} tone={risk.tone} />
                </div>
                <div className="space-y-2 border-t border-[#E9EEF7] px-4 py-4">
                  <h2 className="text-[28px] font-bold leading-none text-[#1F2A37]">{detail.patient.name}</h2>
                  <p className="text-[13px] text-[#667085]">
                    Age {detail.patient.age}
                    {(detail.patient as { conditions?: string[] }).conditions?.length
                      ? ` · ${(detail.patient as { conditions?: string[] }).conditions!.join(", ")}`
                      : ""}
                  </p>
                  <p className={`text-[13px] font-semibold ${
                    risk.tone === "red" ? "text-[#EF5A5A]"
                    : risk.tone === "yellow" ? "text-[#C18421]"
                    : "text-[#15803D]"
                  }`}>
                    STATUS: {risk.label.toUpperCase()}
                  </p>
                  <p className="text-[12px] text-[#98A2B3]">
                    {detail.medications.length} active medication{detail.medications.length !== 1 ? "s" : ""}
                    {" · "}
                    {detail.appointments.length} appointment{detail.appointments.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </section>

              {/* Quick AI summary (moved above adherence) */}
              <section className="mt-3">
                <CaregiverAssistantSummary
                  detail={detail}
                  briefing={briefing ?? undefined}
                  stats={stats}
                  days={trend?.days}
                  predictedPct={predictedPct}
                  trendLabel={trend ? `${trend.trendLabel} — ${trend.recent} missed in last 3 days` : undefined}
                  recommendation={trend && trend.delta > 0 ? 'Check in with the patient and consider sending a reminder.' : 'Maintain regular check-ins to keep this trend.'}
                />
              </section>


              {/* Medication adherence — read-only, no prescribing */}
              <section className="space-y-2">
                <SectionTitle title="Medication Adherence (Last 7 Days)" />
                <ChartCard>
                  <div className="flex items-start justify-between">

              

                    <div>
                      <p className="text-[12px] font-medium text-[#98A2B3]">Adherence Rate</p>
                      <p className="mt-1 text-[44px] font-bold leading-none text-[#1F2A37]">{stats.pct}%</p>
                    </div>
                    <BadgePill label={risk.badge} tone={risk.tone} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 border-t border-[#E9EEF7] pt-3 text-center">
                    <div>
                      <p className="text-[24px] font-bold leading-none text-[#EF5A5A]">{stats.missed}</p>
                      <p className="mt-1 text-[11px] text-[#98A2B3]">Missed</p>
                    </div>
                    <div>
                      <p className="text-[24px] font-bold leading-none text-[#E7A93B]">{stats.late}</p>
                      <p className="mt-1 text-[11px] text-[#98A2B3]">Late</p>
                    </div>
                    <div>
                      <p className="text-[24px] font-bold leading-none text-[#15803D]">{stats.taken}</p>
                      <p className="mt-1 text-[11px] text-[#98A2B3]">On-time</p>
                    </div>
                  </div>
                  {detail.medications.length > 0 && (
                    <div className="mt-4 border-t border-[#E9EEF7] pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">Medications (view only)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.medications.map(m => {
                          const status = refillStatus?.find(s => s.medication_id === m.medication_id);
                          return (
                            <div key={m.medication_id} className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-lg bg-[#F2F4F7] px-2.5 py-1 text-[12px] font-medium text-[#344054]">
                                <Pill size={10} className="text-[#667085]" />
                                {m.name} · {m.dose_text}
                              </span>
                              {status && status.tracking_enabled && (
                                <span className="text-[12px] text-[#98A2B3]">{status.doses_remaining} left (~{status.days_remaining ?? 'n/a'} days)</span>
                              )}
                              {status && status.needs_refill && (
                                <div className="ml-2 inline-flex items-center">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!selectedId) return;
                                      setActionLoading(m.medication_id);
                                      try {
                                        await api.requestRefill(selectedId, m.medication_id);
                                        const r = await api.getRefillStatus(selectedId);
                                        setRefillStatus(r.items);
                                        setRequestedMedIds((s) => Array.from(new Set([...s, m.medication_id])));
                                        setActionSuccess(m.medication_id);
                                        setTimeout(() => setActionSuccess(null), 2500);
                                      } catch (e) {
                                        // ignore
                                      } finally {
                                        setActionLoading(null);
                                      }
                                    }}
                                    disabled={actionLoading === m.medication_id}
                                    className={`ml-2 inline-flex items-center rounded-2xl px-3 py-1 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${actionLoading === m.medication_id ? 'bg-[#172554] opacity-80' : 'bg-[#3B6EF5]'}`}
                                  >
                                    {actionLoading === m.medication_id ? 'Requesting…' : (requestedMedIds.includes(m.medication_id) || actionSuccess === m.medication_id) ? 'Requested' : 'Request Refill'}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </ChartCard>
              </section>

              {/* Medication eating-with-meal inference (caregiver-only) — same layout as Consequences */}
              {selectedId && (
                <section className="space-y-2 mt-3">
                  <SectionTitle title="Medication Eating Patterns" />
                  <ChartCard>
                    <MedicationEatingPatternCard accountId={accountId} patientUserId={selectedId} days={14} singleMedId={currentMed ? currentMed.medication_id : null} />
                  </ChartCard>
                </section>
              )}

              {/* Missed dose alert + medication history (agentic) */}
              <section className="space-y-2">
                <SectionTitle title="Medication Consequences & History" />

                {/* High-level consequence summary */}
                <ChartCard>
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#FFF1F1]">
                      <Pill size={16} className="text-[#EF5A5A]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#1F2A37]">{stats.missed} missed dose{stats.missed !== 1 ? 's' : ''} in past week</p>
                      <p className="mt-1 text-[13px] text-[#667085]">Below are specific medication histories, likely consequences, and suggested near-term actions for the caregiver.</p>
                    </div>
                  </div>
                    <div className="mt-3 border-t border-[#E9EEF7] pt-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[13px] text-[#667085]">View:</div>
                        <div className="flex gap-2 items-center">
                          <button type="button" onClick={() => setMedViewMode('consequences')} className={`rounded-2xl px-2 py-1 text-[12px] font-semibold ${medViewMode === 'consequences' ? 'bg-[#3B6EF5] text-white' : 'bg-white text-[#344054] border border-[#E9EEF7]'}`}>Consequences</button>
                          <button type="button" onClick={() => setMedViewMode('history')} className={`rounded-2xl px-2 py-1 text-[12px] font-semibold ${medViewMode === 'history' ? 'bg-[#3B6EF5] text-white' : 'bg-white text-[#344054] border border-[#E9EEF7]'}`}>History</button>
                          <div className="ml-3 flex items-center gap-3">
                            <div className="relative">
                              <div className="h-14 w-14 rounded-full border border-[#E9EEF7] bg-white flex flex-col items-center justify-center text-center">
                                <div className="text-[16px] font-semibold text-[#3B6EF5] leading-tight">{detail.medications.length > 0 ? ((medIndex % detail.medications.length) + 1) : '-'}</div>
                                <div className="text-[11px] text-[#98A2B3] mt-1">of {detail.medications.length}</div>
                              </div>
                            </div>
                            <button type="button" onClick={() => { if (detail.medications.length > 0) setMedIndex(i => (i + 1) % detail.medications.length); }} className="h-10 w-10 rounded-full border border-[#EEF4FF] bg-white grid place-items-center shadow-sm">
                              <div className="h-8 w-8 rounded-full bg-[#F2F6FF] grid place-items-center">
                                <ArrowRight size={16} className="text-[#3B6EF5]" />
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                      {currentMed && (
                        (() => {
                          const m = currentMed;
                          const st = currentMedStats!;
                          const status = refillStatus?.find(s => s.medication_id === m.medication_id);
                          const expectedPerDay = (m.schedule?.times?.length ?? 1);
                          const expected7d = expectedPerDay * 7;
                          const adherencePct = expected7d > 0 ? Math.round((st.taken / expected7d) * 100) : 100;
                          const isHighRisk = /(warfarin|insulin|anticoag)/i.test(m.name);
                          const urgent = (status && (status.doses_remaining === 0 || status.is_low)) || (isHighRisk && st.missed > 0) || adherencePct < 50;

                          let consequence = "";
                          if (isHighRisk && st.missed > 0) {
                            if (/insulin/i.test(m.name)) consequence = "Missed insulin can cause high blood sugar and dehydration; seek advice if unwell.";
                            else if (/warfarin|anticoag/i.test(m.name)) consequence = "Missing anticoagulants increases clot/stroke risk — contact clinician promptly.";
                            else consequence = "This is a high-risk medication — seek clinical advice if multiple doses missed.";
                          } else if (st.missed > 0) {
                            consequence = "Missed doses can reduce treatment effectiveness; encourage timely intake and monitor symptoms.";
                          } else if (st.taken > expected7d) {
                            consequence = "More doses than scheduled were recorded — check for duplicate intake or dosing confusion.";
                          } else {
                            consequence = "No immediate concerns — continue regular check-ins and monitor for changes.";
                          }

                          return (
                            <div key={m.medication_id} className="mb-3">
                              <div className="flex items-center justify-between">
                                <div className="min-w-0">
                                  <p className="text-[14px] font-semibold text-[#1F2A37]">{m.name} · {m.dose_text}</p>
                                  <p className="mt-1 text-[12px] text-[#98A2B3]">Last taken: {formatShortDate(st.lastTaken)} · {st.taken} taken · {st.missed} missed · {st.late} late</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${urgent ? 'bg-[#FFF1F1] text-[#EF5A5A] border border-[#FFD8D8]' : 'bg-[#F2F4F7] text-[#667085] border border-[#E4E7EC]'}`}>{adherencePct}%</span>
                                  {status && status.tracking_enabled && (
                                    <span className={`text-[12px] font-medium ${status.doses_remaining === 0 ? 'text-[#EF5A5A]' : 'text-[#98A2B3]'}`}>{status.doses_remaining} left</span>
                                  )}
                                </div>
                              </div>
                              {medViewMode === 'consequences' && (
                                <>
                                  <div className="mt-2 text-[13px] text-[#344054]">• {consequence}</div>
                                  <div className="mt-2">
                                    {medRecommendations[m.medication_id]?.recommendations ? (
                                      <div className="mt-2">
                                        <p className="text-[12px] text-[#98A2B3]">Recommended next step:</p>
                                        <div className="mt-1 text-[13px] text-[#344054]">• {medRecommendations[m.medication_id].recommendations[0]}</div>
                                      </div>
                                    ) : (
                                      <div className="mt-2">
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            if (!selectedId) return;
                                            setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: [], loading: true } }));
                                            try {
                                              const res = await api.caregiverGetMedRecommendations(accountId, selectedId, m.medication_id);
                                              setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: (res.recommendations || []).slice(0,1), confidence: res.confidence ?? null } }));
                                            } catch (e) {
                                              const localFallback: string[] = [];
                                              if (isHighRisk) {
                                                localFallback.push(`This is a high-risk medication. If multiple doses are missed or patient shows worrying symptoms, contact clinician immediately.`);
                                                localFallback.push(`Check for signs like dizziness, bleeding, fainting or extreme thirst. Arrange clinician review if present.`);
                                              } else if (st.missed > 0) {
                                                localFallback.push(`Call ${detail.patient.name.split(' ')[0]} to check why ${m.name} was missed and whether they have it available.`);
                                                localFallback.push(`Help them take the missed dose now only if it's within schedule; otherwise document and contact clinician.`);
                                              } else {
                                                localFallback.push(`Confirm ${m.name} supply and help set a reminder to take doses on time.`);
                                                localFallback.push(`Check in tomorrow to ensure doses are taken as scheduled.`);
                                              }
                                              localFallback.push(`If supply is low or zero, request a refill or assist with pharmacy order.`);
                                              setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: localFallback.slice(0,1), confidence: null } }));
                                            }
                                          }}
                                          className="mt-2 inline-flex items-center rounded-2xl bg-[#3B6EF5] px-3 py-1 text-[13px] font-semibold text-white"
                                        >
                                          Get recommended next steps
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {urgent && (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPendingRefillMedId(m.medication_id);
                                          setConsequenceOpen(true);
                                        }}
                                        className="mt-2 w-full inline-flex items-center justify-center rounded-2xl bg-[#EF5A5A] px-4 py-2 text-[14px] font-semibold text-white shadow-sm"
                                      >
                                        Request urgent refill
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                              {medViewMode === 'history' && (
                                <div className="mt-2 text-[13px] text-[#344054]">
                                  <p className="mb-1 text-[12px] text-[#98A2B3]">Recent events (7d)</p>
                                  <ul className="list-disc pl-4">
                                    {detail.dose_events.filter(ev => ev.medication_id === m.medication_id).slice(0,7).map(ev => (
                                      <li key={ev.event_id} className="text-[13px]">{formatShortDate(ev.timestamp)} — {ev.response_status}</li>
                                    ))}
                                    {detail.dose_events.filter(ev => ev.medication_id === m.medication_id).length === 0 && <li className="text-[13px] text-[#98A2B3]">No events in the last 7 days.</li>}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </div>
                    <ConsequenceModalCompact
                      open={consequenceOpen}
                      text={currentMed ? `Request urgent refill for ${currentMed.name}?` : 'Request urgent refill?'}
                      onClose={() => { setConsequenceOpen(false); setPendingRefillMedId(null); }}
                      onConfirm={async () => {
                        if (!selectedId || !pendingRefillMedId) return;
                        setConsequenceOpen(false);
                        setActionLoading(pendingRefillMedId);
                        try {
                          await api.requestRefill(selectedId, pendingRefillMedId);
                          const r = await api.getRefillStatus(selectedId);
                          setRefillStatus(r.items);
                          setRequestedMedIds((s) => Array.from(new Set([...s, pendingRefillMedId])));
                          setActionSuccess(pendingRefillMedId);
                          setTimeout(() => setActionSuccess(null), 2500);
                        } catch (e) {
                          // ignore
                        } finally {
                          setActionLoading(null);
                          setPendingRefillMedId(null);
                        }
                      }}
                    />
                </ChartCard>
              </section>

              {/* Appointment reminder */}
              <section className="space-y-2">
                <SectionTitle title="Upcoming Appointment" />
                <ChartCard>
                  {nextAppt ? (
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EEF4FF]">
                        <Calendar size={18} className="text-[#3B6EF5]" />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[#1F2A37]">
                          {new Date(nextAppt.datetime).toLocaleDateString("en-SG", {
                            weekday: "short", day: "numeric", month: "short", year: "numeric",
                          })}
                        </p>
                        <p className="text-[13px] text-[#667085]">{nextAppt.location}</p>
                        {nextAppt.notes && (
                          <p className="mt-1 text-[12px] text-[#98A2B3]">{nextAppt.notes}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#98A2B3]">No upcoming appointments scheduled.</p>
                  )}
                </ChartCard>
              </section>

              {/* Caregiver support actions */}
              <section className="space-y-2">
                <SectionTitle title="Caregiver Actions" />
                <QuickActionRow>
                  <ActionTile
                    icon={<Siren size={18} />}
                    label={actionLoading === 'reminder' ? 'Sending…' : actionSuccess === 'reminder' ? 'Sent' : 'Send Reminder'}
                    onClick={async () => {
                      if (!selectedId || !detail || !account) return;
                      // Prefill suggested message from AI briefing if available
                      const suggested = briefing?.actions && briefing.actions.length > 0
                        ? (typeof briefing.actions[0] === 'string' ? briefing.actions[0] : briefing.actions[0].text)
                        : `Hi ${detail.patient.name}, this is ${account.name}. Have you taken your medication today?`;

                      const message = window.prompt('Edit reminder message to send to patient:', suggested);
                      if (message === null) return; // cancelled

                      setActionLoading('reminder');
                      try {
                        // send as chat message (patient will receive notification)
                        await api.postChat(selectedId, message);

                        // Ask backend to generate a friendly voice-agent reply for the patient (no local playback)
                        try {
                          await api.postVoiceAgent(selectedId, message);
                        } catch (err) {
                          // ignore voice-agent errors
                        }

                        setActionSuccess('reminder');
                        setTimeout(() => setActionSuccess(null), 2500);
                      } catch (e) {
                        // ignore
                      } finally {
                        setActionLoading(null);
                      }
                    }}
                  />
                  <ActionTile
                    icon={<Phone size={18} />}
                    label={actionLoading === 'call' ? 'Notifying…' : actionSuccess === 'call' ? 'Notified' : 'Call Patient'}
                    onClick={async () => {
                      if (!selectedId || !detail || !account) return;
                      setActionLoading('call');
                      try {
                        const message = `${account.name} would like to call you. Are you available for a short call?`;
                        await api.postChat(selectedId, message);
                        setActionSuccess('call');
                        setTimeout(() => setActionSuccess(null), 2500);
                      } catch (e) {
                        // ignore
                      } finally {
                        setActionLoading(null);
                      }
                    }}
                  />
                  <ActionTile
                    icon={<Calendar size={18} />}
                    label={actionLoading === 'visit' ? 'Requesting…' : actionSuccess === 'visit' ? 'Requested' : 'Book Visit'}
                    onClick={async () => {
                      if (!selectedId || !detail || !account) return;
                      setActionLoading('visit');
                      try {
                        const message = `${account.name} would like to schedule a visit this week. Are you available?`;
                        await api.postChat(selectedId, message);
                        setActionSuccess('visit');
                        setTimeout(() => setActionSuccess(null), 2500);
                      } catch (e) {
                        // ignore
                      } finally {
                        setActionLoading(null);
                      }
                    }}
                  />
                </QuickActionRow>
              </section>

              {/* AI Caregiver Briefing — What to do today */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <SectionTitle title="What to do today" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-bold text-[#3B6EF5]">
                    <Sparkles size={9} />
                    AI
                  </span>
                </div>

                {briefingLoading && (
                  <div className="flex items-center gap-2 rounded-2xl border border-[#E9EEF7] bg-white px-4 py-4 text-[13px] text-[#98A2B3]">
                    <Sparkles size={14} className="animate-pulse text-[#3B6EF5]" />
                    Generating personalised action plan…
                  </div>
                )}

                {!briefingLoading && (briefing ?? fallbackSuggestions.length > 0) && (
                  <section className="overflow-hidden rounded-2xl border border-[#D8E5FF] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    {/* Header row */}
                    <div className="flex items-center justify-between border-b border-[#E9EEF7] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-[#3B6EF5]" />
                        <span className="text-[13px] font-semibold text-[#1F2A37]">
                          {briefing ? `For ${briefing.patient_name.split(" ")[0]} today` : "Suggested actions"}
                        </span>
                      </div>
                      {briefing && (
                        <span className="text-[10px] font-medium text-[#98A2B3]">
                          {briefing.source === "llm" ? "AI-generated" : "smart suggestions"}
                        </span>
                      )}
                    </div>
                    {briefing?.today_summary && (
                      <div className="px-4 py-3">
                        <p className="text-[13px] text-[#475467]">{briefing.today_summary}</p>
                      </div>
                    )}

                    {briefing?.monitoring && briefing.monitoring.length > 0 && (
                      <div className="px-4 py-2 border-t border-[#E9EEF7]">
                        <p className="text-[12px] font-semibold text-[#98A2B3]">Monitor</p>
                        <ul className="mt-2 space-y-1">
                          {briefing.monitoring.map((m, idx) => (
                            <li key={idx} className="text-[13px] text-[#344054]">• {m}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {briefing?.escalations && briefing.escalations.length > 0 && (
                      <div className="px-4 py-2 border-t border-[#E9EEF7]">
                        <p className="text-[12px] font-semibold text-[#98A2B3]">Escalation Suggestions</p>
                        <ul className="mt-2 space-y-1">
                          {briefing.escalations.map((e, idx) => (
                            <li key={idx} className="text-[13px] text-[#84454]">• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Action bullets */}
                    {(briefing?.actions ?? fallbackSuggestions).map((action: any, i: number) => {
                      const text = typeof action === "string" ? action : action?.text || JSON.stringify(action);
                      return (
                        <div key={i} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-[#E9EEF7]" : ""}`}>
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3B6EF5] text-[10px] font-bold text-white">
                            {i + 1}
                          </div>
                          <div>
                            <p className="text-[13px] leading-5 text-[#344054]">{text}</p>
                            {typeof action === "object" && action?.reason && (
                              <p className="mt-1 text-[11px] text-[#98A2B3]">Reason: {action.reason}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                )}
              </section>

              {/* Prominent banner when caregiver_alert fired within last 2 days */}
              {(() => {
                const latestAlert = detail.interventions.find(iv => iv.action_type === "caregiver_alert");
                if (!latestAlert) return null;
                const daysDiff = (Date.now() - new Date(latestAlert.timestamp).getTime()) / (1000 * 60 * 60 * 24);
                if (daysDiff > 2) return null;
                return (
                  <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <Siren size={16} className="text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[13px] font-bold text-red-700">Action Required</p>
                      <p className="text-[12px] text-red-600">
                        {latestAlert.message || "This patient's medication adherence needs your attention."}
                      </p>
                      <p className="text-[11px] text-red-400 mt-0.5">{new Date(latestAlert.timestamp).toLocaleDateString("en-SG")}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Recent system alerts from orchestrator */}
              {detail.interventions.length > 0 && (
                <section className="space-y-2">
                  <SectionTitle title="Recent Alerts" />
                  <section className="overflow-hidden rounded-2xl border border-[#E9EEF7] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    {detail.interventions.slice(0, 5).map((iv, i) => (
                      <div key={iv.intervention_id ?? i} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-[#E9EEF7]" : ""}`}>
                        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF8E8]">
                          <Siren size={13} className="text-[#E7A93B]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold capitalize text-[#344054]">
                            {iv.action_type.replace(/_/g, " ")}
                          </p>
                          {iv.reason && (
                            <p className="text-[12px] text-[#667085]">{iv.reason}</p>
                          )}
                          <p className="text-[11px] text-[#C0C8D6]">
                            {new Date(iv.timestamp).toLocaleDateString("en-SG")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </section>
                </section>
              )}

              {/* Memory & Focus Check */}
              {detail.memory_check && detail.memory_check.session_count > 0 && (
                <section className="space-y-2">
                  <SectionTitle title="Memory & Focus Check" />
                  <section className="overflow-hidden rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BrainCircuit size={16} className="text-[#3B6EF5]" />
                        <p className="text-[13px] text-[#475467]">
                          {detail.memory_check.session_count} session{detail.memory_check.session_count !== 1 ? "s" : ""} •
                          Avg {detail.memory_check.average_score}/3
                        </p>
                      </div>
                      <BadgePill
                        label={detail.memory_check.alert_pattern ? "Alert" : "Normal"}
                        tone={detail.memory_check.alert_pattern ? "red" : "success"}
                      />
                    </div>
                    {detail.memory_check.alert_pattern ? (
                      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <p className="text-[12px] font-semibold text-red-700">Cognitive Pattern Detected</p>
                        <p className="text-[11px] text-red-600">
                          {detail.memory_check.recent_lower_count} of last 5 check-ins scored lower than usual.
                          The clinician has been notified.
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-1.5">
                      {detail.memory_check.sessions.slice(0, 5).map((s) => (
                        <div key={s.session_id} className="flex items-center justify-between text-[12px]">
                          <span className="text-[#667085]">{new Date(s.created_at).toLocaleDateString("en-SG")}</span>
                          <span className={`font-semibold ${s.status === "slightly_lower" ? "text-red-600" : "text-green-600"}`}>
                            {s.score}/3 — {s.status === "slightly_lower" ? "Lower" : "Normal"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                </section>
              )}
            </>
          )}

          {!loading && patients.length === 0 && !error && (
            <div className="rounded-2xl border border-[#E9EEF7] bg-white p-8 text-center">
              <Users size={32} className="mx-auto mb-3 text-[#C0C8D6]" />
              <p className="text-[14px] font-semibold text-[#344054]">No patients linked</p>
              <p className="mt-1 text-[12px] text-[#98A2B3]">
                Ask your administrator to link a patient to your account.
              </p>
            </div>
          )}

        </section>

        <TabBar tabs={tabs} active="dashboard" containerRef={shellRef} />
      </div>
    </main>
  );
}
