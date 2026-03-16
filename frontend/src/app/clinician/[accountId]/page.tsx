"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  ClipboardList,
  FileText,
  Pill,
  Plus,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import {
  api,
  type Account,
  type AppointmentItem,
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

type ClinicianTab = "patients" | "care-plan" | "outcomes" | "profile";

type CarePlanMeta = {
  sex: string;
  backgroundNotes: string;
  caregiverContext: string;
  followUpReason: string;
  reviewCadence: string;
  followUpStatus: string;
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

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClinicianPatientDetail | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [profileSaving, setProfileSaving] = useState(false);
  const [conditionsSaving, setConditionsSaving] = useState(false);
  const [medSaving, setMedSaving] = useState(false);
  const [apptSaving, setApptSaving] = useState(false);

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

  const navTabs = useMemo(
    () => [
      { key: "patients", label: "Patients", icon: <Users size={18} strokeWidth={2.1} /> },
      { key: "care-plan", label: "Care Plan", icon: <ClipboardList size={18} strokeWidth={2.1} /> },
      { key: "outcomes", label: "Outcomes", icon: <FileText size={18} strokeWidth={2.1} /> },
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
    if (!selectedPatientId) return;
    const name = profileForm.name.trim();
    const ageNum = parseInt(profileForm.age, 10);
    if (!name || Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      setError("Please provide valid patient name and age (0-120).");
      return;
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
    } catch (err) {
      setError(safeMessage(err));
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveConditions() {
    if (!selectedPatientId) return;
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
    } catch (err) {
      setError(safeMessage(err));
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

  if (!account) return null;

  return (
    <main className="flex min-h-screen justify-center bg-white">
      <div ref={shellRef} className="relative min-h-screen w-full max-w-md bg-[#F8FAFC] pb-24">
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

        <section className="space-y-4 px-3 pb-8 pt-4">
          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          {tab === "patients" ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold text-[#1F2A37]">My Patients</h2>
                <button
                  type="button"
                  onClick={() => setShowAssignPanel((v) => !v)}
                  className="mt-0 inline-flex w-auto items-center gap-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white"
                >
                  <Plus size={15} /> Assign
                </button>
              </div>

              {loading ? <p className="text-sm text-[#667085]">Loading patients...</p> : null}

              {showAssignPanel ? (
                <ChartCard>
                  <SectionTitle title="Assign Patient" />
                  <div className="mt-3 space-y-2">
                    {allPatients
                      .filter((p) => !p.assigned_clinician_id)
                      .map((p) => (
                        <button
                          key={p.user_id}
                          type="button"
                          onClick={() => void handleAssign(p.user_id)}
                          className="mt-0 flex w-full items-center justify-between rounded-xl border border-[#E9EEF7] bg-white px-3 py-2 text-left"
                        >
                          <div>
                            <p className="font-semibold text-[#1F2A37]">{p.name}</p>
                            <p className="text-xs text-[#667085]">Age {p.age} • {(p.conditions ?? []).join(", ") || "No conditions"}</p>
                          </div>
                          <BadgePill label="Assign" tone="blue" />
                        </button>
                      ))}
                  </div>
                </ChartCard>
              ) : null}

              <div className="space-y-2">
                {patients.map((patient) => (
                  <article key={patient.user_id} className="rounded-2xl border border-[#E9EEF7] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPatientId(patient.user_id);
                          setTab("care-plan");
                        }}
                        className="mt-0 flex-1 bg-transparent p-0 text-left"
                      >
                        <p className="text-lg font-semibold text-[#1F2A37]">{patient.name}</p>
                        <p className="text-sm text-[#667085]">Age {patient.age} • {(patient.conditions ?? []).join(", ") || "No conditions"}</p>
                        <p className="text-xs text-[#98A2B3]">{patient.medication_count} meds • {patient.appointment_count} follow-ups</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUnassign(patient.user_id)}
                        className="mt-0 inline-flex w-auto items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </article>
                ))}

                {!loading && patients.length === 0 ? (
                  <ChartCard>
                    <p className="text-sm text-[#667085]">No assigned patients yet. Use Assign to start a care plan.</p>
                  </ChartCard>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === "care-plan" ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold text-[#1F2A37]">Care Plan</h2>
                {selectedPatient ? <BadgePill label={selectedPatient.name} tone="blue" /> : null}
              </div>

              {!selectedPatientId ? (
                <ChartCard>
                  <p className="text-sm text-[#667085]">Select a patient in Patients tab to set up their care plan.</p>
                </ChartCard>
              ) : null}

              {loading ? <p className="text-sm text-[#667085]">Loading care plan...</p> : null}

              {selectedPatientId && detail ? (
                <>
                  <SummaryCard title="Patient Profile" icon={<UserRound size={16} className="text-[#3B6EF5]" />}>
                    <p className="mb-2 text-xs text-[#667085]">Clinician-owned profile for care-plan setup.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-semibold text-[#667085]">Name
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} />
                      </label>
                      <label className="text-xs font-semibold text-[#667085]">Age
                        <input type="number" className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.age} onChange={(e) => setProfileForm((p) => ({ ...p, age: e.target.value }))} />
                      </label>
                      <label className="text-xs font-semibold text-[#667085]">Timezone
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.timezone} onChange={(e) => setProfileForm((p) => ({ ...p, timezone: e.target.value }))} />
                      </label>
                      <label className="text-xs font-semibold text-[#667085]">Language
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.language_preference} onChange={(e) => setProfileForm((p) => ({ ...p, language_preference: e.target.value }))} />
                      </label>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <label className="text-xs font-semibold text-[#667085]">Sex / Gender
                        <input className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.sex} onChange={(e) => setProfileForm((p) => ({ ...p, sex: e.target.value }))} />
                      </label>
                      <label className="text-xs font-semibold text-[#667085]">Background notes
                        <textarea className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.backgroundNotes} onChange={(e) => setProfileForm((p) => ({ ...p, backgroundNotes: e.target.value }))} />
                      </label>
                      <label className="text-xs font-semibold text-[#667085]">Caregiver / support context
                        <textarea className="mt-1 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={profileForm.caregiverContext} onChange={(e) => setProfileForm((p) => ({ ...p, caregiverContext: e.target.value }))} />
                      </label>
                    </div>

                    <button type="button" onClick={() => void saveProfile()} disabled={profileSaving} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                      <Save size={14} /> {profileSaving ? "Saving..." : "Save Profile"}
                    </button>
                  </SummaryCard>

                  <SummaryCard title="Conditions" icon={<ShieldAlert size={16} className="text-[#3B6EF5]" />}>
                    <p className="text-xs text-[#667085]">Add one or more conditions, comma separated.</p>
                    <textarea className="mt-2 w-full rounded-lg border border-[#D9E3F5] bg-white px-2 py-2 text-sm" value={conditionsText} onChange={(e) => setConditionsText(e.target.value)} />
                    <button type="button" onClick={() => void saveConditions()} disabled={conditionsSaving} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                      <Save size={14} /> {conditionsSaving ? "Saving..." : "Save Conditions"}
                    </button>
                  </SummaryCard>

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
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold text-[#1F2A37]">Outcomes</h2>
                <button type="button" onClick={() => void loadOutcomes()} className="mt-0 inline-flex w-auto items-center gap-1 rounded-xl bg-[#3B6EF5] px-3 py-2 text-sm font-semibold text-white">
                  <FileText size={14} /> Refresh
                </button>
              </div>

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

        <TabBar
          tabs={navTabs}
          active={tab}
          containerRef={shellRef}
          onTabChange={(value) => setTab(value as ClinicianTab)}
        />
      </div>
    </main>
  );
}
