"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  api,
  type AppointmentItem,
  type AppointmentListResponse,
  type AppointmentResponse,
  type ChatResponse,
  type CommunityEventItem,
  type CommunityMyEventsResponse,
  type CommunityResponse,
  type DemoPatient,
  type DriftResponse,
  type FoodResponse,
  type MedicationItem,
  type MedicationListResponse,
  type NextActionResponse,
  type ReportSummaryResponse,
  type TCMResponse,
  type UserProfile,
  type VoiceAgentResponse,
  type VoiceResponse
} from "../../../lib/api";

type Tab = "home" | "chat" | "health" | "profile";
type ChatMessage = {
  id: number;
  sender: "user" | "bot";
  text: string;
};

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

function formatAppointment(appointment: AppointmentResponse["next_appointment"], daysRemaining: number | null): string {
  if (!appointment) {
    return "No upcoming appointment";
  }

  const when = new Date(appointment.datetime).toLocaleString();
  if (daysRemaining === null) {
    return `${when} at ${appointment.location}`;
  }

  return `${when} at ${appointment.location} (${daysRemaining} day(s) remaining)`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export default function DashboardPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();

  const userIdParam = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const userId = decodeURIComponent(userIdParam ?? "");

  const [activeTab, setActiveTab] = useState<Tab>("home");

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [medications, setMedications] = useState<MedicationListResponse | null>(null);
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [nextAction, setNextAction] = useState<NextActionResponse | null>(null);
  const [food, setFood] = useState<FoodResponse | null>(null);
  const [appointments, setAppointments] = useState<AppointmentResponse | null>(null);
  const [community, setCommunity] = useState<CommunityResponse | null>(null);
  const [myCommunityEvents, setMyCommunityEvents] = useState<CommunityMyEventsResponse | null>(null);
  const [reportSummary, setReportSummary] = useState<ReportSummaryResponse | null>(null);

  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [communityActionLoading, setCommunityActionLoading] = useState<string | null>(null);
  const [communityActionError, setCommunityActionError] = useState<string | null>(null);

  const [chatDraft, setChatDraft] = useState("");
  const [chatResult, setChatResult] = useState<ChatResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: "bot",
      text: "Hello, I am here to support your medication routine today."
    }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceResult, setVoiceResult] = useState<VoiceResponse | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const [herb, setHerb] = useState("");
  const [tcmResult, setTCMResult] = useState<TCMResponse | null>(null);
  const [tcmLoading, setTCMLoading] = useState(false);
  const [tcmError, setTCMError] = useState<string | null>(null);
  const [tcmImageFile, setTcmImageFile] = useState<File | null>(null);
  const [tcmMode, setTcmMode] = useState<"manual" | "image">("manual");
  const [tcmAudioUrl, setTcmAudioUrl] = useState<string | null>(null);
  const [tcmAudioLoading, setTcmAudioLoading] = useState(false);
  const [tcmAudioPlaying, setTcmAudioPlaying] = useState(false);
  const [tcmLang, setTcmLang] = useState<"en" | "zh" | "ms" | "ta">("en");
  const [tcmTranslatedText, setTcmTranslatedText] = useState<{ message: string; singlish: string } | null>(null);
  const [tcmTranslating, setTcmTranslating] = useState(false);

  // --- Voice Agent state ---
  const [vaMessage, setVaMessage] = useState("");
  const [vaReply, setVaReply] = useState<string | null>(null);
  const [vaLoading, setVaLoading] = useState(false);
  const [vaError, setVaError] = useState<string | null>(null);
  const [vaAudioUrl, setVaAudioUrl] = useState<string | null>(null);
  const [vaAudioLoading, setVaAudioLoading] = useState(false);

  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // --- Demo patient state ---
  const [demoPatients, setDemoPatients] = useState<DemoPatient[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  // --- Profile edit state ---
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAge, setProfileAge] = useState("");
  const [profileTz, setProfileTz] = useState("");
  const [profileLang, setProfileLang] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // --- Medications CRUD state ---
  const [allMeds, setAllMeds] = useState<MedicationItem[]>([]);
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

  // --- Appointments CRUD state ---
  const [allAppts, setAllAppts] = useState<AppointmentItem[]>([]);
  const [showApptForm, setShowApptForm] = useState(false);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [apptDatetime, setApptDatetime] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [apptSaving, setApptSaving] = useState(false);
  const [apptMsg, setApptMsg] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!userId) {
      return;
    }

    setDashboardLoading(true);
    setDashboardError(null);

    const [userRes, medsRes, driftRes, nextRes, foodRes, appointmentRes, communityRes, myEventsRes] = await Promise.allSettled([
      api.getUser(userId),
      api.getMedications(userId),
      api.getDrift(userId),
      api.getNextAction(userId),
      api.getFoodRecommendations(userId),
      api.getAppointments(userId),
      api.getCommunityEvents(userId),
      api.getMyCommunityEvents(userId)
    ]);

    const errors: string[] = [];

    if (userRes.status === "fulfilled") {
      setUserProfile(userRes.value);
    } else {
      setUserProfile(null);
      errors.push(`user: ${safeMessage(userRes.reason)}`);
    }

    if (medsRes.status === "fulfilled") {
      setMedications(medsRes.value);
    } else {
      setMedications(null);
      errors.push(`medications: ${safeMessage(medsRes.reason)}`);
    }

    if (driftRes.status === "fulfilled") {
      setDrift(driftRes.value);
    } else {
      setDrift(null);
      errors.push(`drift: ${safeMessage(driftRes.reason)}`);
    }

    if (nextRes.status === "fulfilled") {
      setNextAction(nextRes.value);
    } else {
      setNextAction(null);
      errors.push(`next-action: ${safeMessage(nextRes.reason)}`);
    }

    if (foodRes.status === "fulfilled") {
      setFood(foodRes.value);
    } else {
      setFood(null);
      errors.push(`food: ${safeMessage(foodRes.reason)}`);
    }

    if (appointmentRes.status === "fulfilled") {
      setAppointments(appointmentRes.value);
    } else {
      setAppointments(null);
      errors.push(`appointments: ${safeMessage(appointmentRes.reason)}`);
    }

    if (communityRes.status === "fulfilled") {
      setCommunity(communityRes.value);
    } else {
      setCommunity(null);
      errors.push(`community: ${safeMessage(communityRes.reason)}`);
    }

    if (myEventsRes.status === "fulfilled") {
      setMyCommunityEvents(myEventsRes.value);
    } else {
      setMyCommunityEvents(null);
      errors.push(`my-events: ${safeMessage(myEventsRes.reason)}`);
    }

    if (errors.length > 0) {
      setDashboardError(`Some modules failed: ${errors.join(" | ")}`);
    }

    setDashboardLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const appointmentText = useMemo(
    () => formatAppointment(appointments?.next_appointment ?? null, appointments?.days_remaining ?? null),
    [appointments]
  );

  const recommendedEvents = community?.events ?? [];
  const medicationCount = medications?.items?.length ?? 0;
  const joinedEventIds = useMemo(
    () => new Set((myCommunityEvents?.joined ?? []).map((event) => event.event_id)),
    [myCommunityEvents]
  );

  async function handleSeedDemo() {
    setDemoLoading(true);
    setDemoMsg(null);
    try {
      const res = await api.seedDemoPatients();
      setDemoPatients(res.patients);
      setDemoMsg(`Created ${res.count} demo patients. Select one below to switch.`);
    } catch (error) {
      setDemoMsg(safeMessage(error));
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleSendChat() {
    const message = chatDraft.trim();
    if (!message || !userId) {
      return;
    }

    setChatMessages((prev) => [...prev, { id: Date.now(), sender: "user", text: message }]);
    setChatDraft("");
    setChatLoading(true);
    setChatError(null);

    try {
      const response = await api.postChat(userId, message);
      setChatResult(response);
      setChatMessages((prev) => [...prev, { id: Date.now() + 1, sender: "bot", text: response.reply }]);
    } catch (error) {
      const msg = safeMessage(error);
      setChatError(msg);
      setChatMessages((prev) => [...prev, { id: Date.now() + 2, sender: "bot", text: `Sorry, ${msg}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleAnalyzeVoice() {
    const transcript = voiceTranscript.trim();
    if (!transcript || !userId) {
      return;
    }

    setVoiceLoading(true);
    setVoiceError(null);

    try {
      const response = await api.postVoiceTranscript(userId, transcript);
      setVoiceResult(response);
    } catch (error) {
      setVoiceError(safeMessage(error));
    } finally {
      setVoiceLoading(false);
    }
  }

  async function handleTCMCheck() {
    if (!userId) return;
    setTCMLoading(true);
    setTCMError(null);
    setTCMResult(null);
    setTcmAudioUrl(null);
    setTcmAudioPlaying(false);
    setTcmLang("en");
    setTcmTranslatedText(null);
    setTcmTranslating(false);

    try {
      let response: TCMResponse;
      if (tcmMode === "image" && tcmImageFile) {
        // Single-step: upload image and get interaction results directly
        response = await api.postTCMScan(userId, tcmImageFile);
      } else {
        const herbText = herb.trim();
        if (!herbText) { setTCMError("Please enter a herb name."); setTCMLoading(false); return; }
        response = await api.postTCMCheck(userId, herbText);
      }
      setTCMResult(response);
    } catch (error) {
      setTCMError(safeMessage(error));
    } finally {
      setTCMLoading(false);
    }
  }

  // --- Voice Agent handlers ---
  async function handleVoiceAgent() {
    const msg = vaMessage.trim();
    if (!msg || !userId) return;
    setVaLoading(true);
    setVaError(null);
    setVaReply(null);
    setVaAudioUrl(null);
    try {
      const response = await api.postVoiceAgent(userId, msg);
      setVaReply(response.reply);
    } catch (error) {
      setVaError(safeMessage(error));
    } finally {
      setVaLoading(false);
    }
  }

  async function handlePlayAudio() {
    if (!vaReply) return;
    setVaAudioLoading(true);
    try {
      const blob = await api.postTTS(vaReply);
      const url = URL.createObjectURL(blob);
      setVaAudioUrl(url);
      const audio = new Audio(url);
      audio.play();
    } catch (error) {
      setVaError(`Audio: ${safeMessage(error)}`);
    } finally {
      setVaAudioLoading(false);
    }
  }

  async function handleLoadReportSummary() {
    if (!userId) {
      return;
    }

    setReportLoading(true);
    setReportError(null);

    try {
      const response = await api.getReportSummary(userId);
      setReportSummary(response);
    } catch (error) {
      setReportError(safeMessage(error));
    } finally {
      setReportLoading(false);
    }
  }

  async function refreshCommunityPanels() {
    if (!userId) return;
    try {
      const [recommended, mine] = await Promise.all([
        api.getCommunityEvents(userId),
        api.getMyCommunityEvents(userId)
      ]);
      setCommunity(recommended);
      setMyCommunityEvents(mine);
    } catch (error) {
      setCommunityActionError(safeMessage(error));
    }
  }

  async function handleToggleCommunityEvent(event: CommunityEventItem) {
    if (!userId) return;
    setCommunityActionError(null);
    setCommunityActionLoading(event.event_id);
    try {
      if (joinedEventIds.has(event.event_id)) {
        await api.postCancelCommunityEvent(userId, event.event_id);
      } else {
        await api.postJoinCommunityEvent(userId, event.event_id);
      }
      await refreshCommunityPanels();
    } catch (error) {
      setCommunityActionError(safeMessage(error));
    } finally {
      setCommunityActionLoading(null);
    }
  }

  // --- Profile CRUD handlers ---
  function startEditProfile() {
    if (!userProfile) return;
    setProfileName(userProfile.name);
    setProfileAge(String(userProfile.age));
    setProfileTz(userProfile.timezone);
    setProfileLang(userProfile.language_preference ?? "English");
    setEditingProfile(true);
    setProfileMsg(null);
  }

  async function handleSaveProfile() {
    const ageNum = parseInt(profileAge, 10);
    if (!profileName.trim() || isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      setProfileMsg("Please enter a valid name and age (0–120).");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const updated = await api.updateUser(userId, {
        name: profileName.trim(),
        age: ageNum,
        timezone: profileTz.trim(),
        language_preference: profileLang.trim(),
      });
      setUserProfile(updated);
      setEditingProfile(false);
      setProfileMsg("Profile updated.");
    } catch (e) {
      setProfileMsg(safeMessage(e));
    } finally {
      setProfileSaving(false);
    }
  }

  // --- Medications CRUD handlers ---
  async function loadAllMeds() {
    try {
      const res = await api.getMedications(userId);
      setAllMeds((res.items ?? []) as MedicationItem[]);
    } catch { setAllMeds([]); }
  }

  function resetMedForm() {
    setShowMedForm(false);
    setEditMedId(null);
    setMedName("");
    setMedDose("");
    setMedFreq("once_daily");
    setMedTimes("08:00");
    setMedWindow("120");
    setMedCrit("medium");
    setMedMsg(null);
  }

  function startEditMed(med: MedicationItem) {
    setEditMedId(med.medication_id);
    setMedName(med.name);
    setMedDose(med.dose_text);
    setMedFreq(med.schedule.frequency);
    setMedTimes(med.schedule.times.join(", "));
    setMedWindow(String(med.time_window_minutes));
    setMedCrit(med.criticality);
    setShowMedForm(true);
    setMedMsg(null);
  }

  async function handleSaveMed() {
    if (!medName.trim()) { setMedMsg("Name is required."); return; }
    const times = medTimes.split(",").map(t => t.trim()).filter(Boolean);
    const payload = {
      name: medName.trim(),
      dose_text: medDose.trim(),
      schedule: { frequency: medFreq, times },
      time_window_minutes: parseInt(medWindow, 10) || 120,
      criticality: medCrit,
    };
    setMedSaving(true);
    setMedMsg(null);
    try {
      if (editMedId) {
        await api.updateMedication(userId, editMedId, payload);
      } else {
        await api.createMedication(userId, payload);
      }
      resetMedForm();
      await loadAllMeds();
    } catch (e) {
      setMedMsg(safeMessage(e));
    } finally {
      setMedSaving(false);
    }
  }

  async function handleDeleteMed(medId: string) {
    try {
      await api.deleteMedication(userId, medId);
      await loadAllMeds();
    } catch (e) {
      setMedMsg(safeMessage(e));
    }
  }

  // --- Appointments CRUD handlers ---
  async function loadAllAppts() {
    try {
      const res = await api.getAllAppointments(userId);
      setAllAppts(res.items ?? []);
    } catch { setAllAppts([]); }
  }

  function resetApptForm() {
    setShowApptForm(false);
    setEditApptId(null);
    setApptDatetime("");
    setApptLocation("");
    setApptNotes("");
    setApptMsg(null);
  }

  function startEditAppt(appt: AppointmentItem) {
    setEditApptId(appt.appointment_id);
    setApptDatetime(appt.datetime.slice(0, 16)); // fit datetime-local input
    setApptLocation(appt.location);
    setApptNotes(appt.notes);
    setShowApptForm(true);
    setApptMsg(null);
  }

  async function handleSaveAppt() {
    if (!apptDatetime) { setApptMsg("Date & time is required."); return; }
    const payload = {
      datetime: apptDatetime,
      location: apptLocation.trim(),
      notes: apptNotes.trim(),
    };
    setApptSaving(true);
    setApptMsg(null);
    try {
      if (editApptId) {
        await api.updateAppointment(userId, editApptId, payload);
      } else {
        await api.createAppointment(userId, payload);
      }
      resetApptForm();
      await loadAllAppts();
    } catch (e) {
      setApptMsg(safeMessage(e));
    } finally {
      setApptSaving(false);
    }
  }

  async function handleDeleteAppt(apptId: string) {
    try {
      await api.deleteAppointment(userId, apptId);
      await loadAllAppts();
    } catch (e) {
      setApptMsg(safeMessage(e));
    }
  }

  // Load meds & appts when switching to profile or health tab
  useEffect(() => {
    if ((activeTab === "profile" || activeTab === "health") && userId) {
      void loadAllMeds();
      void loadAllAppts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  if (!userId) {
    return (
      <main className="demo-shell">
        <div className="phone-frame auth-frame">
          <section className="tab-body">
            <section className="card">
              <h2 className="auth-title">Invalid patient selection</h2>
              <p className="muted">No user id was provided in the dashboard route.</p>
              <button type="button" onClick={() => { sessionStorage.removeItem("bytecare_account"); localStorage.removeItem("bytecare_account"); router.replace("/auth/signin"); }}>Sign Out</button>
            </section>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="demo-shell">
      <div className="phone-frame">
        <header className="app-header">
          <div className="header-left">
            <div className="avatar">{(userProfile?.name ?? "Patient").slice(0, 2).toUpperCase()}</div>
            <div>
              <h1>ByteCare - Patient</h1>
              <p className="muted">{userProfile?.name ?? "Loading profile..."}</p>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label="Reload" onClick={() => void loadDashboard()}>
            Reload
          </button>
        </header>

        {dashboardLoading ? <p className="status-ok">Loading dashboard...</p> : null}
        {dashboardError ? <p className="status-error">{dashboardError}</p> : null}

        <section className="tab-body">
          {activeTab === "home" ? (
            <>
              <section className="card">
                <div className="card-title">Patient Overview</div>
                <h2 className="patient-name">{userProfile?.name ?? "-"}</h2>
                <p className="muted">Age {userProfile?.age ?? "-"} | {userProfile?.timezone ?? "-"}</p>
                {userProfile?.conditions && userProfile.conditions.length > 0 ? (
                  <p className="muted">Conditions: {userProfile.conditions.join(", ")}</p>
                ) : null}
                <p className="muted">Condition signal: {food?.condition ?? "Not available"}</p>
                <p className="primary-text">{medicationCount} medications active</p>
              </section>

              <section className="card">
                <div className="card-title">Load Demo Patients</div>
                <p className="muted">Seed 3 demo patients with realistic medications for TCM Safety Check testing.</p>
                <button type="button" onClick={() => void handleSeedDemo()} disabled={demoLoading} style={{ marginBottom: 8 }}>
                  {demoLoading ? "Seeding..." : "Seed Demo Patients"}
                </button>
                {demoMsg ? <p className="muted">{demoMsg}</p> : null}
                {demoPatients.length > 0 ? (
                  <div className="demo-patient-list">
                    {demoPatients.map((dp) => (
                      <button
                        key={dp.user_id}
                        type="button"
                        className="demo-patient-btn"
                        onClick={() => router.push(`/dashboard/${dp.user_id}`)}
                      >
                        <strong>{dp.name}</strong>
                        <span className="muted"> Age {dp.age} · {dp.medication_count} meds</span>
                        {dp.email ? (
                          <span className="muted" style={{ display: "block", fontSize: "0.78rem" }}>
                            Login: {dp.email} / {dp.password}
                            {dp.already_existed ? " (already seeded)" : ""}
                          </span>
                        ) : null}
                        <span className="muted" style={{ display: "block", fontSize: "0.78rem" }}>
                          {dp.conditions.join(", ")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="card">
                <div className="card-row">
                  <div className="card-title">Medication Adherence</div>
                  <span className={`severity-pill severity-${drift?.severity ?? "green"}`}>
                    {drift?.severity ?? "green"}
                  </span>
                </div>
                <p>Drift detected: {String(drift?.drift_detected ?? false)}</p>
                <p>Next action: {nextAction?.next_action ?? "-"}</p>
                <p className="muted">{nextAction?.suggested_message ?? "-"}</p>
              </section>

              <section className="card appointment-card">
                <div className="card-title light">Upcoming Visit</div>
                <p className="appointment-line">{appointmentText}</p>
              </section>

              <section className="card">
                <div className="card-title">Diet Suggestions</div>
                <ul className="list">
                  {(food?.recommendations ?? []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="card">
                <div className="card-title">Community Activities</div>
                {communityActionError ? <p className="status-error">{communityActionError}</p> : null}

                {recommendedEvents.length === 0 ? <p className="muted">No recommended events available.</p> : null}

                <div className="community-events-list">
                  {recommendedEvents.map((event) => {
                    const isJoined = joinedEventIds.has(event.event_id);
                    const isLoading = communityActionLoading === event.event_id;
                    return (
                      <article className="community-event-card" key={event.event_id}>
                        <h3>{event.title}</h3>
                        <p className="muted">{formatDateTime(event.datetime)}</p>
                        <p className="muted">{event.location}</p>
                        <p className="muted">{event.description}</p>
                        <p className="muted">{event.reason}</p>
                        <div className="community-event-actions">
                          <button
                            type="button"
                            className={isJoined ? "cancel-button" : "join-button"}
                            onClick={() => void handleToggleCommunityEvent(event)}
                            disabled={isLoading}
                          >
                            {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="my-events-section">
                  <h3>My Events</h3>
                  <p className="muted">Joined</p>
                  <ul className="list">
                    {(myCommunityEvents?.joined ?? []).map((event) => (
                      <li key={`joined-${event.event_id}`}>
                        {event.title} - {formatDateTime(event.datetime)}
                      </li>
                    ))}
                  </ul>
                  {(myCommunityEvents?.joined ?? []).length === 0 ? <p className="muted">No joined events yet.</p> : null}
                </div>
              </section>
            </>
          ) : null}

          {/* ── CHAT TAB ── */}
          {activeTab === "chat" ? (
            <>
              <section className="card chat-card">
                <div className="card-row">
                  <div className="card-title">Chat with ByteCare</div>
                  <span className="live-dot" />
                </div>

                <div className="chat-log">
                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={message.sender === "user" ? "chat-row user" : "chat-row bot"}
                    >
                      <div className={message.sender === "user" ? "bubble bubble-user" : "bubble bubble-bot"}>
                        {message.text}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="chat-input-row">
                  <input
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder="Type a message..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleSendChat();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void handleSendChat()} disabled={chatLoading}>
                    {chatLoading ? "..." : "Send"}
                  </button>
                </div>

                {chatError ? <p className="status-error">{chatError}</p> : null}
                {chatResult ? (
                  <p className="muted chat-context">
                    Context: drift={String(chatResult.context.drift_detected)}, severity={chatResult.context.severity},
                    action={chatResult.context.next_action}
                  </p>
                ) : null}
              </section>

              <section className="card">
                <div className="card-title">Voice Agent</div>
                <p className="muted">Talk to ByteCare in Singlish. Type your message and get a friendly reply!</p>

                <div className="form-group">
                  <textarea
                    value={vaMessage}
                    onChange={(e) => setVaMessage(e.target.value)}
                    placeholder='e.g. "I forgot take my medicine today lah"'
                    rows={3}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleVoiceAgent()}
                  disabled={vaLoading || !vaMessage.trim()}
                >
                  {vaLoading ? "Thinking..." : "Send Message"}
                </button>

                {vaError ? <p className="status-error">{vaError}</p> : null}

                {vaReply ? (
                  <div className="va-reply-box">
                    <div className="card-title small">ByteCare says:</div>
                    <p className="va-reply-text">{vaReply}</p>
                    <button
                      type="button"
                      className="play-audio-btn"
                      onClick={() => void handlePlayAudio()}
                      disabled={vaAudioLoading}
                    >
                      {vaAudioLoading ? "Loading audio..." : "Play Audio"}
                    </button>
                    {vaAudioUrl ? (
                      <audio controls src={vaAudioUrl} className="va-audio-player" />
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="card">
                <div className="card-title small">Voice Transcript Analysis</div>
                <p className="muted">Paste a voice transcript to analyze language, emotion, and intent.</p>
                <textarea
                  value={voiceTranscript}
                  onChange={(event) => setVoiceTranscript(event.target.value)}
                  placeholder='Example: "I forgot my medicine today lah."'
                  rows={2}
                />
                <button type="button" onClick={() => void handleAnalyzeVoice()} disabled={voiceLoading}>
                  {voiceLoading ? "Analyzing..." : "Analyze Transcript"}
                </button>
                {voiceError ? <p className="status-error">{voiceError}</p> : null}
                {voiceResult ? (
                  <div className="chip-wrap">
                    <span className="chip">{voiceResult.language_hint}</span>
                    <span className="chip">{voiceResult.emotion_tag}</span>
                    <span className="chip">{voiceResult.intent}</span>
                    <p className="muted">{voiceResult.cleaned_text}</p>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {/* ── HEALTH TAB ── */}
          {activeTab === "health" ? (
            <>
              <section className="card">
                <div className="card-title">TCM Safety Check</div>
                <p className="muted">Check herb-drug interactions against your current medications.</p>

                <div className="tcm-mode-picker">
                  <button
                    type="button"
                    className={tcmMode === "manual" ? "role-btn role-btn-active" : "role-btn"}
                    onClick={() => setTcmMode("manual")}
                  >
                    Type Herb Name
                  </button>
                  <button
                    type="button"
                    className={tcmMode === "image" ? "role-btn role-btn-active" : "role-btn"}
                    onClick={() => setTcmMode("image")}
                  >
                    Upload Image
                  </button>
                </div>

                {tcmMode === "manual" ? (
                  <div className="form-group">
                    <label className="form-label">Herb Name</label>
                    <input
                      value={herb}
                      onChange={(e) => setHerb(e.target.value)}
                      placeholder="e.g. ginseng, ginkgo, dong quai"
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Upload TCM Herb Label / Bottle Image</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        setTcmImageFile(e.target.files?.[0] ?? null);
                        setTCMResult(null);
                      }}
                      className="file-input"
                    />
                    {tcmImageFile ? (
                      <div style={{ marginTop: 8 }}>
                        <p className="muted">Selected: {tcmImageFile.name}</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={URL.createObjectURL(tcmImageFile)}
                          alt="Uploaded herb"
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginTop: 6, objectFit: "contain" }}
                        />
                      </div>
                    ) : null}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleTCMCheck()}
                  disabled={tcmLoading || (tcmMode === "manual" ? !herb.trim() : !tcmImageFile)}
                >
                  {tcmLoading ? "Scanning..." : "Check Herb"}
                </button>

                {tcmError ? <p className="status-error">{tcmError}</p> : null}

                {tcmResult ? (
                  <div className="tcm-result">
                    <div className={`alert-box ${tcmResult.risk_level === "high" ? "alert-danger" : tcmResult.risk_level === "moderate" ? "alert-warning" : "alert-safe"}`}>
                      <div className="tcm-result-header">
                        <strong>{tcmResult.herb_detected ?? "Unknown Herb"}</strong>
                        <span className={`risk-badge risk-${tcmResult.risk_level}`}>
                          {tcmResult.risk_level.toUpperCase()} RISK
                        </span>
                        {tcmResult.identification_source ? (
                          <span className="risk-badge" style={{ marginLeft: 4, fontSize: "0.7rem" }}>
                            via {tcmResult.identification_source}
                            {tcmResult.identification_confidence ? ` · ${tcmResult.identification_confidence}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <p>{tcmTranslatedText?.message ?? tcmResult.message}</p>
                      {tcmResult.flagged_medications.length > 0 ? (
                        <div className="flagged-meds">
                          <p className="muted"><strong>Flagged medications:</strong></p>
                          <ul className="list">
                            {tcmResult.flagged_medications.map((m) => <li key={m}>{m}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>

                    <div className="va-reply-box">
                      <div className="card-title small">ByteCare says{tcmLang === "en" ? " (Singlish)" : ""}:</div>
                      <p className="va-reply-text">{tcmTranslatedText?.singlish ?? tcmResult.singlish_message}</p>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <label className="muted" style={{ fontSize: "0.8rem" }}>Translate to:</label>
                        <select
                          value={tcmLang}
                          onChange={async (e) => {
                            const lang = e.target.value as "en" | "zh" | "ms" | "ta";
                            setTcmLang(lang);
                            setTcmAudioUrl(null);
                            setTcmTranslatedText(null);
                            if (lang === "en") return;
                            setTcmTranslating(true);
                            try {
                              const [msgRes, singRes] = await Promise.all([
                                api.postTranslate(tcmResult.message, lang),
                                api.postTranslate(tcmResult.singlish_message || tcmResult.message, lang),
                              ]);
                              setTcmTranslatedText({ message: msgRes.translated_text, singlish: singRes.translated_text });
                            } catch { /* best-effort */ }
                            setTcmTranslating(false);
                          }}
                          style={{ fontSize: "0.85rem", padding: "4px 8px", borderRadius: 6 }}
                        >
                          <option value="en">English (Singlish)</option>
                          <option value="zh">中文 (Chinese)</option>
                          <option value="ms">Bahasa Melayu (Malay)</option>
                          <option value="ta">தமிழ் (Tamil)</option>
                        </select>
                      </div>

                      {tcmTranslating ? (
                        <p className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>Translating...</p>
                      ) : null}

                      <button
                        type="button"
                        onClick={async () => {
                          const ttsText = tcmLang === "en"
                            ? (tcmResult.singlish_message || tcmResult.message)
                            : (tcmTranslatedText?.singlish || tcmResult.singlish_message || tcmResult.message);
                          if (!ttsText) return;
                          setTcmAudioLoading(true);
                          try {
                            const blob = await api.postTTS(ttsText, tcmLang);
                            const url = URL.createObjectURL(blob);
                            setTcmAudioUrl(url);
                            const audio = new Audio(url);
                            setTcmAudioPlaying(true);
                            audio.onended = () => setTcmAudioPlaying(false);
                            audio.onerror = () => setTcmAudioPlaying(false);
                            audio.play().catch(() => setTcmAudioPlaying(false));
                          } catch { setTcmAudioPlaying(false); }
                          setTcmAudioLoading(false);
                        }}
                        disabled={tcmAudioLoading || tcmAudioPlaying || (tcmLang !== "en" && tcmTranslating)}
                        style={{ marginTop: 8 }}
                      >
                        {tcmAudioLoading ? "Loading audio..." : tcmAudioPlaying ? "\uD83D\uDD0A Playing..." : tcmAudioUrl ? "\uD83D\uDD0A Press to Replay" : "\uD83D\uDD0A Listen"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="card">
                <div className="card-title">Clinician Summary</div>
                <button type="button" onClick={() => void handleLoadReportSummary()} disabled={reportLoading}>
                  {reportLoading ? "Loading..." : "Fetch Report Summary"}
                </button>
                {reportError ? <p className="status-error">{reportError}</p> : null}
                {reportSummary ? (
                  <div className="report-box">
                    <p>{reportSummary.summary}</p>
                    <p className="muted">Average MES 7d: {reportSummary.avg_mes_7d}</p>
                    <p className="muted">Missed doses 7d: {reportSummary.missed_doses_7d}</p>
                    <p className="muted">Late doses 7d: {reportSummary.late_doses_7d}</p>
                    <p className="muted">Recommended follow-up: {reportSummary.recommended_follow_up}</p>
                  </div>
                ) : null}
              </section>

              <section className="card">
                <div className="card-row">
                  <div className="card-title">Medication Tracking</div>
                  <span className={`severity-pill severity-${drift?.severity ?? "green"}`}>
                    {drift?.severity ?? "green"}
                  </span>
                </div>
                <p>Drift detected: {String(drift?.drift_detected ?? false)}</p>
                <p>Next action: {nextAction?.next_action ?? "-"}</p>
                <p className="muted">{nextAction?.suggested_message ?? "-"}</p>
                {allMeds.length > 0 ? (
                  <div className="item-list" style={{ marginTop: 8 }}>
                    {allMeds.map((med) => (
                      <div key={med.medication_id} className="item-row">
                        <div>
                          <div className="item-name">{med.name}</div>
                          <div className="muted">{med.dose_text} &middot; {med.schedule.frequency} &middot; {med.schedule.times.join(", ")}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No medications recorded yet.</p>
                )}
              </section>

              <section className="card">
                <div className="card-title">Appointment Tracking</div>
                {allAppts.length > 0 ? (
                  <div className="item-list">
                    {allAppts.map((appt) => (
                      <div key={appt.appointment_id} className="item-row">
                        <div>
                          <div className="item-name">{new Date(appt.datetime).toLocaleString()}</div>
                          <div className="muted">{appt.location}{appt.notes ? ` — ${appt.notes}` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No appointments scheduled.</p>
                )}
              </section>
            </>
          ) : null}

          {activeTab === "profile" ? (
            <>
              {/* --- Profile Section --- */}
              <section className="card">
                <div className="card-row">
                  <div className="card-title">Patient Profile</div>
                  {!editingProfile ? (
                    <button type="button" className="icon-button" onClick={startEditProfile}>Edit</button>
                  ) : null}
                </div>

                {!editingProfile ? (
                  <>
                    <p className="muted">Name: {userProfile?.name ?? "-"}</p>
                    <p className="muted">Age: {userProfile?.age ?? "-"}</p>
                    <p className="muted">Timezone: {userProfile?.timezone ?? "-"}</p>
                    <p className="muted">Language: {userProfile?.language_preference ?? "-"}</p>
                    <p className="muted">User ID: {userId}</p>
                  </>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Display Name</label>
                    <input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                    <label className="form-label">Age</label>
                    <input type="number" min={0} max={120} value={profileAge} onChange={(e) => setProfileAge(e.target.value)} />
                    <label className="form-label">Timezone</label>
                    <input value={profileTz} onChange={(e) => setProfileTz(e.target.value)} />
                    <label className="form-label">Language Preference</label>
                    <input value={profileLang} onChange={(e) => setProfileLang(e.target.value)} />
                    <button type="button" onClick={() => void handleSaveProfile()} disabled={profileSaving}>
                      {profileSaving ? "Saving..." : "Save Profile"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setEditingProfile(false)}>Cancel</button>
                  </div>
                )}
                {profileMsg ? <p className="status-ok">{profileMsg}</p> : null}
                <button type="button" className="secondary-button" onClick={() => { sessionStorage.removeItem("bytecare_account"); localStorage.removeItem("bytecare_account"); router.replace("/auth/signin"); }}>Sign Out</button>
              </section>

              {/* --- Medications Section --- */}
              <section className="card">
                <div className="card-row">
                  <div className="card-title">Medications</div>
                  <button type="button" className="icon-button" onClick={() => { resetMedForm(); setShowMedForm(true); }}>+ Add</button>
                </div>

                {showMedForm ? (
                  <div className="form-group">
                    <label className="form-label">Medication Name</label>
                    <input value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="e.g. Amlodipine 5mg" />
                    <label className="form-label">Dose Text</label>
                    <input value={medDose} onChange={(e) => setMedDose(e.target.value)} placeholder="e.g. 5mg" />
                    <label className="form-label">Frequency</label>
                    <select value={medFreq} onChange={(e) => setMedFreq(e.target.value)}>
                      <option value="once_daily">Once daily</option>
                      <option value="twice_daily">Twice daily</option>
                      <option value="thrice_daily">Thrice daily</option>
                      <option value="as_needed">As needed</option>
                    </select>
                    <label className="form-label">Times (comma-separated, e.g. 08:00, 20:00)</label>
                    <input value={medTimes} onChange={(e) => setMedTimes(e.target.value)} placeholder="08:00" />
                    <label className="form-label">Window (minutes)</label>
                    <input type="number" value={medWindow} onChange={(e) => setMedWindow(e.target.value)} />
                    <label className="form-label">Criticality</label>
                    <select value={medCrit} onChange={(e) => setMedCrit(e.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    {medMsg ? <p className="status-error">{medMsg}</p> : null}
                    <button type="button" onClick={() => void handleSaveMed()} disabled={medSaving}>
                      {medSaving ? "Saving..." : editMedId ? "Update Medication" : "Add Medication"}
                    </button>
                    <button type="button" className="secondary-button" onClick={resetMedForm}>Cancel</button>
                  </div>
                ) : null}

                {allMeds.length === 0 ? (
                  <p className="muted">No medications added yet.</p>
                ) : (
                  <div className="item-list">
                    {allMeds.map((med) => (
                      <div key={med.medication_id} className="item-row">
                        <div>
                          <div className="item-name">{med.name}</div>
                          <div className="muted">{med.dose_text} &middot; {med.schedule.frequency} &middot; {med.schedule.times.join(", ")} &middot; {med.criticality}</div>
                        </div>
                        <div className="item-actions">
                          <button type="button" className="icon-button" onClick={() => startEditMed(med)}>Edit</button>
                          <button type="button" className="icon-button danger-btn" onClick={() => void handleDeleteMed(med.medication_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* --- Appointments Section --- */}
              <section className="card">
                <div className="card-row">
                  <div className="card-title">Appointments</div>
                  <button type="button" className="icon-button" onClick={() => { resetApptForm(); setShowApptForm(true); }}>+ Add</button>
                </div>

                {showApptForm ? (
                  <div className="form-group">
                    <label className="form-label">Date &amp; Time</label>
                    <input type="datetime-local" value={apptDatetime} onChange={(e) => setApptDatetime(e.target.value)} />
                    <label className="form-label">Location</label>
                    <input value={apptLocation} onChange={(e) => setApptLocation(e.target.value)} placeholder="e.g. Polyclinic" />
                    <label className="form-label">Notes</label>
                    <textarea value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} placeholder="e.g. Follow-up visit" />
                    {apptMsg ? <p className="status-error">{apptMsg}</p> : null}
                    <button type="button" onClick={() => void handleSaveAppt()} disabled={apptSaving}>
                      {apptSaving ? "Saving..." : editApptId ? "Update Appointment" : "Add Appointment"}
                    </button>
                    <button type="button" className="secondary-button" onClick={resetApptForm}>Cancel</button>
                  </div>
                ) : null}

                {allAppts.length === 0 ? (
                  <p className="muted">No appointments added yet.</p>
                ) : (
                  <div className="item-list">
                    {allAppts.map((appt) => (
                      <div key={appt.appointment_id} className="item-row">
                        <div>
                          <div className="item-name">{new Date(appt.datetime).toLocaleString()}</div>
                          <div className="muted">{appt.location}{appt.notes ? ` — ${appt.notes}` : ""}</div>
                        </div>
                        <div className="item-actions">
                          <button type="button" className="icon-button" onClick={() => startEditAppt(appt)}>Edit</button>
                          <button type="button" className="icon-button danger-btn" onClick={() => void handleDeleteAppt(appt.appointment_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {apptMsg && !showApptForm ? <p className="status-error">{apptMsg}</p> : null}
              </section>
            </>
          ) : null}
        </section>

        <nav className="bottom-nav">
          <button
            type="button"
            className={activeTab === "home" ? "active" : ""}
            onClick={() => setActiveTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            className={activeTab === "chat" ? "active" : ""}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={activeTab === "health" ? "active" : ""}
            onClick={() => setActiveTab("health")}
          >
            Health
          </button>
          <button
            type="button"
            className={activeTab === "profile" ? "active" : ""}
            onClick={() => setActiveTab("profile")}
          >
            Profile
          </button>
        </nav>
      </div>
    </main>
  );
}
