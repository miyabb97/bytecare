"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  api,
  type AppointmentResponse,
  type ChatResponse,
  type CommunityResponse,
  type DriftResponse,
  type FoodResponse,
  type MedicationListResponse,
  type NextActionResponse,
  type ReportSummaryResponse,
  type TCMResponse,
  type UserProfile,
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
  const [reportSummary, setReportSummary] = useState<ReportSummaryResponse | null>(null);

  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

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

  const [herb, setHerb] = useState("ginseng");
  const [tcmResult, setTCMResult] = useState<TCMResponse | null>(null);
  const [tcmLoading, setTCMLoading] = useState(false);
  const [tcmError, setTCMError] = useState<string | null>(null);

  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!userId) {
      return;
    }

    setDashboardLoading(true);
    setDashboardError(null);

    const [userRes, medsRes, driftRes, nextRes, foodRes, appointmentRes, communityRes] = await Promise.allSettled([
      api.getUser(userId),
      api.getMedications(userId),
      api.getDrift(userId),
      api.getNextAction(userId),
      api.getFoodRecommendations(userId),
      api.getAppointments(userId),
      api.getCommunityEvents(userId)
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

  const primaryEvent = community?.events?.[0] ?? null;
  const medicationCount = medications?.items?.length ?? 0;

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
    const herbText = herb.trim();
    if (!herbText || !userId) {
      return;
    }

    setTCMLoading(true);
    setTCMError(null);

    try {
      const response = await api.postTCMCheck(userId, herbText);
      setTCMResult(response);
    } catch (error) {
      setTCMError(safeMessage(error));
    } finally {
      setTCMLoading(false);
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

  if (!userId) {
    return (
      <main className="demo-shell">
        <div className="phone-frame auth-frame">
          <section className="tab-body">
            <section className="card">
              <h2 className="auth-title">Invalid patient selection</h2>
              <p className="muted">No user id was provided in the dashboard route.</p>
              <button type="button" onClick={() => router.push("/")}>Back to User Selection</button>
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
                <p className="muted">Condition signal: {food?.condition ?? "Not available"}</p>
                <p className="primary-text">{medicationCount} medications active</p>
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
                <div className="card-title">Voice Transcript Analysis</div>
                <textarea
                  value={voiceTranscript}
                  onChange={(event) => setVoiceTranscript(event.target.value)}
                  placeholder='Example: "I forgot my medicine today lah."'
                />
                <button type="button" onClick={() => void handleAnalyzeVoice()} disabled={voiceLoading}>
                  {voiceLoading ? "Analyzing..." : "Analyze Voice"}
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

              <section className="card">
                <div className="card-title">TCM Safety Check</div>
                <input value={herb} onChange={(event) => setHerb(event.target.value)} placeholder="e.g. ginseng" />
                <button type="button" onClick={() => void handleTCMCheck()} disabled={tcmLoading}>
                  {tcmLoading ? "Checking..." : "Check Herb"}
                </button>
                {tcmError ? <p className="status-error">{tcmError}</p> : null}
                {tcmResult ? (
                  <div className={`alert-box ${tcmResult.interaction_warning ? "alert-danger" : "alert-safe"}`}>
                    <p>{tcmResult.interaction_warning ? "Interaction Warning" : "No Major Warning"}</p>
                    <p>{tcmResult.message}</p>
                  </div>
                ) : null}
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
                {primaryEvent ? (
                  <>
                    <h3>{primaryEvent.title}</h3>
                    <p className="muted">
                      {primaryEvent.date} at {primaryEvent.location}
                    </p>
                    <p className="muted">{primaryEvent.reason}</p>
                  </>
                ) : (
                  <p className="muted">No events available.</p>
                )}
              </section>
            </>
          ) : null}

          {activeTab === "chat" ? (
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
          ) : null}

          {activeTab === "health" ? (
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
          ) : null}

          {activeTab === "profile" ? (
            <section className="card">
              <div className="card-title">Selected Profile</div>
              <p className="muted">Name: {userProfile?.name ?? "-"}</p>
              <p className="muted">Age: {userProfile?.age ?? "-"}</p>
              <p className="muted">Timezone: {userProfile?.timezone ?? "-"}</p>
              <p className="muted">User ID: {userId}</p>
              <button type="button" className="secondary-button" onClick={() => router.push("/")}>Switch Patient</button>
            </section>
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
