"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  BrainCircuit,
  Cake,
  CalendarClock,
  ClipboardList,
  Download,
  Languages,
  LogOut,
  MapPin,
  PencilLine,
  Search,
  FileText,
  TrendingUp,
  Pill,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Stethoscope,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import {
  api,
  type Account,
  type AppointmentItem,
  type ClinicianAISummary,
  type ClinicianAllPatientItem,
  type ClinicianPatientDetail,
  type ClinicianPatientSummary,
  type MedicationItem,
  type WeeklySummaryResponse,
} from "../../../lib/api";
import {
  BadgePill,
  ChartCard,
  Header,
  SectionTitle,
  SummaryCard,
  TabBar,
} from "../../../components/mobile/DashboardPrimitives";

type ClinicianTab = "patients" | "care-plan" | "outcomes" | "ai-insights" | "profile";

type CarePlanMeta = {
  sex: string;
  backgroundNotes: string;
  caregiverContext: string;
  followUpReason: string;
  reviewCadence: string;
  followUpStatus: string;
};

type PatientRiskTone = "red" | "amber" | "emerald";

type EnrichedPatientCard = {
  summary: ClinicianPatientSummary;
  detail: ClinicianPatientDetail | null;
  adherencePct: number | null;
  riskLabel: string;
  riskTone: PatientRiskTone;
  flagged: boolean;
  isNewlyAdded: boolean;
};

const DEFAULT_META: CarePlanMeta = {
  sex: "",
  backgroundNotes: "",
  caregiverContext: "",
  followUpReason: "Medication adherence review",
  reviewCadence: "Weekly",
  followUpStatus: "Planned",
};

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function computePatientAdherence(detail: ClinicianPatientDetail | null): number | null {
  const counts = detail?.mee?.counts;
  if (!counts) return null;
  const notTaken = (counts.not_taken ?? 0) + (counts.missed ?? 0) + (counts.skipped ?? 0);
  const total = counts.taken + counts.late + notTaken;
  if (total <= 0) return 0;
  return Math.round(((counts.taken + 0.5 * counts.late) / total) * 100);
}

function riskMeta(detail: ClinicianPatientDetail | null): { label: string; tone: PatientRiskTone; flagged: boolean } {
  const severity = (detail?.drift?.severity || "").toLowerCase();
  if (severity === "red") return { label: "High Risk", tone: "red", flagged: true };
  if (severity === "orange" || severity === "amber" || severity === "yellow") {
    return { label: "Moderate Risk", tone: "amber", flagged: true };
  }
  return { label: "Low Risk", tone: "emerald", flagged: false };
}

function isNewPatient(createdAt?: string | null): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const ageMs = Date.now() - created.getTime();
  return ageMs <= 1000 * 60 * 60 * 24 * 14;
}

function patientAvatarTone(userId: string): string {
  const tones = [
    "from-[#DBEAFE] to-[#BFDBFE]",
    "from-[#E0F2FE] to-[#BAE6FD]",
    "from-[#DCFCE7] to-[#BBF7D0]",
    "from-[#FCE7F3] to-[#FBCFE8]",
  ];
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

function patientInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function loadMeta(patientUserId: string): CarePlanMeta {
  if (typeof window === "undefined") return DEFAULT_META;
  const raw = localStorage.getItem(`bytecare_clinician_meta_${patientUserId}`);
  if (!raw) return DEFAULT_META;
  try {
    return { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<CarePlanMeta>) };
  } catch {
    return DEFAULT_META;
  }
}

function saveMeta(patientUserId: string, value: CarePlanMeta): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`bytecare_clinician_meta_${patientUserId}`, JSON.stringify(value));
}

