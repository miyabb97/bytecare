"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BrainCircuit,
  Calendar,
  CalendarDays,
  Clock,
  Clock3,
  Home,
  LogOut,
  MapPin,
  Phone,
  Pill,
  Siren,
  Sparkles,
  ArrowRight,
  TriangleAlert,
  Users,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  User,
  FileText,
} from "lucide-react";

type CaregiverTab = "home" | "profile";

import { api, type Account, type CaregiverBriefing, type CaregiverPatientDetail, type CaregiverPatientSummary } from "../../../lib/api";
import {
  ActionTile,
  BadgePill,
  SectionTitle,
} from "../../../components/mobile/DashboardPrimitives";
import ConsequenceModalCompact from "../../../components/ConsequenceModalCompact";

/* ────────────────────── helpers ────────────────────── */

function toCalendarStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildCalendarUrl(appointment: { datetime: string; location: string; notes?: string | null }): string {
  const start = new Date(appointment.datetime);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "ByteCare Appointment",
    dates: `${toCalendarStamp(start)}/${toCalendarStamp(end)}`,
    location: appointment.location,
    details: appointment.notes || "Upcoming ByteCare appointment",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function appointmentPrepNote(appointment: { notes?: string | null }): string {
  const notes = (appointment.notes ?? "").toLowerCase();
  if (notes.includes("fasting")) {
    return "Please fast for 8–10 hours before the appointment. Only plain water is allowed.";
  }
  return "Please ensure the patient arrives 10 minutes early and brings any relevant medication or test records.";
}

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
  const missed = events.filter(
    e => ["not_taken", "missed", "skipped"].includes(e.response_status)
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
  } catch {
    return iso;
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
  const recent = days.slice(4).reduce((s, v) => s + v, 0);
  const prior = days.slice(0,4).reduce((s, v) => s + v, 0);
  const delta = recent - prior;
  let trendLabel = 'Stable';
  if (delta > 0) trendLabel = 'Slightly worsening';
  else if (delta < 0) trendLabel = 'Improving';
  return { days, recent, prior, delta, trendLabel };
}

/** Get today's doses grouped by medication with their status */
function getTodaysDoses(detail: CaregiverPatientDetail) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23,59,59,999);

  return detail.medications.map(med => {
    const todayEvents = detail.dose_events.filter(ev => {
      const t = new Date(ev.timestamp || '');
      return ev.medication_id === med.medication_id && t >= today && t <= todayEnd;
    });
    const scheduledTimes = med.schedule?.times || ["08:00"];
    const taken = todayEvents.filter(e => e.response_status === "taken" || ['tap_confirm','voice_confirm'].includes(e.event_type));
    const late = todayEvents.filter(e => e.response_status === "late" || e.event_type === "dose_late");
    const missed = todayEvents.filter(e => ["not_taken", "missed", "skipped"].includes(e.response_status));

    let status: "taken" | "late" | "missed" | "pending" = "pending";
    if (taken.length > 0) status = "taken";
    else if (late.length > 0) status = "late";
    else if (missed.length > 0) status = "missed";

    const lastEvent = todayEvents.sort((a,b) => b.timestamp.localeCompare(a.timestamp))[0];
    const takenTime = lastEvent ? new Date(lastEvent.timestamp).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }) : null;

    return {
      medication: med,
      scheduledTimes,
      status,
      takenTime,
      eventCount: todayEvents.length,
    };
  });
}


const statusConfig = {
  taken:   { icon: CheckCircle2, color: "text-[#15803D]", bg: "bg-[#ECFDF3]", label: "Taken" },
  late:    { icon: Clock,        color: "text-[#E7A93B]", bg: "bg-[#FFF8E8]", label: "Late" },
  missed:  { icon: XCircle,      color: "text-[#EF5A5A]", bg: "bg-[#FFF1F1]", label: "Missed" },
  pending: { icon: Clock,        color: "text-[#98A2B3]", bg: "bg-[#F2F4F7]", label: "Pending" },
};

/* ────────────────────── main page ────────────────────── */