export default function ClinicianDashboardPage() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const shellRef = useRef<HTMLDivElement>(null);
  const accountId = decodeURIComponent(
    Array.isArray(params.accountId) ? params.accountId[0] : params.accountId ?? ""
  );

  const [account, setAccount] = useState<Account | null>(null);
  const [tab, setTab] = useState<ClinicianTab>("patients");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [patients, setPatients] = useState<ClinicianPatientSummary[]>([]);
  const [allPatients, setAllPatients] = useState<ClinicianAllPatientItem[]>([]);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientFilter, setPatientFilter] = useState<"all" | "high-risk" | "low-risk" | "new">("all");
  const [patientDetailMap, setPatientDetailMap] = useState<Record<string, ClinicianPatientDetail>>({});
  const [floatingBounds, setFloatingBounds] = useState<{ left: number; width: number } | null>(null);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClinicianPatientDetail | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [aiSummary, setAiSummary] = useState<ClinicianAISummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [profileSaving, setProfileSaving] = useState(false);
  const [conditionsSaving, setConditionsSaving] = useState(false);
  const [medSaving, setMedSaving] = useState(false);
  const [apptSaving, setApptSaving] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [isConditionsEditorOpen, setIsConditionsEditorOpen] = useState(false);

  const [meta, setMeta] = useState<CarePlanMeta>(DEFAULT_META);

  const [profileForm, setProfileForm] = useState({
    name: "",
    age: "",
    timezone: "Asia/Singapore",
    language_preference: "English",
    sex: "",
    backgroundNotes: "",
    caregiverContext: "",
  });

  const [conditionsText, setConditionsText] = useState("");

  const [medForm, setMedForm] = useState({
    medication_id: "",
    name: "",
    dose_text: "",
    frequency: "once_daily",
    times: "08:00",
    time_window_minutes: "120",
    criticality: "medium",
  });

  const [apptForm, setApptForm] = useState({
    appointment_id: "",
    datetime: "",
    location: "",
    notes: "",
  });

  const isEditingMed = medForm.medication_id.length > 0;
  const isEditingAppt = apptForm.appointment_id.length > 0;

  useEffect(() => {
    setIsProfileEditorOpen(false);
    setIsConditionsEditorOpen(false);
  }, [selectedPatientId]);

  useEffect(() => {
    const updateBounds = () => {
      const element = shellRef.current;
      if (!element) {
        setFloatingBounds(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setFloatingBounds({ left: rect.left, width: rect.width });
    };

    updateBounds();

    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, { passive: true });

    const element = shellRef.current;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && element
        ? new ResizeObserver(() => updateBounds())
        : null;

    if (resizeObserver && element) {
      resizeObserver.observe(element);
    }

    return () => {
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds);
      resizeObserver?.disconnect();
    };
  }, []);

  const navTabs = useMemo(
    () => [
      { key: "patients", label: "Patients", icon: <Users size={18} strokeWidth={2.1} /> },
      { key: "care-plan", label: "Care Plan", icon: <ClipboardList size={18} strokeWidth={2.1} /> },
      { key: "outcomes", label: "Outcomes", icon: <FileText size={18} strokeWidth={2.1} /> },
      { key: "ai-insights", label: "AI Insights", icon: <BrainCircuit size={18} strokeWidth={2.1} /> },
      { key: "profile", label: "Profile", icon: <Settings size={18} strokeWidth={2.1} /> },
    ],
    []
  );

  const scheduleSummary = useMemo(() => {
    if (!detail?.medications?.length) return [] as Array<{ label: string; meds: string[] }>;
    const buckets = new Map<string, string[]>();
    detail.medications.forEach((med) => {
      const times = med.schedule?.times?.length ? med.schedule.times : ["As needed"];
      times.forEach((timeLabel) => {
        const items = buckets.get(timeLabel) ?? [];
        items.push(`${med.name} (${med.dose_text || "dose n/a"})`);
        buckets.set(timeLabel, items);
      });
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, meds]) => ({ label, meds }));
  }, [detail]);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.user_id === selectedPatientId) ?? null,
    [patients, selectedPatientId]
  );

  const enrichedPatients = useMemo<EnrichedPatientCard[]>(() => {
    return patients.map((summary) => {
      const detail = patientDetailMap[summary.user_id] ?? null;
      const adherencePct = computePatientAdherence(detail);
      const meta = riskMeta(detail);
      const createdAt = detail?.patient?.created_at;
      return {
        summary,
        detail,
        adherencePct,
        riskLabel: meta.label,
        riskTone: meta.tone,
        flagged: meta.flagged,
        isNewlyAdded: isNewPatient(createdAt),
      };
    });
  }, [patients, patientDetailMap]);

  const filteredPatients = useMemo(() => {
    const search = patientSearch.trim().toLowerCase();
    return enrichedPatients.filter((patient) => {
      const matchesSearch =
        !search ||
        patient.summary.name.toLowerCase().includes(search) ||
        patient.summary.conditions.some((condition) => condition.toLowerCase().includes(search));

      if (!matchesSearch) return false;

      if (patientFilter === "high-risk") return patient.flagged;
      if (patientFilter === "low-risk") return patient.riskTone === "emerald";
      if (patientFilter === "new") return patient.isNewlyAdded;
      return true;
    });
  }, [enrichedPatients, patientFilter, patientSearch]);

  const priorityWatchlist = useMemo(() => {
    if (patientFilter !== "all" && patientFilter !== "high-risk") {
      return [] as EnrichedPatientCard[];
    }
    return filteredPatients
      .filter((patient) => patient.flagged)
      .sort((a, b) => {
        const toneRank = { red: 0, amber: 1, emerald: 2 } as const;
        const diff = toneRank[a.riskTone] - toneRank[b.riskTone];
        if (diff !== 0) return diff;
        return (a.adherencePct ?? 999) - (b.adherencePct ?? 999);
      })
      .slice(0, 3);
  }, [filteredPatients, patientFilter]);

  const priorityWatchlistIds = useMemo(
    () => new Set(priorityWatchlist.map((patient) => patient.summary.user_id)),
    [priorityWatchlist]
  );

  const remainingPatients = useMemo(
    () => filteredPatients.filter((patient) => !priorityWatchlistIds.has(patient.summary.user_id)),
    [filteredPatients, priorityWatchlistIds]
  );

  const requireClinician = useCallback(() => {
    const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
    if (!raw) {
      router.replace("/auth/signin");
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Account;
      if (parsed.role !== "clinician") {
        router.replace("/auth/signin");
        return null;
      }
      return parsed;
    } catch {
      router.replace("/auth/signin");
      return null;
    }
  }, [router]);

  const loadPatientLists = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const [mine, all] = await Promise.all([
        api.clinicianGetPatients(accountId),
        api.clinicianGetAllPatients(accountId),
      ]);
      setPatients(mine.items ?? []);
      setAllPatients(all.items ?? []);

      if (!selectedPatientId && (mine.items ?? []).length > 0) {
        setSelectedPatientId(mine.items[0].user_id);
      }

      const summaries = mine.items ?? [];
      if (summaries.length > 0) {
        const details = await Promise.all(
          summaries.map(async (patient) => {
            try {
              const detail = await api.clinicianGetPatientDetail(accountId, patient.user_id);
              return [patient.user_id, detail] as const;
            } catch {
              return null;
            }
          })
        );
        setPatientDetailMap(
          details.reduce<Record<string, ClinicianPatientDetail>>((acc, item) => {
            if (item) acc[item[0]] = item[1];
            return acc;
          }, {})
        );
      } else {
        setPatientDetailMap({});
      }
    } catch (err) {
      setError(safeMessage(err));
    } finally {
      setLoading(false);
    }
  }, [accountId, selectedPatientId]);

  const loadPatientDetail = useCallback(async (patientUserId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.clinicianGetPatientDetail(accountId, patientUserId);
      setDetail(data);
      setPatientDetailMap((prev) => ({ ...prev, [patientUserId]: data }));
      setSelectedPatientId(patientUserId);

      const saved = loadMeta(patientUserId);
      setMeta(saved);

      setProfileForm({
        name: data.patient.name ?? "",
        age: String(data.patient.age ?? ""),
        timezone: data.patient.timezone ?? "Asia/Singapore",
        language_preference: data.patient.language_preference ?? "English",
        sex: saved.sex,
        backgroundNotes: saved.backgroundNotes,
        caregiverContext: saved.caregiverContext,
      });

      setConditionsText((data.patient.conditions ?? []).join(", "));
    } catch (err) {
      setError(safeMessage(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const loadOutcomes = useCallback(async () => {
    if (!selectedPatientId) return;
    setSummaryLoading(true);
    setError(null);
    try {
      const data = await api.clinicianGetWeeklySummary(accountId, selectedPatientId);
      setWeeklySummary(data);
    } catch (err) {
      setError(safeMessage(err));
    } finally {
      setSummaryLoading(false);
    }
  }, [accountId, selectedPatientId]);

  useEffect(() => {
    const parsed = requireClinician();
    if (parsed) setAccount(parsed);
  }, [requireClinician]);

  useEffect(() => {
    if (account) void loadPatientLists();
  }, [account, loadPatientLists]);

  useEffect(() => {
    if (tab === "care-plan" && selectedPatientId) {
      void loadPatientDetail(selectedPatientId);
    }
  }, [tab, selectedPatientId, loadPatientDetail]);

  useEffect(() => {
    if (tab === "outcomes" && selectedPatientId && !weeklySummary && !summaryLoading) {
      void loadOutcomes();
    }
  }, [tab, selectedPatientId, weeklySummary, summaryLoading, loadOutcomes]);

  async function handleAssign(patientUserId: string) {
    try {
      await api.clinicianAssignPatient(accountId, patientUserId);
      setShowAssignPanel(false);
      await loadPatientLists();
    } catch (err) {
      setError(safeMessage(err));
    }
  }

  async function handleUnassign(patientUserId: string) {
    try {
      await api.clinicianUnassignPatient(accountId, patientUserId);
      if (selectedPatientId === patientUserId) {
        setSelectedPatientId(null);
        setDetail(null);
        setWeeklySummary(null);
      }
      await loadPatientLists();
    } catch (err) {
      setError(safeMessage(err));
    }
  }

  async function saveProfile() {
    if (!selectedPatientId) return false;
    const name = profileForm.name.trim();
    const ageNum = parseInt(profileForm.age, 10);
    if (!name || Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      setError("Please provide valid patient name and age (0-120).");
      return false;
    }

    setProfileSaving(true);
    setError(null);
    try {
      await api.updateUser(selectedPatientId, {
        name,
        age: ageNum,
        timezone: profileForm.timezone.trim() || "Asia/Singapore",
        language_preference: profileForm.language_preference.trim() || "English",
      });

      const nextMeta: CarePlanMeta = {
        ...meta,
        sex: profileForm.sex.trim(),
        backgroundNotes: profileForm.backgroundNotes.trim(),
        caregiverContext: profileForm.caregiverContext.trim(),
      };
      setMeta(nextMeta);
      saveMeta(selectedPatientId, nextMeta);

      await loadPatientDetail(selectedPatientId);
      await loadPatientLists();
      return true;
    } catch (err) {
      setError(safeMessage(err));
      return false;
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveConditions() {
    if (!selectedPatientId) return false;
    const parsed = conditionsText
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    setConditionsSaving(true);
    setError(null);
    try {
      await api.clinicianUpdateConditions(accountId, selectedPatientId, parsed);
      await loadPatientDetail(selectedPatientId);
      await loadPatientLists();
      return true;
    } catch (err) {
      setError(safeMessage(err));
      return false;
    } finally {
      setConditionsSaving(false);
    }
  }

  function resetMedForm() {
    setMedForm({
      medication_id: "",
      name: "",
      dose_text: "",
      frequency: "once_daily",
      times: "08:00",
      time_window_minutes: "120",
      criticality: "medium",
    });
  }

  function editMedication(med: MedicationItem) {
    setMedForm({
      medication_id: med.medication_id,
      name: med.name,
      dose_text: med.dose_text,
      frequency: med.schedule.frequency,
      times: (med.schedule.times ?? []).join(", "),
      time_window_minutes: String(med.time_window_minutes ?? 120),
      criticality: med.criticality ?? "medium",
    });
  }

  async function saveMedication() {
    if (!selectedPatientId) return;
    const name = medForm.name.trim();
    if (!name) {
      setError("Medication name is required.");
      return;
    }

    const payload = {
      name,
      dose_text: medForm.dose_text.trim(),
      schedule: {
        frequency: medForm.frequency,
        times: medForm.times.split(",").map((x) => x.trim()).filter(Boolean),
      },
      time_window_minutes: Number.isNaN(parseInt(medForm.time_window_minutes, 10))
        ? 120
        : parseInt(medForm.time_window_minutes, 10),
      criticality: medForm.criticality,
    };

    setMedSaving(true);
    setError(null);
    try {
      if (isEditingMed) {
        await api.clinicianUpdateMedication(accountId, selectedPatientId, medForm.medication_id, payload);
      } else {
        await api.clinicianAddMedication(accountId, selectedPatientId, payload);
      }
      resetMedForm();
      await loadPatientDetail(selectedPatientId);
    } catch (err) {
      setError(safeMessage(err));
    } finally {
      setMedSaving(false);
    }
  }

  async function removeMedication(medicationId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteMedication(accountId, selectedPatientId, medicationId);
      await loadPatientDetail(selectedPatientId);
    } catch (err) {
      setError(safeMessage(err));
    }
  }

  function resetApptForm() {
    setApptForm({ appointment_id: "", datetime: "", location: "", notes: "" });
  }

  function editAppointment(appt: AppointmentItem) {
    setApptForm({
      appointment_id: appt.appointment_id,
      datetime: appt.datetime.slice(0, 16),
      location: appt.location,
      notes: appt.notes,
    });
  }

  async function saveAppointment() {
    if (!selectedPatientId) return;
    if (!apptForm.datetime.trim()) {
      setError("Appointment date/time is required.");
      return;
    }

    const payload = {
      datetime: apptForm.datetime,
      location: apptForm.location.trim(),
      notes: apptForm.notes.trim(),
    };

    setApptSaving(true);
    setError(null);
    try {
      if (isEditingAppt) {
        await api.clinicianUpdateAppointment(accountId, selectedPatientId, apptForm.appointment_id, payload);
      } else {
        await api.clinicianAddAppointment(accountId, selectedPatientId, payload);
      }
      resetApptForm();
      await loadPatientDetail(selectedPatientId);
    } catch (err) {
      setError(safeMessage(err));
    } finally {
      setApptSaving(false);
    }
  }

  async function removeAppointment(appointmentId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteAppointment(accountId, selectedPatientId, appointmentId);
      await loadPatientDetail(selectedPatientId);
    } catch (err) {
      setError(safeMessage(err));
    }
  }

  function saveFollowUpMeta() {
    if (!selectedPatientId) return;
    saveMeta(selectedPatientId, meta);
  }

  function signOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  const desktopRiskCount = enrichedPatients.filter((patient) => patient.flagged).length;
  const desktopAverageAdherence = (() => {
    const values = enrichedPatients
      .map((patient) => patient.adherencePct)
      .filter((value): value is number => value !== null);
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  })();

  const desktopHeaderTitle =
    tab === "patients"
      ? "Patient Management"
      : tab === "care-plan"
        ? "Patient Care Plan"
        : tab === "outcomes"
          ? "Patient Analytics"
          : tab === "ai-insights"
            ? "AI Insights"
            : "Clinician Profile";

  const desktopHeaderSubtitle =
    tab === "care-plan" && selectedPatient
      ? selectedPatient.name
      : tab === "outcomes" && selectedPatient
        ? selectedPatient.name
        : undefined;

  const unassignedPatients = useMemo(() => {
    const search = patientSearch.trim().toLowerCase();
    return allPatients
      .filter((patient) => !patient.assigned_clinician_id)
      .filter((patient) => {
        if (!search) return true;
        return (
          patient.name.toLowerCase().includes(search) ||
          patient.conditions.some((condition) => condition.toLowerCase().includes(search))
        );
      });
  }, [allPatients, patientSearch]);

  if (!account) return null;

  return (
    <>
      <main className="hidden h-screen overflow-hidden bg-[#F6F8FC] text-slate-900 lg:flex">
        <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-slate-200 bg-white">
          <div className="p-6">
            <div className="mb-8 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#3670e2] text-white">
                <Stethoscope size={20} strokeWidth={2.1} />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">ByteCare</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Clinician Portal</p>
              </div>
            </div>

            <nav className="space-y-1">
              {navTabs.map((item) => {
                const isActive = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    style={{
                      width: "100%",
                      marginTop: 0,
                      background: isActive ? "#EEF4FF" : "transparent",
                      color: isActive ? "#3670E2" : "#475569",
                      border: "1px solid transparent",
                      boxShadow: "none",
                    }}
                    onClick={() => setTab(item.key as ClinicianTab)}
                    className={`mt-0 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${isActive
                      ? "hover:bg-[#E6EEFF]"
                      : "hover:bg-slate-50"
                      }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-auto border-t border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[#3670e2] text-xs font-bold text-white">
                {patientInitials(account.name || "Clinician")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{account.name}</p>
                <p className="truncate text-xs text-slate-500">{account.email}</p>
              </div>
              <button
                type="button"
                style={{ width: "auto", marginTop: 0, background: "transparent", padding: 0 }}
                onClick={signOut}
                className="text-slate-400 transition hover:text-rose-500"
                aria-label="Sign out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex h-[78px] items-center justify-between px-8">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">{desktopHeaderTitle}</h1>
                {desktopHeaderSubtitle ? (
                  <p className="text-xs font-medium text-slate-500">{desktopHeaderSubtitle}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {(tab === "care-plan" || tab === "outcomes" || tab === "ai-insights") && patients.length > 0 ? (
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    value={selectedPatientId ?? ""}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      if (!nextId) return;
                      setSelectedPatientId(nextId);
                      if (tab === "care-plan") {
                        void loadPatientDetail(nextId);
                      } else if (tab === "outcomes") {
                        setSummaryLoading(true);
                        setError(null);
                        setWeeklySummary(null);
                        void (async () => {
                          try {
                            const data = await api.clinicianGetWeeklySummary(accountId, nextId);
                            setWeeklySummary(data);
                          } catch (err) {
                            setError(safeMessage(err));
                          } finally {
                            setSummaryLoading(false);
                          }
                        })();
                      }
                    }}
                  >
                    {patients.map((patient) => (
                      <option key={patient.user_id} value={patient.user_id}>
                        {patient.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <button
                  type="button"
                  style={{ width: "auto", marginTop: 0 }}
                  onClick={() => {
                    if (tab === "outcomes") {
                      void loadOutcomes();
                      return;
                    }
                    void loadPatientLists();
                  }}
                  className="mt-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
                <button
                  type="button"
                  style={{ width: "auto", marginTop: 0 }}
                  onClick={() => setTab("profile")}
                  className="mt-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  aria-label="Open profile"
                >
                  <Bell size={17} />
                </button>
              </div>
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] space-y-6 p-8">
              {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

              {tab === "patients" ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-500">Total Patients</p>
                        <Users size={18} className="text-[#3670e2]" />
                      </div>
                      <p className="text-3xl font-bold text-slate-900">{patients.length}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Assigned to this clinician</p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-500">High Risk Cases</p>
                        <AlertTriangle size={18} className="text-rose-500" />
                      </div>
                      <p className="text-3xl font-bold text-slate-900">{desktopRiskCount}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Flagged by drift severity</p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-500">Average Adherence</p>
                        <TrendingUp size={18} className="text-amber-500" />
                      </div>
                      <p className="text-3xl font-bold text-slate-900">{desktopAverageAdherence}%</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Across assigned patients</p>
                    </article>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex h-10 min-w-[320px] flex-1 items-center rounded-lg border border-slate-200 bg-slate-50 px-3">
                        <Search size={16} className="shrink-0 text-slate-400" />
                        <input
                          className="m-0 ml-2 h-full w-full border-none bg-transparent p-0 text-sm leading-5 text-slate-700 placeholder:text-slate-400 outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
                          placeholder="Search by name or condition"
                          value={patientSearch}
                          onChange={(event) => setPatientSearch(event.target.value)}
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          style={{ width: "auto", marginTop: 0 }}
                          onClick={() => setShowAssignPanel((value) => !value)}
                          className="mt-0 inline-flex items-center gap-2 rounded-lg bg-[#3670e2] px-4 py-2 text-sm font-semibold text-white"
                        >
                          <Plus size={16} />
                          {showAssignPanel ? "Close Assign" : "Assign Patient"}
                        </button>
                        <button
                          type="button"
                          style={{ width: "auto", marginTop: 0 }}
                          className="mt-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
                        >
                          <Download size={16} />
                          Export
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { key: "all", label: "All Patients" },
                        { key: "high-risk", label: "High Risk" },
                        { key: "low-risk", label: "Low Risk" },
                        { key: "new", label: "Newly Added" },
                      ].map((item) => {
                        const isActive = patientFilter === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            style={{ width: "auto", marginTop: 0 }}
                            onClick={() => setPatientFilter(item.key as "all" | "high-risk" | "low-risk" | "new")}
                            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${isActive
                              ? "bg-[#3670e2] text-white"
                              : "border border-slate-200 bg-white text-slate-600"
                              }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {showAssignPanel ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">Unassigned Patients</h3>
                        <span className="text-xs font-medium text-slate-500">{unassignedPatients.length} available</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {unassignedPatients.map((patient) => (
                          <button
                            key={patient.user_id}
                            type="button"
                            style={{ marginTop: 0 }}
                            onClick={() => void handleAssign(patient.user_id)}
                            className="mt-0 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#3670e2]/40 hover:bg-[#EEF4FF]"
                          >
                            <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                            <p className="text-xs text-slate-500">Age {patient.age}</p>
                            <p className="mt-1 text-xs text-slate-500">{(patient.conditions ?? []).join(", ") || "No conditions"}</p>
                          </button>
                        ))}
                      </div>
                      {unassignedPatients.length === 0 ? (
                        <p className="text-sm text-slate-500">All available patients are already assigned.</p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Priority Watchlist</h3>
                      <span className="text-xs font-semibold text-[#3670e2]">{priorityWatchlist.length} flagged cases</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Patient</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Risk</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Conditions</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Adherence</th>
                            <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredPatients.map((patient) => (
                            <tr key={`desktop-${patient.summary.user_id}`} className="hover:bg-slate-50/70">
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br ${patientAvatarTone(patient.summary.user_id)} text-xs font-bold text-slate-800`}>
                                    {patientInitials(patient.summary.name)}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">{patient.summary.name}</p>
                                    <p className="text-xs text-slate-500">Age {patient.summary.age}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${patient.riskTone === "red"
                                  ? "bg-[#FFF1F1] text-[#EF5A5A]"
                                  : patient.riskTone === "amber"
                                    ? "bg-[#FFF8E8] text-[#C18421]"
                                    : "bg-[#ECFDF3] text-[#15803D]"
                                  }`}>
                                  {patient.riskLabel}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex flex-wrap gap-1">
                                  {(patient.summary.conditions ?? []).slice(0, 3).map((condition) => (
                                    <span key={`${patient.summary.user_id}-${condition}`} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                      {condition}
                                    </span>
                                  ))}
                                  {(patient.summary.conditions ?? []).length === 0 ? (
                                    <span className="text-xs text-slate-400">No conditions</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold ${patient.riskTone === "red" ? "text-red-500" : patient.riskTone === "amber" ? "text-amber-500" : "text-emerald-500"
                                    }`}>
                                    {patient.adherencePct ?? 0}%
                                  </span>
                                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className={`h-full rounded-full ${patient.riskTone === "red" ? "bg-red-500" : patient.riskTone === "amber" ? "bg-amber-500" : "bg-emerald-500"
                                        }`}
                                      style={{ width: `${Math.max(0, Math.min(100, patient.adherencePct ?? 0))}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    style={{ width: "auto", marginTop: 0 }}
                                    onClick={() => {
                                      setSelectedPatientId(patient.summary.user_id);
                                      setTab("care-plan");
                                    }}
                                    className="mt-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#3670e2]/40 hover:text-[#3670e2]"
                                  >
                                    View Care Plan
                                  </button>
                                  <button
                                    type="button"
                                    style={{ width: "auto", marginTop: 0 }}
                                    onClick={() => void handleUnassign(patient.summary.user_id)}
                                    className="mt-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600"
                                    aria-label={`Remove ${patient.summary.name}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!loading && filteredPatients.length === 0 ? (
                      <div className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
                        No patients match the current search or filter.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {tab === "care-plan" ? (
                <>
                  {!selectedPatientId ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                      Select a patient in Patients tab to set up their care plan.
                    </div>
                  ) : null}
                  {loading ? <p className="text-sm text-slate-500">Loading care plan...</p> : null}

                  {selectedPatientId && detail ? (
                    <div className="grid grid-cols-12 gap-6">
                      <div className="col-span-5 space-y-6">
                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex items-start gap-4">
                            <div className="relative">
                              <div className={`grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br ${patientAvatarTone(selectedPatientId)} text-xl font-bold text-slate-800`}>
                                {patientInitials(profileForm.name || selectedPatient?.name || detail.patient.name)}
                              </div>
                              <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-green-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <h2 className="truncate text-3xl font-bold tracking-tight text-slate-900">
                                  {profileForm.name || detail.patient.name}
                                </h2>
                                <button
                                  type="button"
                                  onClick={() => setIsProfileEditorOpen((value) => !value)}
                                  style={{ width: "auto", marginTop: 0, background: "transparent", padding: 0 }}
                                  className="mt-0 inline-flex items-center gap-1 text-sm font-semibold text-[#3670e2] hover:underline"
                                >
                                  <PencilLine size={14} />
                                  {isProfileEditorOpen ? "Hide Profile" : "Update Profile"}
                                </button>
                              </div>
                              <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                                <span className="inline-flex items-center gap-1"><Cake size={13} />{profileForm.age || detail.patient.age} years old</span>
                                <span className="inline-flex items-center gap-1"><Languages size={13} />{profileForm.language_preference || detail.patient.language_preference || "English"}</span>
                                <span className="inline-flex items-center gap-1"><MapPin size={13} />{profileForm.timezone || detail.patient.timezone || "Asia/Singapore"}</span>
                              </p>
                            </div>
                          </div>

                          {isProfileEditorOpen ? (
                            <div className="mt-4 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <label className="text-xs font-semibold text-slate-500">Name
                                  <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.name} onChange={(event) => setProfileForm((value) => ({ ...value, name: event.target.value }))} />
                                </label>
                                <label className="text-xs font-semibold text-slate-500">Age
                                  <input type="number" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.age} onChange={(event) => setProfileForm((value) => ({ ...value, age: event.target.value }))} />
                                </label>
                                <label className="text-xs font-semibold text-slate-500">Timezone
                                  <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.timezone} onChange={(event) => setProfileForm((value) => ({ ...value, timezone: event.target.value }))} />
                                </label>
                                <label className="text-xs font-semibold text-slate-500">Language
                                  <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.language_preference} onChange={(event) => setProfileForm((value) => ({ ...value, language_preference: event.target.value }))} />
                                </label>
                                <label className="col-span-2 text-xs font-semibold text-slate-500">Sex / Gender
                                  <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.sex} onChange={(event) => setProfileForm((value) => ({ ...value, sex: event.target.value }))} />
                                </label>
                                <label className="col-span-2 text-xs font-semibold text-slate-500">Background notes
                                  <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.backgroundNotes} onChange={(event) => setProfileForm((value) => ({ ...value, backgroundNotes: event.target.value }))} />
                                </label>
                                <label className="col-span-2 text-xs font-semibold text-slate-500">Caregiver / support context
                                  <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={profileForm.caregiverContext} onChange={(event) => setProfileForm((value) => ({ ...value, caregiverContext: event.target.value }))} />
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const didSave = await saveProfile();
                                    if (didSave) setIsProfileEditorOpen(false);
                                  }}
                                  disabled={profileSaving}
                                  className="mt-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3670e2] px-4 py-2.5 text-sm font-semibold text-white"
                                >
                                  <Save size={14} />
                                  {profileSaving ? "Saving..." : "Save Profile"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setIsProfileEditorOpen(false)}
                                  className="mt-0 inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </section>

                        <section className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-800">Medical Conditions</h3>
                            <button
                              type="button"
                              onClick={() => setIsConditionsEditorOpen((value) => !value)}
                              style={{ width: "auto", marginTop: 0, background: "transparent", padding: 0 }}
                              className="text-sm font-medium text-slate-500 transition hover:text-[#3670e2]"
                            >
                              {isConditionsEditorOpen ? "Hide Conditions" : "Edit Conditions"}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(detail.patient.conditions ?? []).length > 0 ? (
                              (detail.patient.conditions ?? []).map((condition) => (
                                <span key={condition} className="inline-flex items-center gap-2 rounded-lg border border-[#3670e2]/20 bg-[#3670e2]/10 px-3 py-1.5 text-sm font-medium text-[#3670e2]">
                                  <ShieldAlert size={14} />
                                  {condition}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-slate-500">No conditions recorded yet.</span>
                            )}
                          </div>
                          {isConditionsEditorOpen ? (
                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                              <textarea
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                value={conditionsText}
                                onChange={(event) => setConditionsText(event.target.value)}
                                placeholder="Add one or more conditions, comma separated."
                              />
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const didSave = await saveConditions();
                                    if (didSave) setIsConditionsEditorOpen(false);
                                  }}
                                  disabled={conditionsSaving}
                                  className="mt-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3670e2] px-4 py-2.5 text-sm font-semibold text-white"
                                >
                                  <Save size={14} />
                                  {conditionsSaving ? "Saving..." : "Save Conditions"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setIsConditionsEditorOpen(false)}
                                  className="mt-0 inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </section>
                      </div>

                      <div className="col-span-7 space-y-6">
                        <SummaryCard title="Medications" icon={<Pill size={16} className="text-[#3B6EF5]" />}>
                          <div className="grid grid-cols-3 gap-2">
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Medication name" value={medForm.name} onChange={(event) => setMedForm((value) => ({ ...value, name: event.target.value }))} />
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Dosage" value={medForm.dose_text} onChange={(event) => setMedForm((value) => ({ ...value, dose_text: event.target.value }))} />
                            <select className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={medForm.frequency} onChange={(event) => setMedForm((value) => ({ ...value, frequency: event.target.value }))}>
                              <option value="once_daily">Once daily</option>
                              <option value="twice_daily">Twice daily</option>
                              <option value="thrice_daily">Thrice daily</option>
                              <option value="as_needed">As needed</option>
                            </select>
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="08:00, 20:00" value={medForm.times} onChange={(event) => setMedForm((value) => ({ ...value, times: event.target.value }))} />
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Window mins" value={medForm.time_window_minutes} onChange={(event) => setMedForm((value) => ({ ...value, time_window_minutes: event.target.value }))} />
                            <select className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={medForm.criticality} onChange={(event) => setMedForm((value) => ({ ...value, criticality: event.target.value }))}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => void saveMedication()} disabled={medSaving} className="mt-0 flex-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                              {medSaving ? "Saving..." : isEditingMed ? "Update Medication" : "Add Medication"}
                            </button>
                            {isEditingMed ? (
                              <button type="button" onClick={resetMedForm} className="mt-0 flex-1 rounded-xl border border-[#D9E3F5] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
                                Cancel
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-3 space-y-2">
                            {detail.medications.map((medication) => (
                              <div key={medication.medication_id} className="rounded-xl border border-[#E9EEF7] bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="font-semibold text-[#1F2A37]">{medication.name}</p>
                                    <p className="text-xs text-[#667085]">{medication.dose_text} • {medication.schedule.frequency} • {(medication.schedule.times ?? []).join(", ")}</p>
                                  </div>
                                  <div className="flex gap-1">
                                    <button type="button" onClick={() => editMedication(medication)} className="mt-0 w-auto rounded-lg border border-[#D9E3F5] bg-white px-2 py-1 text-xs font-semibold text-[#344054]">Edit</button>
                                    <button type="button" onClick={() => void removeMedication(medication.medication_id)} className="mt-0 w-auto rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">Del</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </SummaryCard>

                        <div className="grid grid-cols-2 gap-6">
                          <SummaryCard title="Medication Schedule" icon={<CalendarClock size={16} className="text-[#3B6EF5]" />}>
                            {scheduleSummary.length === 0 ? (
                              <p className="text-sm text-[#667085]">No schedule defined yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {scheduleSummary.map((slot) => (
                                  <div key={slot.label} className="rounded-xl border border-[#E9EEF7] bg-white p-2">
                                    <p className="text-sm font-semibold text-[#1F2A37]">{slot.label}</p>
                                    <ul className="mt-1 list-disc pl-5 text-xs text-[#667085]">
                                      {slot.meds.map((med, idx) => (
                                        <li key={`${slot.label}-${idx}`}>{med}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            )}
                          </SummaryCard>

                          <SummaryCard title="Follow-up Meta" icon={<Activity size={16} className="text-[#3B6EF5]" />}>
                            <p className="text-xs font-semibold text-[#667085]">Review cadence</p>
                            <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={meta.reviewCadence} onChange={(event) => setMeta((value) => ({ ...value, reviewCadence: event.target.value }))} />
                            <p className="mt-2 text-xs font-semibold text-[#667085]">Follow-up status</p>
                            <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={meta.followUpStatus} onChange={(event) => setMeta((value) => ({ ...value, followUpStatus: event.target.value }))} />
                            <button type="button" onClick={saveFollowUpMeta} className="mt-2 w-full rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">Save Follow-up Meta</button>
                          </SummaryCard>
                        </div>

                        <SummaryCard title="Appointments / Follow-up" icon={<CalendarClock size={16} className="text-[#3B6EF5]" />}>
                          <div className="grid grid-cols-3 gap-2">
                            <input type="datetime-local" className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={apptForm.datetime} onChange={(event) => setApptForm((value) => ({ ...value, datetime: event.target.value }))} />
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Location" value={apptForm.location} onChange={(event) => setApptForm((value) => ({ ...value, location: event.target.value }))} />
                            <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Follow-up reason / notes" value={apptForm.notes} onChange={(event) => setApptForm((value) => ({ ...value, notes: event.target.value }))} />
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => void saveAppointment()} disabled={apptSaving} className="mt-0 flex-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                              {apptSaving ? "Saving..." : isEditingAppt ? "Update Follow-up" : "Add Follow-up"}
                            </button>
                            {isEditingAppt ? (
                              <button type="button" onClick={resetApptForm} className="mt-0 flex-1 rounded-xl border border-[#D9E3F5] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
                                Cancel
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-3 space-y-2">
                            {detail.appointments.map((appointment) => (
                              <div key={appointment.appointment_id} className="rounded-xl border border-[#E9EEF7] bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-[#1F2A37]">{new Date(appointment.datetime).toLocaleString()}</p>
                                    <p className="text-xs text-[#667085]">{appointment.location}{appointment.notes ? ` • ${appointment.notes}` : ""}</p>
                                  </div>
                                  <div className="flex gap-1">
                                    <button type="button" onClick={() => editAppointment(appointment)} className="mt-0 w-auto rounded-lg border border-[#D9E3F5] bg-white px-2 py-1 text-xs font-semibold text-[#344054]">Edit</button>
                                    <button type="button" onClick={() => void removeAppointment(appointment.appointment_id)} className="mt-0 w-auto rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">Del</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </SummaryCard>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {tab === "outcomes" ? (
                <>
                  {!selectedPatientId ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                      Select a patient in Patients tab to review outcomes.
                    </div>
                  ) : null}
                  {summaryLoading ? <p className="text-sm text-slate-500">Loading weekly summary...</p> : null}
                  {selectedPatientId && weeklySummary ? (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current adherence</p>
                          <p className="mt-2 text-3xl font-bold text-slate-900">{weeklySummary.adherence.current_score}%</p>
                        </article>
                        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Prior period</p>
                          <p className="mt-2 text-3xl font-bold text-slate-900">{weeklySummary.adherence.prior_score}%</p>
                        </article>
                        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Delta</p>
                          <p className={`mt-2 text-3xl font-bold ${weeklySummary.adherence.delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {weeklySummary.adherence.delta >= 0 ? `+${weeklySummary.adherence.delta}` : weeklySummary.adherence.delta}%
                          </p>
                        </article>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <SummaryCard title="Weekly Summary" icon={<FileText size={16} className="text-[#3B6EF5]" />}>
                          <div className="flex items-center justify-between">
                            <p className="text-base font-semibold text-[#1F2A37]">{weeklySummary.patient_name}</p>
                            <BadgePill
                              label={weeklySummary.overall_status}
                              tone={weeklySummary.overall_status === "On track" ? "success" : weeklySummary.overall_status === "Needs attention" ? "yellow" : "red"}
                            />
                          </div>
                          <ul className="mt-2 list-disc pl-5 text-sm text-[#475467]">
                            {weeklySummary.summary_bullets.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </SummaryCard>

                        <SummaryCard title="Drift Detection" icon={<ShieldAlert size={16} className="text-[#3B6EF5]" />}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-[#475467]">{weeklySummary.drift.trigger || "No trigger"}</p>
                            <BadgePill
                              label={weeklySummary.drift.severity.toUpperCase()}
                              tone={weeklySummary.drift.severity === "red" ? "red" : weeklySummary.drift.severity === "orange" ? "yellow" : "blue"}
                            />
                          </div>
                          <p className="mt-1 text-xs text-[#667085]">
                            {weeklySummary.drift.details?.missed_doses ?? 0} missed • {weeklySummary.drift.details?.late_doses ?? 0} late • Avg MES {weeklySummary.drift.details?.avg_mes ?? 0}
                          </p>
                        </SummaryCard>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <SummaryCard title="Intervention History" icon={<Activity size={16} className="text-[#3B6EF5]" />}>
                          {weeklySummary.interventions.length === 0 ? (
                            <p className="text-sm text-[#667085]">No interventions in this period.</p>
                          ) : (
                            <div className="space-y-2">
                              {weeklySummary.interventions.slice(0, 6).map((intervention) => (
                                <div key={intervention.intervention_id} className="rounded-xl border border-[#E9EEF7] bg-white p-3">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-[#1F2A37]">{intervention.action_type.replace(/_/g, " ")}</p>
                                    <BadgePill label={intervention.risk_level} tone={intervention.risk_level === "HIGH" ? "red" : intervention.risk_level === "MEDIUM" ? "yellow" : "success"} />
                                  </div>
                                  <p className="mt-1 text-xs text-[#667085]">{intervention.message}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </SummaryCard>

                        <SummaryCard title="Lifestyle Summary" icon={<ClipboardList size={16} className="text-[#3B6EF5]" />}>
                          <p className="text-sm text-[#475467]">{weeklySummary.food_summary}</p>
                          <p className="mt-2 text-sm text-[#475467]">Joined {weeklySummary.community_joined_count} community activities this week.</p>
                          {weeklySummary.food_recommendations.length > 0 ? (
                            <ul className="mt-2 list-disc pl-5 text-sm text-[#667085]">
                              {weeklySummary.food_recommendations.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          ) : null}
                        </SummaryCard>
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}

              {tab === "ai-insights" ? (
                <>
                  {!selectedPatientId ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                      Select a patient in Patients tab to generate AI insights.
                    </div>
                  ) : (
                    <div className="grid grid-cols-12 gap-6">
                      <div className="col-span-4">
                        <SummaryCard title="AI Clinical Insights" icon={<Sparkles size={16} className="text-[#3B6EF5]" />}>
                          <p className="text-xs text-[#667085]">
                            Generates a clinician-facing summary and recommendations using patient trend data.
                          </p>
                          <button
                            type="button"
                            disabled={aiLoading}
                            onClick={async () => {
                              if (!selectedPatientId) return;
                              setAiLoading(true);
                              setAiError(null);
                              setAiSummary(null);
                              try {
                                const result = await api.clinicianGetAISummary(accountId, selectedPatientId);
                                setAiSummary(result);
                              } catch (err) {
                                setAiError(safeMessage(err));
                              } finally {
                                setAiLoading(false);
                              }
                            }}
                            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3670e2] to-[#6366F1] px-4 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60"
                          >
                            {aiLoading ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Sparkles size={14} />
                                {aiSummary ? "Regenerate Insights" : "Generate AI Insights"}
                              </>
                            )}
                          </button>
                        </SummaryCard>
                      </div>
                      <div className="col-span-8">
                        {aiError ? (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                            <p className="text-sm font-semibold text-red-700">Failed to generate insights</p>
                            <p className="mt-1 text-xs text-red-600">{aiError}</p>
                          </div>
                        ) : null}
                        {aiLoading ? (
                          <div className="space-y-3">
                            {[1, 2, 3].map((index) => (
                              <div key={index} className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                                <div className="mb-3 h-4 w-1/3 rounded bg-slate-200" />
                                <div className="space-y-2">
                                  <div className="h-3 w-full rounded bg-slate-100" />
                                  <div className="h-3 w-5/6 rounded bg-slate-100" />
                                  <div className="h-3 w-4/6 rounded bg-slate-100" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {aiSummary && !aiLoading ? (
                          <div className="rounded-xl border border-[#3670e2]/20 bg-gradient-to-br from-[#EEF2FF] to-white p-5 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <BrainCircuit size={18} className="text-[#3670e2]" />
                                <h3 className="text-base font-bold text-[#1F2A37]">AI Summary — {aiSummary.patient_name}</h3>
                              </div>
                              <span className="rounded-full bg-[#3670e2]/10 px-2.5 py-0.5 text-[10px] font-semibold text-[#3670e2]">
                                {aiSummary.provider.toUpperCase()}
                              </span>
                            </div>
                            <div className="space-y-2 text-sm leading-relaxed text-[#475467]">
                              {aiSummary.summary.split("\n").map((line, index) => {
                                const trimmed = line.trim().replace(/\*\*/g, "");
                                if (!trimmed) return null;
                                return <p key={index}>{trimmed}</p>;
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              {tab === "profile" ? (
                <div className="grid max-w-xl grid-cols-1 gap-4">
                  <SummaryCard title="Clinician Account" icon={<UserRound size={16} className="text-[#3B6EF5]" />}>
                    <p className="text-base font-semibold text-[#1F2A37]">{account.name}</p>
                    <p className="text-sm text-[#667085]">{account.email}</p>
                    <p className="text-xs text-[#98A2B3]">Role: Clinician</p>
                    <button type="button" onClick={signOut} className="mt-4 w-full rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                      Sign Out
                    </button>
                  </SummaryCard>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>

      <main className="flex min-h-screen justify-center bg-white lg:hidden">
        <div ref={shellRef} className="relative min-h-screen w-full max-w-md bg-[#F8FAFC] pb-24">
          {tab === "patients" ? (
            <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white/90 px-4 pb-2 pt-6 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#3670e2]/10 text-[#3670e2]">
                    <Stethoscope size={18} strokeWidth={2.1} />
                  </div>
                  <h1 className="text-[1.75rem] font-bold tracking-[-0.03em] text-[#1F2A37]">Patients</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => void loadPatientLists()}
                    aria-label="Refresh patients"
                  >
                    <Bell size={18} />
                  </button>
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => setTab("profile")}
                    aria-label="Open profile settings"
                  >
                    <Settings size={18} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex h-11 w-full items-center gap-3 rounded-xl bg-slate-100 px-4">
                  <Search size={16} className="shrink-0 text-slate-400" />
                  <input
                    className="relative -top-px m-0 w-full border-none bg-transparent p-0 text-sm leading-5 text-slate-700 placeholder:text-slate-400 outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
                    placeholder="Search by name or condition"
                    value={patientSearch}
                    onChange={(event) => setPatientSearch(event.target.value)}
                  />
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[
                    { key: "all", label: "All Patients" },
                    { key: "high-risk", label: "High Risk" },
                    { key: "low-risk", label: "Low Risk" },
                    { key: "new", label: "Newly Added" },
                  ].map((item) => {
                    const isActive = patientFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        style={{ width: "auto", marginTop: 0 }}
                        onClick={() => setPatientFilter(item.key as "all" | "high-risk" | "low-risk" | "new")}
                        className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition ${isActive
                          ? "bg-[#3670e2] text-white"
                          : "border border-slate-200 bg-white text-slate-600"
                          }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </header>
          ) : tab === "care-plan" ? (
            <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white px-4 py-3">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setTab("patients")}
                  style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                  className="rounded-full text-[#667085] transition hover:bg-slate-100"
                  aria-label="Back to patients"
                >
                  <ArrowLeft size={18} />
                </button>
                <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-[#1F2A37]">
                  {selectedPatient ? `${selectedPatient.name}'s Care Plan` : "Care Plan"}
                </h1>
              </div>
            </header>
          ) : tab === "outcomes" ? (
            <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white/90 px-4 pb-2 pt-6 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#3670e2]/10 text-[#3670e2]">
                    <FileText size={18} strokeWidth={2.1} />
                  </div>
                  <h1 className="text-[1.75rem] font-bold tracking-[-0.03em] text-[#1F2A37]">Outcomes</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => void loadOutcomes()}
                    aria-label="Refresh outcomes"
                  >
                    <Bell size={18} />
                  </button>
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => setTab("profile")}
                    aria-label="Open profile settings"
                  >
                    <Settings size={18} />
                  </button>
                </div>
              </div>
            </header>
          ) : tab === "ai-insights" ? (
            <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white/90 px-4 pb-2 pt-6 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#3670e2]/10 text-[#3670e2]">
                    <BrainCircuit size={18} strokeWidth={2.1} />
                  </div>
                  <h1 className="text-[1.75rem] font-bold tracking-[-0.03em] text-[#1F2A37]">AI Insights</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => setTab("profile")}
                    aria-label="Open profile"
                  >
                    <Bell size={18} />
                  </button>
                </div>
              </div>
            </header>
          ) : tab === "profile" ? (
            <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white/90 px-4 pb-2 pt-6 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#3670e2]/10 text-[#3670e2]">
                    <UserRound size={18} strokeWidth={2.1} />
                  </div>
                  <h1 className="text-[1.75rem] font-bold tracking-[-0.03em] text-[#1F2A37]">Profile</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    style={{ width: "auto", marginTop: 0, background: "transparent", padding: "0.5rem" }}
                    className="rounded-full text-[#667085] transition hover:bg-slate-100"
                    onClick={() => setTab("patients")}
                    aria-label="Back to patients"
                  >
                    <Bell size={18} />
                  </button>
                </div>
              </div>
            </header>
          ) : (
            <Header
              title="ByteCare - Clinician"
              left={
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#C9D9FF] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
                  <ClipboardList size={19} className="text-[#3B6EF5]" />
                </div>
              }
              right={
                <button type="button" className="relative grid h-11 w-11 place-items-center rounded-full bg-[#3B6EF5] text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]">
                  <Bell size={19} />
                  <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-white bg-[#EF5A5A]" />
                </button>
              }
            />
          )}

          <section className="space-y-4 px-3 pb-8 pt-4">
            {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            {tab === "patients" ? (
              <>
                {loading ? <p className="text-sm text-[#667085]">Loading patients...</p> : null}

                {patientFilter !== "low-risk" && patientFilter !== "new" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Priority Watchlist</h2>
                      <span className="text-xs font-medium text-[#3670e2]">{priorityWatchlist.length} flagged cases</span>
                    </div>

                    {priorityWatchlist.length === 0 && !loading && patients.length > 0 ? (
                      <div className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-[#667085] shadow-sm">
                        No flagged patients match the current view.
                      </div>
                    ) : null}

                    <div className="space-y-4">
                      {priorityWatchlist.map((patient) => (
                        <article key={`watch-${patient.summary.user_id}`} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex gap-3">
                              <div className="relative">
                                <div className={`grid h-12 w-12 place-items-center rounded-full border-2 border-slate-50 bg-gradient-to-br ${patientAvatarTone(patient.summary.user_id)} text-sm font-bold text-[#1F2A37]`}>
                                  {patientInitials(patient.summary.name)}
                                </div>
                                <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${patient.riskTone === "red" ? "bg-red-500" : patient.riskTone === "amber" ? "bg-amber-500" : "bg-emerald-500"
                                  }`} />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold leading-none text-[#1F2A37]">{patient.summary.name}</h3>
                                <p className="mt-1 text-xs text-slate-500">Age {patient.summary.age}</p>
                              </div>
                            </div>
                            <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${patient.riskTone === "red"
                              ? "bg-red-100 text-red-600"
                              : patient.riskTone === "amber"
                                ? "bg-amber-100 text-amber-600"
                                : "bg-emerald-100 text-emerald-600"
                              }`}>
                              {patient.riskLabel}
                            </span>
                          </div>

                          <div className="mb-4">
                            <p className="mb-1 text-xs font-medium text-slate-700">Diagnoses</p>
                            <div className="flex flex-wrap gap-1">
                              {patient.summary.conditions.length > 0 ? patient.summary.conditions.map((condition) => (
                                <span key={`${patient.summary.user_id}-${condition}`} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                  {condition}
                                </span>
                              )) : (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">No diagnoses recorded</span>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 border-t border-slate-50 py-3">
                            <div className="text-center">
                              <p className="text-[10px] font-semibold uppercase text-slate-400">Adherence</p>
                              <p className={`text-sm font-bold ${patient.riskTone === "red" ? "text-red-500" : patient.riskTone === "amber" ? "text-amber-500" : "text-emerald-500"
                                }`}>{patient.adherencePct ?? 0}%</p>
                            </div>
                            <div className="border-x border-slate-50 text-center">
                              <p className="text-[10px] font-semibold uppercase text-slate-400">Medications</p>
                              <p className="text-sm font-bold text-[#1F2A37]">{patient.summary.medication_count} meds</p>
                            </div>
                            <div className="text-center">
                              <p className="text-[10px] font-semibold uppercase text-slate-400">Follow-up</p>
                              <p className="text-sm font-bold text-[#1F2A37]">{patient.summary.appointment_count} appt</p>
                            </div>
                          </div>

                          <div className="mt-2 flex items-stretch gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPatientId(patient.summary.user_id);
                                setTab("care-plan");
                              }}
                              className={`mt-0 flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold ${patient.riskTone === "red"
                                ? "bg-[#3670e2] text-white"
                                : "bg-slate-100 text-slate-700"
                                }`}
                            >
                              View Care Plan
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleUnassign(patient.summary.user_id)}
                              className="mt-0 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600"
                              aria-label={`Remove ${patient.summary.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : null}

                {showAssignPanel ? (
                  <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <SectionTitle title="Assign Patient" />
                      <button
                        type="button"
                        onClick={() => setShowAssignPanel(false)}
                        className="mt-0 w-auto bg-transparent px-0 py-0 text-xs font-semibold text-slate-500"
                      >
                        Close
                      </button>
                    </div>
                    <div className="space-y-2">
                      {allPatients
                        .filter((p) => !p.assigned_clinician_id)
                        .filter((p) => {
                          const search = patientSearch.trim().toLowerCase();
                          if (!search) return true;
                          return p.name.toLowerCase().includes(search) || p.conditions.some((c) => c.toLowerCase().includes(search));
                        })
                        .map((p) => (
                          <button
                            key={p.user_id}
                            type="button"
                            onClick={() => void handleAssign(p.user_id)}
                            className="mt-0 flex w-full items-center justify-between rounded-xl border border-[#E9EEF7] bg-slate-50 px-3 py-2 text-left"
                          >
                            <div>
                              <p className="font-semibold text-[#1F2A37]">{p.name}</p>
                              <p className="text-xs text-[#667085]">Age {p.age} • {(p.conditions ?? []).join(", ") || "No conditions"}</p>
                            </div>
                            <BadgePill label="Assign" tone="blue" />
                          </button>
                        ))}
                      {allPatients.filter((p) => !p.assigned_clinician_id).length === 0 ? (
                        <p className="text-sm text-[#667085]">All available patients are already assigned.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {remainingPatients.map((patient) => (
                    <article key={patient.summary.user_id} className={`rounded-xl border border-slate-100 bg-white p-4 shadow-sm ${patient.flagged ? "" : "opacity-90"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-3">
                          <div className={`grid h-12 w-12 place-items-center rounded-full border-2 border-slate-50 bg-gradient-to-br ${patientAvatarTone(patient.summary.user_id)} text-sm font-bold text-[#1F2A37]`}>
                            {patientInitials(patient.summary.name)}
                          </div>
                          <div>
                            <h3 className="text-lg font-bold leading-none text-[#1F2A37]">{patient.summary.name}</h3>
                            <p className="mt-1 text-xs text-slate-500">Age {patient.summary.age}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${patient.riskTone === "red"
                          ? "bg-red-100 text-red-600"
                          : patient.riskTone === "amber"
                            ? "bg-amber-100 text-amber-600"
                            : "bg-emerald-100 text-emerald-600"
                          }`}>
                          {patient.riskLabel}
                        </span>
                      </div>

                      {patient.summary.conditions.length > 0 ? (
                        <div className="mb-4 mt-3">
                          <p className="mb-1 text-xs font-medium text-slate-700">Diagnoses</p>
                          <div className="flex flex-wrap gap-1">
                            {patient.summary.conditions.map((condition) => (
                              <span key={`${patient.summary.user_id}-${condition}`} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                {condition}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="grid grid-cols-3 gap-2 border-t border-slate-50 py-3">
                        <div className="text-center">
                          <p className="text-[10px] font-semibold uppercase text-slate-400">Adherence</p>
                          <p className={`text-sm font-bold ${patient.riskTone === "red" ? "text-red-500" : patient.riskTone === "amber" ? "text-amber-500" : "text-emerald-500"
                            }`}>{patient.adherencePct ?? 0}%</p>
                        </div>
                        <div className="border-x border-slate-50 text-center">
                          <p className="text-[10px] font-semibold uppercase text-slate-400">Medications</p>
                          <p className="text-sm font-bold text-[#1F2A37]">{patient.summary.medication_count} meds</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-semibold uppercase text-slate-400">Follow-up</p>
                          <p className="text-sm font-bold text-[#1F2A37]">{patient.summary.appointment_count} appt</p>
                        </div>
                      </div>

                      <div className="mt-2 flex items-stretch gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatientId(patient.summary.user_id);
                            setTab("care-plan");
                          }}
                          className={`mt-0 flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold ${patient.riskTone === "red"
                            ? "bg-[#3670e2] text-white"
                            : "bg-slate-100 text-slate-700"
                            }`}
                        >
                          View Care Plan
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUnassign(patient.summary.user_id)}
                          className="mt-0 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600"
                          aria-label={`Remove ${patient.summary.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}

                  {!loading && remainingPatients.length === 0 ? (
                    <div className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-[#667085] shadow-sm">
                      {patients.length === 0
                        ? "No assigned patients yet. Use the add button to start a care plan."
                        : filteredPatients.length > 0
                          ? "All matching patients are already shown in the priority watchlist."
                          : "No patients match the current search or filter."}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {tab === "care-plan" ? (
              <>
                {!selectedPatientId ? (
                  <ChartCard>
                    <p className="text-sm text-[#667085]">Select a patient in Patients tab to set up their care plan.</p>
                  </ChartCard>
                ) : null}

                {loading ? <p className="text-sm text-[#667085]">Loading care plan...</p> : null}

                {selectedPatientId && detail ? (
                  <>
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        <div className="relative">
                          <div className={`grid h-24 w-24 place-items-center rounded-full border-2 border-white bg-gradient-to-br shadow-sm ${patientAvatarTone(selectedPatientId)} text-xl font-bold text-[#1F2A37]`}>
                            {patientInitials(profileForm.name || selectedPatient?.name || detail.patient.name)}
                          </div>
                          <span className="absolute bottom-1 right-1 h-5 w-5 rounded-full border-2 border-white bg-green-500" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <h2 className="text-[1.55rem] font-bold tracking-tight text-slate-900">{profileForm.name || detail.patient.name}</h2>
                            <button
                              type="button"
                              onClick={() => setIsProfileEditorOpen((value) => !value)}
                              className="mt-0 inline-flex w-auto items-center gap-1 bg-transparent px-0 py-0 text-sm font-semibold text-[#3670e2] hover:underline"
                            >
                              <PencilLine size={14} />
                              {isProfileEditorOpen ? "Hide Profile" : "Update Profile"}
                            </button>
                          </div>
                          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Cake size={12} className="text-slate-400" />
                              {profileForm.age || detail.patient.age} years old
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Languages size={12} className="text-slate-400" />
                              {profileForm.language_preference || detail.patient.language_preference || "English"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={12} className="text-slate-400" />
                              {profileForm.timezone || detail.patient.timezone || "Asia/Singapore"}
                            </span>
                          </p>
                        </div>
                      </div>

                      {isProfileEditorOpen ? (
                        <div className="mt-4 space-y-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-[#667085]">Name
                              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} />
                            </label>
                            <label className="text-xs font-semibold text-[#667085]">Age
                              <input type="number" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.age} onChange={(e) => setProfileForm((p) => ({ ...p, age: e.target.value }))} />
                            </label>
                            <label className="text-xs font-semibold text-[#667085]">Timezone
                              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.timezone} onChange={(e) => setProfileForm((p) => ({ ...p, timezone: e.target.value }))} />
                            </label>
                            <label className="text-xs font-semibold text-[#667085]">Language
                              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.language_preference} onChange={(e) => setProfileForm((p) => ({ ...p, language_preference: e.target.value }))} />
                            </label>
                            <label className="sm:col-span-2 text-xs font-semibold text-[#667085]">Sex / Gender
                              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.sex} onChange={(e) => setProfileForm((p) => ({ ...p, sex: e.target.value }))} />
                            </label>
                            <label className="sm:col-span-2 text-xs font-semibold text-[#667085]">Background notes
                              <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.backgroundNotes} onChange={(e) => setProfileForm((p) => ({ ...p, backgroundNotes: e.target.value }))} />
                            </label>
                            <label className="sm:col-span-2 text-xs font-semibold text-[#667085]">Caregiver / support context
                              <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" value={profileForm.caregiverContext} onChange={(e) => setProfileForm((p) => ({ ...p, caregiverContext: e.target.value }))} />
                            </label>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const didSave = await saveProfile();
                                if (didSave) setIsProfileEditorOpen(false);
                              }}
                              disabled={profileSaving}
                              className="mt-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3670e2] px-4 py-3 text-sm font-semibold text-white"
                            >
                              <Save size={14} />
                              {profileSaving ? "Saving..." : "Save Profile"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsProfileEditorOpen(false)}
                              className="mt-0 inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <section className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-[16px] font-semibold text-slate-800">Medical Conditions</h3>
                        <button
                          type="button"
                          onClick={() => setIsConditionsEditorOpen((value) => !value)}
                          className="mt-0 w-auto bg-transparent px-0 py-0 text-sm font-medium text-slate-500 transition-colors hover:text-[#3670e2]"
                        >
                          {isConditionsEditorOpen ? "Hide Conditions" : "Edit Conditions"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(detail.patient.conditions ?? []).length > 0 ? (
                          (detail.patient.conditions ?? []).map((condition) => (
                            <span key={condition} className="inline-flex items-center gap-2 rounded-lg border border-[#3670e2]/20 bg-[#3670e2]/10 px-3 py-1.5 text-sm font-medium text-[#3670e2]">
                              <ShieldAlert size={14} />
                              {condition}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">No conditions recorded yet.</span>
                        )}
                      </div>
                      {isConditionsEditorOpen ? (
                        <div className="space-y-3">
                          <textarea
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
                            value={conditionsText}
                            onChange={(e) => setConditionsText(e.target.value)}
                            placeholder="Add one or more conditions, comma separated."
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const didSave = await saveConditions();
                                if (didSave) setIsConditionsEditorOpen(false);
                              }}
                              disabled={conditionsSaving}
                              className="mt-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3670e2] px-4 py-3 text-sm font-semibold text-white"
                            >
                              <Save size={14} />
                              {conditionsSaving ? "Saving..." : "Save Conditions"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsConditionsEditorOpen(false)}
                              className="mt-0 inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <SummaryCard title="Medications" icon={<Pill size={16} className="text-[#3B6EF5]" />}>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Medication name" value={medForm.name} onChange={(e) => setMedForm((f) => ({ ...f, name: e.target.value }))} />
                        <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Dosage" value={medForm.dose_text} onChange={(e) => setMedForm((f) => ({ ...f, dose_text: e.target.value }))} />
                        <select className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={medForm.frequency} onChange={(e) => setMedForm((f) => ({ ...f, frequency: e.target.value }))}>
                          <option value="once_daily">Once daily</option>
                          <option value="twice_daily">Twice daily</option>
                          <option value="thrice_daily">Thrice daily</option>
                          <option value="as_needed">As needed</option>
                        </select>
                        <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="08:00, 20:00" value={medForm.times} onChange={(e) => setMedForm((f) => ({ ...f, times: e.target.value }))} />
                        <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Window mins" value={medForm.time_window_minutes} onChange={(e) => setMedForm((f) => ({ ...f, time_window_minutes: e.target.value }))} />
                        <select className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={medForm.criticality} onChange={(e) => setMedForm((f) => ({ ...f, criticality: e.target.value }))}>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>

                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void saveMedication()} disabled={medSaving} className="mt-0 flex-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                          {medSaving ? "Saving..." : isEditingMed ? "Update Medication" : "Add Medication"}
                        </button>
                        {isEditingMed ? (
                          <button type="button" onClick={resetMedForm} className="mt-0 flex-1 rounded-xl border border-[#D9E3F5] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
                            Cancel
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-2">
                        {detail.medications.map((med) => (
                          <div key={med.medication_id} className="rounded-xl border border-[#E9EEF7] bg-white p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-[#1F2A37]">{med.name}</p>
                                <p className="text-xs text-[#667085]">{med.dose_text} • {med.schedule.frequency} • {(med.schedule.times ?? []).join(", ")}</p>
                              </div>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => editMedication(med)} className="mt-0 w-auto rounded-lg border border-[#D9E3F5] bg-white px-2 py-1 text-xs font-semibold text-[#344054]">Edit</button>
                                <button type="button" onClick={() => void removeMedication(med.medication_id)} className="mt-0 w-auto rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">Del</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </SummaryCard>

                    <SummaryCard title="Medication Schedule" icon={<CalendarClock size={16} className="text-[#3B6EF5]" />}>
                      {scheduleSummary.length === 0 ? (
                        <p className="text-sm text-[#667085]">No schedule defined yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {scheduleSummary.map((slot) => (
                            <div key={slot.label} className="rounded-xl border border-[#E9EEF7] bg-white p-2">
                              <p className="text-sm font-semibold text-[#1F2A37]">{slot.label}</p>
                              <ul className="mt-1 list-disc pl-5 text-xs text-[#667085]">
                                {slot.meds.map((med, idx) => (
                                  <li key={`${slot.label}-${idx}`}>{med}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </SummaryCard>

                    <SummaryCard title="Appointments / Follow-up" icon={<CalendarClock size={16} className="text-[#3B6EF5]" />}>
                      <div className="grid grid-cols-1 gap-2">
                        <input type="datetime-local" className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={apptForm.datetime} onChange={(e) => setApptForm((f) => ({ ...f, datetime: e.target.value }))} />
                        <input className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Location" value={apptForm.location} onChange={(e) => setApptForm((f) => ({ ...f, location: e.target.value }))} />
                        <textarea className="rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" placeholder="Follow-up reason / notes" value={apptForm.notes} onChange={(e) => setApptForm((f) => ({ ...f, notes: e.target.value }))} />
                      </div>

                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void saveAppointment()} disabled={apptSaving} className="mt-0 flex-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                          {apptSaving ? "Saving..." : isEditingAppt ? "Update Follow-up" : "Add Follow-up"}
                        </button>
                        {isEditingAppt ? (
                          <button type="button" onClick={resetApptForm} className="mt-0 flex-1 rounded-xl border border-[#D9E3F5] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
                            Cancel
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-2">
                        {detail.appointments.map((appt) => (
                          <div key={appt.appointment_id} className="rounded-xl border border-[#E9EEF7] bg-white p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-[#1F2A37]">{new Date(appt.datetime).toLocaleString()}</p>
                                <p className="text-xs text-[#667085]">{appt.location}{appt.notes ? ` • ${appt.notes}` : ""}</p>
                              </div>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => editAppointment(appt)} className="mt-0 w-auto rounded-lg border border-[#D9E3F5] bg-white px-2 py-1 text-xs font-semibold text-[#344054]">Edit</button>
                                <button type="button" onClick={() => void removeAppointment(appt.appointment_id)} className="mt-0 w-auto rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">Del</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 rounded-xl border border-[#E9EEF7] bg-white p-2">
                        <p className="text-xs font-semibold text-[#667085]">Review cadence</p>
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={meta.reviewCadence} onChange={(e) => setMeta((m) => ({ ...m, reviewCadence: e.target.value }))} />
                        <p className="mt-2 text-xs font-semibold text-[#667085]">Follow-up status</p>
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={meta.followUpStatus} onChange={(e) => setMeta((m) => ({ ...m, followUpStatus: e.target.value }))} />
                        <button type="button" onClick={saveFollowUpMeta} className="mt-2 w-full rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">Save Follow-up Meta</button>
                      </div>
                    </SummaryCard>
                  </>
                ) : null}
              </>
            ) : null}

            {tab === "outcomes" ? (
              <>
                {!selectedPatientId ? (
                  <ChartCard>
                    <p className="text-sm text-[#667085]">Select a patient in Patients tab to review outcomes.</p>
                  </ChartCard>
                ) : null}

                {summaryLoading ? <p className="text-sm text-[#667085]">Loading weekly summary...</p> : null}

                {selectedPatientId && weeklySummary ? (
                  <>
                    <SummaryCard title="Weekly Summary" icon={<FileText size={16} className="text-[#3B6EF5]" />}>
                      <div className="flex items-center justify-between">
                        <p className="text-lg font-semibold text-[#1F2A37]">{weeklySummary.patient_name}</p>
                        <BadgePill
                          label={weeklySummary.overall_status}
                          tone={weeklySummary.overall_status === "On track" ? "success" : weeklySummary.overall_status === "Needs attention" ? "yellow" : "red"}
                        />
                      </div>
                      <ul className="mt-2 list-disc pl-5 text-sm text-[#475467]">
                        {weeklySummary.summary_bullets.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </SummaryCard>

                    <ChartCard>
                      <SectionTitle title="Adherence Trends" />
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-[#E9EEF7] bg-white p-2 text-center">
                          <p className="text-xs text-[#667085]">Current</p>
                          <p className="text-2xl font-bold text-[#1F2A37]">{weeklySummary.adherence.current_score}%</p>
                        </div>
                        <div className="rounded-xl border border-[#E9EEF7] bg-white p-2 text-center">
                          <p className="text-xs text-[#667085]">Prior</p>
                          <p className="text-2xl font-bold text-[#1F2A37]">{weeklySummary.adherence.prior_score}%</p>
                        </div>
                        <div className="rounded-xl border border-[#E9EEF7] bg-white p-2 text-center">
                          <p className="text-xs text-[#667085]">Delta</p>
                          <p className={`text-2xl font-bold ${weeklySummary.adherence.delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {weeklySummary.adherence.delta >= 0 ? `+${weeklySummary.adherence.delta}` : weeklySummary.adherence.delta}%
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-[#667085]">
                        <div>Taken: <strong>{weeklySummary.adherence.taken}</strong></div>
                        <div>Missed: <strong>{weeklySummary.adherence.missed}</strong></div>
                        <div>Late: <strong>{weeklySummary.adherence.late}</strong></div>
                      </div>
                    </ChartCard>

                    <SummaryCard title="Drift Detection" icon={<ShieldAlert size={16} className="text-[#3B6EF5]" />}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-[#475467]">{weeklySummary.drift.trigger || "No trigger"}</p>
                        <BadgePill
                          label={weeklySummary.drift.severity.toUpperCase()}
                          tone={weeklySummary.drift.severity === "red" ? "red" : weeklySummary.drift.severity === "orange" ? "yellow" : "blue"}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[#667085]">
                        {weeklySummary.drift.details?.missed_doses ?? 0} missed • {weeklySummary.drift.details?.late_doses ?? 0} late • Avg MES {weeklySummary.drift.details?.avg_mes ?? 0}
                      </p>
                    </SummaryCard>

                    <SummaryCard title="Intervention History" icon={<CalendarClock size={16} className="text-[#3B6EF5]" />}>
                      {weeklySummary.interventions.length === 0 ? (
                        <p className="text-sm text-[#667085]">No interventions in this period.</p>
                      ) : (
                        <div className="space-y-2">
                          {weeklySummary.interventions.slice(0, 10).map((iv) => (
                            <div key={iv.intervention_id} className="rounded-xl border border-[#E9EEF7] bg-white p-2">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-[#1F2A37]">{iv.action_type.replace(/_/g, " ")}</p>
                                <BadgePill label={iv.risk_level} tone={iv.risk_level === "HIGH" ? "red" : iv.risk_level === "MEDIUM" ? "yellow" : "success"} />
                              </div>
                              <p className="mt-1 text-xs text-[#667085]">{iv.message}</p>
                              <p className="mt-1 text-[11px] text-[#98A2B3]">{new Date(iv.timestamp).toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </SummaryCard>

                    <SummaryCard title="TCM Safety" icon={<ShieldAlert size={16} className="text-[#3B6EF5]" />}>
                      <p className="text-sm text-[#475467]">{weeklySummary.tcm_status}</p>
                      {weeklySummary.tcm_warnings.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {weeklySummary.tcm_warnings.map((w, idx) => (
                            <div key={`${w.herb}-${idx}`} className="rounded-xl border border-red-200 bg-red-50 p-2">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-red-700">{w.herb}</p>
                                <BadgePill label={w.risk_level.toUpperCase()} tone={w.risk_level === "high" ? "red" : "yellow"} />
                              </div>
                              <p className="text-xs text-red-700">Affects: {w.flagged_medications.join(", ")}</p>
                              {w.guidance ? <p className="text-xs text-red-600">{w.guidance}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </SummaryCard>

                    <SummaryCard title="Lifestyle Summary" icon={<ClipboardList size={16} className="text-[#3B6EF5]" />}>
                      <p className="text-sm text-[#475467]">{weeklySummary.food_summary}</p>
                      <p className="mt-1 text-sm text-[#475467]">Joined {weeklySummary.community_joined_count} community activities this week.</p>
                      {weeklySummary.food_recommendations.length > 0 ? (
                        <ul className="mt-2 list-disc pl-5 text-sm text-[#667085]">
                          {weeklySummary.food_recommendations.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </SummaryCard>
                  </>
                ) : null}
              </>
            ) : null}

            {tab === "ai-insights" ? (
              <>
                {!selectedPatientId ? (
                  <ChartCard>
                    <p className="text-sm text-[#667085]">Select a patient in Patients tab to generate AI insights.</p>
                  </ChartCard>
                ) : (
                  <>
                    <SummaryCard
                      title="AI Clinical Insights"
                      icon={<Sparkles size={16} className="text-[#3B6EF5]" />}
                    >
                      <p className="text-xs text-[#667085]">
                        Powered by AI — generates a clinical summary, risk assessment, and recommendations based on patient data.
                      </p>
                      <button
                        type="button"
                        disabled={aiLoading}
                        onClick={async () => {
                          if (!selectedPatientId) return;
                          setAiLoading(true);
                          setAiError(null);
                          setAiSummary(null);
                          try {
                            const result = await api.clinicianGetAISummary(accountId, selectedPatientId);
                            setAiSummary(result);
                          } catch (err) {
                            setAiError(safeMessage(err));
                          } finally {
                            setAiLoading(false);
                          }
                        }}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3670e2] to-[#6366F1] px-4 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60"
                      >
                        {aiLoading ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            Generating Insights...
                          </>
                        ) : (
                          <>
                            <Sparkles size={14} />
                            {aiSummary ? "Regenerate Insights" : "Generate AI Insights"}
                          </>
                        )}
                      </button>
                    </SummaryCard>

                    {aiError ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                        <p className="text-sm font-semibold text-red-700">Failed to generate insights</p>
                        <p className="mt-1 text-xs text-red-600">{aiError}</p>
                      </div>
                    ) : null}

                    {aiLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 h-4 w-1/3 rounded bg-slate-200" />
                            <div className="space-y-2">
                              <div className="h-3 w-full rounded bg-slate-100" />
                              <div className="h-3 w-5/6 rounded bg-slate-100" />
                              <div className="h-3 w-4/6 rounded bg-slate-100" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {aiSummary && !aiLoading ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-[#3670e2]/20 bg-gradient-to-br from-[#EEF2FF] to-white p-5 shadow-sm">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <BrainCircuit size={18} className="text-[#3670e2]" />
                              <h3 className="text-base font-bold text-[#1F2A37]">
                                AI Summary — {aiSummary.patient_name}
                              </h3>
                            </div>
                            <span className="rounded-full bg-[#3670e2]/10 px-2.5 py-0.5 text-[10px] font-semibold text-[#3670e2]">
                              {aiSummary.provider.toUpperCase()}
                            </span>
                          </div>
                          <div className="prose prose-sm max-w-none text-[#344054]">
                            {aiSummary.summary.split("\n").map((line, idx) => {
                              const trimmed = line.trim();
                              if (!trimmed) return <br key={idx} />;
                              if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
                                return (
                                  <h4 key={idx} className="mb-1 mt-4 text-sm font-bold text-[#1F2A37]">
                                    {trimmed.replace(/\*\*/g, "")}
                                  </h4>
                                );
                              }
                              if (/^\d+\.\s*\*\*/.test(trimmed)) {
                                return (
                                  <h4 key={idx} className="mb-1 mt-4 text-sm font-bold text-[#1F2A37]">
                                    {trimmed.replace(/\*\*/g, "")}
                                  </h4>
                                );
                              }
                              if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
                                return (
                                  <div key={idx} className="ml-3 flex items-start gap-2 py-0.5">
                                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3670e2]" />
                                    <span className="text-sm leading-relaxed text-[#475467]">
                                      {trimmed.slice(2).replace(/\*\*/g, "")}
                                    </span>
                                  </div>
                                );
                              }
                              return (
                                <p key={idx} className="text-sm leading-relaxed text-[#475467]">
                                  {trimmed.replace(/\*\*/g, "")}
                                </p>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : null}

            {tab === "profile" ? (
              <SummaryCard title="Clinician Account" icon={<UserRound size={16} className="text-[#3B6EF5]" />}>
                <p className="text-base font-semibold text-[#1F2A37]">{account.name}</p>
                <p className="text-sm text-[#667085]">{account.email}</p>
                <p className="text-xs text-[#98A2B3]">Role: Clinician</p>
                <button type="button" onClick={signOut} className="mt-4 w-full rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                  Sign Out
                </button>
              </SummaryCard>
            ) : null}
          </section>

          {tab === "patients" ? (
            <div
              className="pointer-events-none fixed bottom-[calc(6.75rem+env(safe-area-inset-bottom))] z-40"
              style={floatingBounds ? { left: `${floatingBounds.left}px`, width: `${floatingBounds.width}px` } : { left: 0, right: 0 }}
            >
              <div className="mx-auto flex w-full max-w-md justify-end px-6">
                <button
                  type="button"
                  onClick={() => setShowAssignPanel((value) => !value)}
                  className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-[#3670e2] text-white shadow-[0_12px_28px_rgba(54,112,226,0.28)]"
                  style={{ marginTop: 0 }}
                  aria-label={showAssignPanel ? "Close assign patient panel" : "Open assign patient panel"}
                >
                  <Plus size={22} strokeWidth={2.3} />
                </button>
              </div>
            </div>
          ) : null}

          <TabBar
            tabs={navTabs}
            active={tab}
            containerRef={shellRef}
            variant="patient"
            onTabChange={(value) => setTab(value as ClinicianTab)}
          />
        </div>
      </main>
    </>
  );
}