export default function CaregiverDashboardPage({ params }: { params: { accountId: string } }) {
  const router = useRouter();
  const { accountId } = params;
  const [activeTab, setActiveTab] = useState<CaregiverTab>("home");
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
  const bottomNavRef = useRef<HTMLDivElement>(null);
  const [bottomNavBounds, setBottomNavBounds] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      setBottomNavBounds({ left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update); };
  }, []);

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

  useEffect(() => {
    if (!selectedId || !detail) return;
    setBriefingLoading(true);
    api.caregiverGetBriefing(accountId, selectedId)
      .then(b => { setBriefing(b); setBriefingLoading(false); })
      .catch(() => setBriefingLoading(false));
    api.getRefillStatus(selectedId)
      .then(r => { setRefillStatus(r.items); })
      .catch(() => setRefillStatus(null));
  }, [selectedId, accountId, detail]);

  const [medIndex, setMedIndex] = useState(0);
  useEffect(() => { setMedIndex(0); }, [detail]);
  const [consequenceOpen, setConsequenceOpen] = useState(false);
  const [pendingRefillMedId, setPendingRefillMedId] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleSlot, setRescheduleSlot] = useState<string | null>(null);
  const [rescheduleSent, setRescheduleSent] = useState(false);

  const stats = useMemo(() => detail ? calcAdherence(detail) : null, [detail]);
  const risk = useMemo(() => stats ? getRisk(stats.pct) : null, [stats]);
  const nextAppt = useMemo(() => detail ? getNextAppointment(detail) : null, [detail]);
  const fallbackSuggestions = useMemo(() => stats ? getEncouragementSuggestions(stats.pct, stats.missed) : [], [stats]);
  const todaysDoses = useMemo(() => detail ? getTodaysDoses(detail) : [], [detail]);

  const currentMed = detail && detail.medications && detail.medications.length > 0 ? detail.medications[medIndex % detail.medications.length] : null;
  const currentMedStats = currentMed ? computeMedStats(detail!, currentMed.medication_id) : null;
  const trend = detail ? computeTrend(detail) : null;

  if (!account) return null;

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div ref={shellRef} className="relative min-h-screen w-full max-w-md bg-slate-50 pb-24 md:border-x md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]">

        {/* ── Header ── */}
        <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/86 backdrop-blur-[12px]">
          <div className="mx-auto flex h-[78px] w-full max-w-md items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-blue-200 shadow-sm">
                <User size={20} className="text-[#3B6EF5]" />
              </div>
              <div>
                <h1 className="text-[18px] font-bold leading-none text-[#1F2A37]">ByteCare</h1>
                <p className="text-[12px] text-[#98A2B3]">{account.name}</p>
              </div>
            </div>
          </div>
        </header>

        <section className="space-y-4 px-4 pb-8 pt-5">

          {/* ══ HOME TAB ══ */}
          {activeTab === "home" && <>

          {/* ── Patient selector ── */}
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
                        : "border-slate-200 bg-white text-[#344054]"
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
              {/* ── Patient identity card ── */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(16,24,40,0.06)]">
                <div className="flex items-center gap-4 px-5 py-5">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-50 to-blue-100">
                    <User size={28} className="text-[#3B6EF5]" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[22px] font-bold leading-tight text-[#1F2A37]">
                      {detail.patient.name}, {detail.patient.age}
                    </h2>
                    {(detail.patient as { conditions?: string[] }).conditions?.length ? (
                      <p className="mt-0.5 text-[13px] text-[#667085]">
                        {(detail.patient as { conditions?: string[] }).conditions!.join(", ")}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[13px] font-semibold text-[#3B6EF5]">
                      {detail.medications.length} Medications Active
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Quick Access Grid ── */}
              <section className="space-y-2">
                <SectionTitle title="Quick Access" />
                <div className="grid grid-cols-3 gap-3">
                  <ActionTile
                    icon={<Phone size={18} />}
                    label={actionLoading === 'call' ? 'Calling…' : actionSuccess === 'call' ? 'Notified' : 'Call to Check In'}
                    onClick={async () => {
                      if (!selectedId || !detail || !account) return;
                      setActionLoading('call');
                      try {
                        await api.postChat(selectedId, `${account.name} would like to call you. Are you available for a short call?`);
                        setActionSuccess('call');
                        setTimeout(() => setActionSuccess(null), 2500);
                      } catch {} finally { setActionLoading(null); }
                    }}
                  />
                  <ActionTile
                    icon={<Calendar size={18} />}
                    label="View Appts"
                    onClick={() => document.getElementById("section-appointments")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  />
                  <ActionTile icon={<Pill size={18} />} label="Today's Doses" onClick={() => document.getElementById("section-doses")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
                  <ActionTile icon={<Pill size={18} />} label="Medications" onClick={() => document.getElementById("section-med-details")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
                  <ActionTile icon={<AlertTriangle size={18} />} label="Alerts" onClick={() => document.getElementById("section-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
                  <ActionTile icon={<BrainCircuit size={18} />} label="Memory" onClick={() => document.getElementById("section-memory")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
                </div>
              </section>

              {/* ── AI Caregiver Briefing — What to do today ── */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[#3B6EF5]" />
                  <SectionTitle title="What to do today" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-bold text-[#3B6EF5]">AI</span>
                </div>

                {briefingLoading && (
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-[13px] text-[#98A2B3]">
                    <Sparkles size={14} className="animate-pulse text-[#3B6EF5]" />
                    Generating personalised action plan…
                  </div>
                )}

                {!briefingLoading && (briefing ?? fallbackSuggestions.length > 0) && (
                  <div className="overflow-hidden rounded-2xl border border-[#D8E5FF] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.06)]">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
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
                      <div className="border-t border-slate-100 px-4 py-3">
                        <p className="text-[12px] font-semibold text-[#98A2B3]">Monitor</p>
                        <ul className="mt-1.5 space-y-1">
                          {briefing.monitoring.map((m, idx) => (
                            <li key={idx} className="text-[13px] text-[#344054]">• {m}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {briefing?.escalations && briefing.escalations.length > 0 && (
                      <div className="border-t border-slate-100 px-4 py-3">
                        <p className="text-[12px] font-semibold text-[#98A2B3]">Escalation Suggestions</p>
                        <ul className="mt-1.5 space-y-1">
                          {briefing.escalations.map((e, idx) => (
                            <li key={idx} className="text-[13px] text-[#344054]">• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(briefing?.actions ?? fallbackSuggestions).map((action: any, i: number) => {
                      const text = typeof action === "string" ? action : action?.text || JSON.stringify(action);
                      return (
                        <div key={i} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-slate-100" : "border-t border-slate-100"}`}>
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
                  </div>
                )}
              </section>

              {/* ── Quick Summary ── */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-[#3B6EF5]" />
                    <SectionTitle title="Quick Summary" />
                  </div>
                  <BadgePill label={risk.badge} tone={risk.tone} />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(16,24,40,0.06)]">
                  {/* Today's Medication Stats — same line */}
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">Today's Medication Stats</p>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-[#15803D]" />
                        <span className="text-[13px] text-[#667085]">Taken</span>
                        <span className="text-[15px] font-bold text-[#15803D]">{todaysDoses.filter(d => d.status === 'taken').length}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-[#E7A93B]" />
                        <span className="text-[13px] text-[#667085]">Late</span>
                        <span className="text-[15px] font-bold text-[#E7A93B]">{todaysDoses.filter(d => d.status === 'late').length}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-[#EF5A5A]" />
                        <span className="text-[13px] text-[#667085]">Missed</span>
                        <span className="text-[15px] font-bold text-[#EF5A5A]">{todaysDoses.filter(d => d.status === 'missed').length}</span>
                      </div>
                    </div>
                  </div>
                  {/* Historical Adherence Data — next line */}
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">Historical Adherence</p>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-[#667085]">Total Taken</span>
                        <span className="text-[14px] font-bold text-[#15803D]">{stats.taken}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-[#667085]">Total Late</span>
                        <span className="text-[14px] font-bold text-[#E7A93B]">{stats.late}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-[#667085]">Not Taken</span>
                        <span className="text-[14px] font-bold text-[#EF5A5A]">{stats.missed}</span>
                      </div>
                    </div>
                  </div>
                  {/* Adherence Percentage + 7-Day Trend */}
                  {trend && (
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[11px] font-medium text-[#98A2B3]">Adherence Rate</p>
                          <p className="text-[22px] font-bold text-[#1F2A37]">{stats.pct}%</p>
                          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${risk.tone === 'success' ? 'bg-[#ECFDF3] text-[#15803D]' : risk.tone === 'yellow' ? 'bg-[#FFF8E8] text-[#E7A93B]' : 'bg-[#FFF1F1] text-[#EF5A5A]'}`}>
                            {risk.tone === 'success' ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                            {risk.label}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-medium text-[#98A2B3]">7-Day Trend</p>
                          <p className="text-[12px] font-semibold text-[#344054]">{trend.trendLabel === 'Stable' ? 'Stable' : 'Not Stable'}</p>
                          <svg viewBox="0 0 100 40" className="mt-1 h-8 w-24" preserveAspectRatio="none">
                            <polyline fill="none" stroke="#3B6EF5" strokeWidth={2} points={trend.days.map((d,i)=>`${(i/(trend.days.length-1))*100},${40-(d/Math.max(...trend.days,1))*30}`).join(' ')} strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* AI Summary — 2 pointers */}
                  <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles size={11} className="text-[#3B6EF5]" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">AI Summary</p>
                    </div>
                    {/* Pointer 1 — Medication adherence */}
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#3B6EF5] text-[9px] font-bold text-white">1</span>
                      <p className="text-[12px] leading-[1.55] text-[#475467]">
                        {stats.pct >= 85
                          ? `Medication adherence is strong at ${stats.pct}% — ${stats.taken} dose${stats.taken !== 1 ? "s" : ""} taken on time with only ${stats.missed} missed overall.`
                          : stats.pct >= 70
                          ? `Adherence is at ${stats.pct}%, needing attention — ${stats.missed} dose${stats.missed !== 1 ? "s" : ""} missed and ${stats.late} late across all records. A check-in is advised.`
                          : `Adherence is low at ${stats.pct}% — ${stats.missed} missed dose${stats.missed !== 1 ? "s" : ""} and ${stats.late} late across all records. Immediate follow-up is recommended.`}
                      </p>
                    </div>
                    {/* Pointer 2 — Memory check */}
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#3B6EF5] text-[9px] font-bold text-white">2</span>
                      <p className="text-[12px] leading-[1.55] text-[#475467]">
                        {detail.memory_check && detail.memory_check.session_count > 0
                          ? detail.memory_check.alert_pattern
                            ? `Memory check shows a declining pattern — ${detail.memory_check.recent_lower_count} of the last 5 sessions scored below average (avg ${detail.memory_check.average_score}/3). Cognitive support may be needed.`
                            : `Memory check results are normal across ${detail.memory_check.session_count} session${detail.memory_check.session_count !== 1 ? "s" : ""} with an average score of ${detail.memory_check.average_score}/3. No concerning pattern detected.`
                          : `No memory check sessions recorded yet for this patient.`}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Today's Doses ── */}
              <section id="section-doses" className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-[#3B6EF5]" />
                  <SectionTitle title="Today's Doses" />
                </div>
                <div className="space-y-2">
                  {todaysDoses.length > 0 ? todaysDoses.map(dose => {
                    const cfg = statusConfig[dose.status];
                    const Icon = cfg.icon;
                    return (
                      <div key={dose.medication.medication_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-[#1F2A37]">{dose.medication.name}</p>
                            <p className="mt-0.5 text-[12px] text-[#667085]">
                              {dose.scheduledTimes.join(", ")} · {dose.medication.dose_text}
                            </p>
                            {dose.takenTime && (
                              <p className="mt-0.5 text-[11px] text-[#98A2B3]">
                                Recorded at {dose.takenTime}
                              </p>
                            )}
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${cfg.bg} ${cfg.color}`}>
                            <Icon size={12} />
                            {cfg.label}
                          </span>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-[13px] text-[#98A2B3]">
                      No doses scheduled for today.
                    </div>
                  )}
                </div>
              </section>

              {/* ── Medication Details (Consequences & History) ── */}
              <section id="section-med-details" className="space-y-2">
                <div className="flex items-center gap-2">
                  <Pill size={14} className="text-[#3B6EF5]" />
                  <SectionTitle title="Medication Details" />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(16,24,40,0.06)]">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#FFF1F1]">
                      <Pill size={16} className="text-[#EF5A5A]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#1F2A37]">{stats.missed} missed dose{stats.missed !== 1 ? 's' : ''} in past week</p>
                      <p className="mt-1 text-[13px] text-[#667085]">View specific medication histories and suggested actions.</p>
                    </div>
                  </div>

                  {/* Medications list with refill status */}
                  {detail.medications.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">Active Medications</p>
                      <div className="space-y-2">
                        {detail.medications.map(m => {
                          const status = refillStatus?.find(s => s.medication_id === m.medication_id);
                          return (
                            <div key={m.medication_id} className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#344054]">
                                <Pill size={10} className="text-[#667085]" />
                                {m.name} · {m.dose_text}
                              </span>
                              <div className="flex items-center gap-2">
                                {status && status.tracking_enabled && (
                                  <span className="text-[11px] text-[#98A2B3]">{status.doses_remaining} left{status.days_remaining ? ` (~${status.days_remaining}d)` : ''}</span>
                                )}
                                {status && status.needs_refill && (
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
                                      } catch {} finally { setActionLoading(null); }
                                    }}
                                    disabled={actionLoading === m.medication_id}
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${actionLoading === m.medication_id ? 'bg-[#172554] opacity-80' : 'bg-[#3B6EF5]'}`}
                                  >
                                    {actionLoading === m.medication_id ? '…' : (requestedMedIds.includes(m.medication_id) || actionSuccess === m.medication_id) ? 'Requested' : 'Refill'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Consequence / History toggle */}
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setMedViewMode('consequences')} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${medViewMode === 'consequences' ? 'bg-[#3B6EF5] text-white' : 'bg-slate-100 text-[#344054]'}`}>Consequences</button>
                        <button type="button" onClick={() => setMedViewMode('history')} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${medViewMode === 'history' ? 'bg-[#3B6EF5] text-white' : 'bg-slate-100 text-[#344054]'}`}>History</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-[#98A2B3]">{detail.medications.length > 0 ? ((medIndex % detail.medications.length) + 1) : '-'}/{detail.medications.length}</span>
                        <button type="button" onClick={() => { if (detail.medications.length > 0) setMedIndex(i => (i + 1) % detail.medications.length); }} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100">
                          <ArrowRight size={14} className="text-[#3B6EF5]" />
                        </button>
                      </div>
                    </div>
                    {currentMed && (() => {
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
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-[#1F2A37]">{m.name} · {m.dose_text}</p>
                              <p className="mt-1 text-[12px] text-[#98A2B3]">Last taken: {formatShortDate(st.lastTaken)} · {st.taken} taken · {st.missed} missed · {st.late} late</p>
                            </div>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${urgent ? 'bg-[#FFF1F1] text-[#EF5A5A] border border-[#FFD8D8]' : 'bg-[#ECFDF3] text-[#15803D] border border-[#B7EACB]'}`}>{adherencePct}%</span>
                          </div>
                          {medViewMode === 'consequences' && (
                            <>
                              <p className="mt-2 text-[13px] text-[#344054]">• {consequence}</p>
                              <div className="mt-2">
                                {medRecommendations[m.medication_id]?.recommendations ? (
                                  <div>
                                    <p className="text-[12px] text-[#98A2B3]">Recommended next step:</p>
                                    <p className="mt-1 text-[13px] text-[#344054]">• {medRecommendations[m.medication_id].recommendations[0]}</p>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!selectedId) return;
                                      setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: [], loading: true } }));
                                      try {
                                        const res = await api.caregiverGetMedRecommendations(accountId, selectedId, m.medication_id);
                                        setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: (res.recommendations || []).slice(0,1), confidence: res.confidence ?? null } }));
                                      } catch {
                                        const localFallback: string[] = [];
                                        if (isHighRisk) {
                                          localFallback.push(`This is a high-risk medication. If multiple doses are missed, contact clinician immediately.`);
                                        } else if (st.missed > 0) {
                                          localFallback.push(`Call ${detail.patient.name.split(' ')[0]} to check why ${m.name} was missed.`);
                                        } else {
                                          localFallback.push(`Confirm ${m.name} supply and help set a reminder.`);
                                        }
                                        setMedRecommendations(prev => ({ ...prev, [m.medication_id]: { recommendations: localFallback.slice(0,1), confidence: null } }));
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 rounded-full bg-[#3B6EF5] px-3 py-1 text-[12px] font-semibold text-white"
                                  >
                                    <Sparkles size={10} /> Get next steps
                                  </button>
                                )}
                              </div>
                              {urgent && (
                                <button
                                  type="button"
                                  onClick={() => { setPendingRefillMedId(m.medication_id); setConsequenceOpen(true); }}
                                  className="mt-3 w-full rounded-xl bg-[#EF5A5A] px-4 py-2 text-[13px] font-semibold text-white shadow-sm"
                                >
                                  Request urgent refill
                                </button>
                              )}
                            </>
                          )}
                          {medViewMode === 'history' && (
                            <div className="mt-2">
                              <p className="mb-1 text-[12px] text-[#98A2B3]">Recent events (7d)</p>
                              <ul className="list-disc pl-4">
                                {detail.dose_events.filter(ev => ev.medication_id === m.medication_id).slice(0,7).map(ev => (
                                  <li key={ev.event_id} className="text-[13px] text-[#344054]">{formatShortDate(ev.timestamp)} — {ev.response_status}</li>
                                ))}
                                {detail.dose_events.filter(ev => ev.medication_id === m.medication_id).length === 0 && <li className="text-[13px] text-[#98A2B3]">No events in the last 7 days.</li>}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                      } catch {} finally { setActionLoading(null); setPendingRefillMedId(null); }
                    }}
                  />
                </div>
              </section>

              {/* ── Upcoming Appointment ── */}
              <section id="section-appointments" className="space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className="text-[#3B6EF5]" />
                  <SectionTitle title="Upcoming Appointment" />
                </div>
                {nextAppt ? (() => {
                  const daysRemaining = Math.ceil((new Date(nextAppt.datetime).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <div className="relative overflow-hidden rounded-[2rem] bg-[#3670e2] px-5 py-5 text-white shadow-[0_16px_36px_rgba(54,112,226,0.3)]">
                      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
                      <div className="relative z-10 space-y-4">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <CalendarDays size={16} className="opacity-90" />
                              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">Upcoming Visit</span>
                            </div>
                            <p className="text-lg font-bold leading-tight">
                              {new Date(nextAppt.datetime).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-3xl font-black leading-none">{daysRemaining > 0 ? daysRemaining : 0}</span>
                            <span className="text-[11px] opacity-80">days to go</span>
                          </div>
                        </div>
                        {/* Details */}
                        <div className="space-y-2 border-t border-white/10 pt-3">
                          <div className="flex items-center gap-2.5">
                            <MapPin size={15} className="shrink-0 text-blue-200" />
                            <p className="text-sm font-medium">{nextAppt.location}</p>
                          </div>
                          {nextAppt.notes && (
                            <div className="flex items-center gap-2.5">
                              <Clock3 size={15} className="shrink-0 text-blue-200" />
                              <p className="text-sm text-blue-50/90">{nextAppt.notes}</p>
                            </div>
                          )}
                        </div>
                        {/* Prep note */}
                        <div className="flex items-start gap-2.5 rounded-[1.2rem] border border-white/20 bg-white/10 px-3 py-3">
                          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-white" />
                          <p className="text-xs leading-relaxed text-blue-50">{appointmentPrepNote(nextAppt)}</p>
                        </div>
                        {/* Reschedule panel */}
                        {showReschedule && !rescheduleSent && (
                          <div className="rounded-[1.35rem] border border-white/15 bg-white/10 p-4 space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Available slots</p>
                            <div className="grid grid-cols-1 gap-2">
                              {[
                                { label: "Mon 13 Apr, 9:00 AM", value: "2026-04-13T09:00" },
                                { label: "Mon 13 Apr, 2:30 PM", value: "2026-04-13T14:30" },
                                { label: "Wed 15 Apr, 10:00 AM", value: "2026-04-15T10:00" },
                                { label: "Thu 16 Apr, 11:30 AM", value: "2026-04-16T11:30" },
                                { label: "Fri 17 Apr, 3:00 PM", value: "2026-04-17T15:00" },
                              ].map(slot => (
                                <button
                                  key={slot.value}
                                  type="button"
                                  className={`rounded-[0.85rem] px-3 py-2 text-sm font-medium text-left transition ${rescheduleSlot === slot.value ? "bg-white text-[#3670e2] font-semibold" : "bg-white/15 text-white hover:bg-white/25"}`}
                                  onClick={() => setRescheduleSlot(slot.value)}
                                >
                                  {slot.label}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button type="button" className="flex-1 rounded-[0.85rem] bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25" onClick={() => { setShowReschedule(false); setRescheduleSlot(null); }}>Cancel</button>
                              <button type="button" disabled={!rescheduleSlot} className="flex-1 rounded-[0.85rem] bg-white px-3 py-2 text-sm font-semibold text-[#3670e2] transition disabled:opacity-40" onClick={() => { if (rescheduleSlot) setRescheduleSent(true); }}>Send Request</button>
                            </div>
                          </div>
                        )}
                        {/* Sent confirmation */}
                        {rescheduleSent && (
                          <div className="flex items-center gap-2.5 rounded-[1.2rem] bg-white/15 px-3 py-3">
                            <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
                            <p className="text-xs text-blue-50">Reschedule request sent. The clinician will confirm shortly.</p>
                          </div>
                        )}
                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button type="button" className="flex-1 rounded-[1.25rem] bg-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25" onClick={() => { setShowReschedule(v => !v); setRescheduleSent(false); setRescheduleSlot(null); }}>
                            {showReschedule ? "Hide" : "Reschedule"}
                          </button>
                          <button type="button" className="flex-1 rounded-[1.25rem] bg-white px-4 py-2.5 text-sm font-semibold text-[#3670e2] shadow-[0_10px_20px_rgba(15,23,42,0.12)] transition hover:bg-slate-50" onClick={() => window.open(buildCalendarUrl(nextAppt), "_blank", "noopener,noreferrer")}>
                            Add to calendar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 text-sm text-slate-500 shadow-sm">
                    No upcoming appointments scheduled.
                  </div>
                )}
              </section>

              {/* ── All Appointments List ── */}
              {detail.appointments.length > 1 && (
                <section className="space-y-2">
                  <SectionTitle title="All Appointments" />
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    {detail.appointments.slice(0, 5).map((appt, i) => {
                      const isPast = new Date(appt.datetime) < new Date();
                      return (
                        <div key={appt.appointment_id ?? i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-slate-100" : ""}`}>
                          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isPast ? 'bg-slate-100' : 'bg-[#EEF4FF]'}`}>
                            <Calendar size={14} className={isPast ? 'text-[#98A2B3]' : 'text-[#3B6EF5]'} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[13px] font-medium ${isPast ? 'text-[#98A2B3]' : 'text-[#1F2A37]'}`}>
                              {new Date(appt.datetime).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })}
                              {" · "}
                              {new Date(appt.datetime).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            <p className="text-[12px] text-[#667085]">{appt.location}</p>
                          </div>
                          {isPast && <span className="text-[10px] font-medium text-[#98A2B3]">Past</span>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Recent Alerts ── */}
              {detail.interventions.length > 0 && (
                <section id="section-alerts" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-[#E7A93B]" />
                      <SectionTitle title="Recent Alerts" />
                    </div>
                    <span className="text-[11px] text-[#98A2B3]">{detail.interventions.length} alert{detail.interventions.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    {/* AI insight — caregiver-addressed summary */}
                    {(() => {
                      const ivs = detail.interventions;
                      const firstName = detail.patient.name.split(" ")[0];
                      const urgentAlerts = ivs.filter(iv => iv.action_type === "caregiver_alert" && (Date.now() - new Date(iv.timestamp).getTime()) / (1000 * 60 * 60 * 24) <= 2);
                      const typeCounts: Record<string, number> = {};
                      ivs.forEach(iv => { typeCounts[iv.action_type] = (typeCounts[iv.action_type] || 0) + 1; });
                      const missed = (typeCounts["dose_missed"] || 0) + (typeCounts["missed_dose"] || 0);
                      const late = typeCounts["dose_late"] || 0;
                      const lowSupply = (typeCounts["refill_needed"] || 0) + (typeCounts["low_supply"] || 0);
                      const cognitive = (typeCounts["memory_alert"] || 0) + (typeCounts["cognitive_alert"] || 0);
                      const escalated = (typeCounts["escalation"] || 0) + (typeCounts["clinical_escalation"] || 0);

                      let insight = "";
                      if (urgentAlerts.length > 0) {
                        const reasonParts = [
                          missed > 0 ? `${missed} missed dose${missed > 1 ? "s" : ""}` : "",
                          late > 0 ? `${late} late dose${late > 1 ? "s" : ""}` : "",
                          stats.pct < 85 ? `overall adherence at ${stats.pct}%` : "",
                        ].filter(Boolean);
                        const situation = reasonParts.length > 0 ? reasonParts.join(", ") : "medication adherence below the safe threshold";
                        insight = `${firstName}'s adherence has triggered an urgent alert — ${situation}. Please check in with ${firstName} today to understand what is preventing them from taking their medication on time.`;
                      } else if (missed > 0 || late > 0) {
                        const parts = [
                          missed > 0 ? `${missed} missed dose${missed > 1 ? "s" : ""}` : "",
                          late > 0 ? `${late} late dose${late > 1 ? "s" : ""}` : "",
                        ].filter(Boolean).join(" and ");
                        insight = `Your patient ${firstName} has had ${parts} recorded recently. You may want to reach out to understand if there are any barriers — such as forgetting, side effects, or difficulty accessing medication.`;
                      } else if (lowSupply > 0) {
                        insight = `${firstName}'s medication supply is running low. As the caregiver, please help arrange a refill soon to avoid any unplanned gaps in treatment.`;
                      } else if (cognitive > 0) {
                        insight = `A cognitive concern has been flagged for ${firstName}. This may affect their ability to manage medication independently — consider increasing your check-in frequency.`;
                      } else if (escalated > 0) {
                        insight = `${escalated > 1 ? `${escalated} alerts have` : "An alert has"} been escalated to the clinical team regarding ${firstName}. You do not need to take clinical action, but stay available in case the clinician needs your input.`;
                      } else {
                        insight = `${ivs.length} alert${ivs.length > 1 ? "s have" : " has"} been logged for ${firstName}. No urgent patterns detected — review the list below and follow up on anything that looks unusual.`;
                      }
                      return (
                        <div className="flex items-start gap-2 border-b border-slate-100 bg-[#FAFBFF] px-4 py-3">
                          <Sparkles size={12} className="mt-0.5 shrink-0 text-[#3B6EF5]" />
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3] mb-0.5">AI Insight</p>
                            <p className="text-[12px] leading-[1.55] text-[#475467]">{insight}</p>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Vertically scrollable alert list */}
                    <div className="max-h-[320px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                      {detail.interventions.slice(0, 8).map((iv, i) => {
                        const isActionRequired = iv.action_type === "caregiver_alert" &&
                          (Date.now() - new Date(iv.timestamp).getTime()) / (1000 * 60 * 60 * 24) <= 2;
                        return (
                          <div key={iv.intervention_id ?? i} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-slate-100" : ""} ${isActionRequired ? "bg-red-50" : ""}`}>
                            <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isActionRequired ? "bg-red-100" : "bg-[#FFF8E8]"}`}>
                              <Siren size={13} className={isActionRequired ? "text-red-500" : "text-[#E7A93B]"} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-[13px] font-semibold capitalize ${isActionRequired ? "text-red-700" : "text-[#344054]"}`}>
                                  {isActionRequired ? "Action Required" : iv.action_type.replace(/_/g, " ")}
                                </p>
                                {isActionRequired && (
                                  <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[9px] font-bold uppercase text-white">Urgent</span>
                                )}
                              </div>
                              {isActionRequired && (
                                <p className="text-[12px] text-red-600">{(iv as any).message || "This patient's medication adherence needs your attention."}</p>
                              )}
                              {!isActionRequired && iv.reason && <p className="text-[12px] text-[#667085]">{iv.reason}</p>}
                              <p className={`text-[11px] ${isActionRequired ? "text-red-400" : "text-[#C0C8D6]"}`}>{new Date(iv.timestamp).toLocaleDateString("en-SG")}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Memory & Focus Check ── */}
              {detail.memory_check && detail.memory_check.session_count > 0 && (
                <section id="section-memory" className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BrainCircuit size={14} className="text-[#3B6EF5]" />
                    <SectionTitle title="Memory & Focus Check" />
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
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
                    {detail.memory_check.alert_pattern && (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                        <p className="text-[12px] font-semibold text-red-700">Cognitive Pattern Detected</p>
                        <p className="text-[11px] text-red-600">
                          {detail.memory_check.recent_lower_count} of last 5 check-ins scored lower than usual.
                          The clinician has been notified.
                        </p>
                      </div>
                    )}
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
                  </div>
                </section>
              )}
            </>
          )}

          {!loading && patients.length === 0 && !error && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <Users size={32} className="mx-auto mb-3 text-[#C0C8D6]" />
              <p className="text-[14px] font-semibold text-[#344054]">No patients linked</p>
              <p className="mt-1 text-[12px] text-[#98A2B3]">
                Ask your administrator to link a patient to your account.
              </p>
            </div>
          )}

          </>}

          {/* ══ PROFILE TAB ══ */}
          {activeTab === "profile" && (
            <div className="space-y-4">
              {/* Profile header */}
              <section className="flex flex-col items-center pb-1 pt-2">
                <div className="grid h-24 w-24 place-items-center rounded-full border-4 border-white bg-gradient-to-br from-blue-100 to-blue-200 shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
                  <User size={36} className="text-[#3B6EF5]" />
                </div>
                <div className="mt-4 text-center">
                  <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-slate-900">
                    {account.name}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Caregiver · ID: {accountId}</p>
                </div>
              </section>

              {/* Personal info */}
              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <User size={20} className="text-[#3670e2]" />
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Personal Information</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Role</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">Caregiver</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Patients</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{patients.length}</p>
                  </div>
                  {account.email && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Email</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{account.email}</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Patient overview */}
              {patients.length > 0 && (
                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <FileText size={20} className="text-[#3670e2]" />
                    <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Patients Under Care</h3>
                  </div>
                  <div className="space-y-3">
                    {patients.map(p => (
                      <div key={p.user_id} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{p.name}</p>
                          <p className="text-[12px] text-slate-500">Age {p.age} · {p.medication_count} medication{p.medication_count !== 1 ? "s" : ""}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setActiveTab("home"); setSelectedId(p.user_id); }}
                          className="rounded-full bg-[#EEF4FF] px-3 py-1 text-[12px] font-semibold text-[#3B6EF5]"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* App settings */}
              <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">App Settings</h3>
                </div>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.removeItem("bytecare_account");
                      localStorage.removeItem("bytecare_account");
                      router.replace("/auth/signin");
                    }}
                    className="flex items-center justify-between bg-slate-50 px-5 py-4 text-left transition hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-3">
                      <LogOut size={20} className="text-red-500" />
                      <span className="text-sm font-bold text-red-500">Log Out</span>
                    </div>
                  </button>
                </div>
              </section>
            </div>
          )}

        </section>

        {/* ── Bottom nav (matches patient page exactly) ── */}
        <div
          ref={bottomNavRef}
          className="pointer-events-none fixed bottom-0 z-50 pb-[max(env(safe-area-inset-bottom),0px)]"
          style={bottomNavBounds ? { left: `${bottomNavBounds.left}px`, width: `${bottomNavBounds.width}px` } : undefined}
        >
          <div className="w-full">
            <nav className="tc-bottom-nav pointer-events-auto flex w-full items-center justify-between border-t border-slate-200 bg-white px-6 pb-6 pt-2">
              <button
                type="button"
                className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
                onClick={() => setActiveTab("home")}
              >
                <span className={activeTab === "home" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}>
                  <Home size={activeTab === "home" ? 24 : 22} strokeWidth={activeTab === "home" ? 2.15 : 1.95} />
                </span>
                <span className={`text-[11px] ${activeTab === "home" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Home</span>
              </button>
              <button
                type="button"
                className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
                onClick={() => setActiveTab("profile")}
              >
                <span className={activeTab === "profile" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}>
                  <User size={activeTab === "profile" ? 24 : 22} strokeWidth={activeTab === "profile" ? 2.15 : 1.95} />
                </span>
                <span className={`text-[11px] ${activeTab === "profile" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Profile</span>
              </button>
            </nav>
          </div>
        </div>
      </div>
    </main>
  );
}
