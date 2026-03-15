"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type DoseEventItem,
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
  originalText?: string;
  timestamp: Date;
  lang?: string;
};

type ReminderResponseStatus = "taken" | "skipped" | "snoozed";
type ReminderMedication = Pick<MedicationItem, "medication_id" | "name" | "dose_text">;
type ReminderGroup = {
  scheduled_for: string;
  scheduled_label: string;
  medications: ReminderMedication[];
};

const SNOOZE_MINUTES = 5;

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

function normalizeHour(hour: string): string {
  return hour === "24" ? "00" : hour;
}

function getClockParts(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = normalizeHour(lookup.hour ?? "00");

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${hour}:${lookup.minute ?? "00"}`
  };
}

function buildScheduledFor(date: string, time: string): string {
  return `${date}T${time}:00`;
}

function formatScheduledLabel(scheduledFor: string): string {
  return scheduledFor.slice(11, 16);
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
      text: "Hello, I am here to support your medication routine today.",
      originalText: "Hello, I am here to support your medication routine today.",
      timestamp: new Date(),
    }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLang, setChatLang] = useState<"en" | "zh" | "yue" | "ms" | "ta" | "hi">("en");
  const [isRecording, setIsRecording] = useState(false);
  const [chatAudioLoading, setChatAudioLoading] = useState<number | null>(null);
  const [chatAudioPlaying, setChatAudioPlaying] = useState<number | null>(null);
  const [chatTranslating, setChatTranslating] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevChatLang = useRef(chatLang);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (prevChatLang.current === chatLang) return;
    prevChatLang.current = chatLang;

    const translateAll = async () => {
      setChatTranslating(true);
      try {
        const updated = await Promise.all(
          chatMessages.map(async (msg) => {
            if (msg.sender !== "bot") return msg;
            const source = msg.originalText || msg.text;
            if (chatLang === "en") {
              return { ...msg, text: source, lang: "en" };
            }
            try {
              const res = await api.postTranslate(source, chatLang);
              return { ...msg, text: res.translated_text, lang: chatLang };
            } catch {
              return msg;
            }
          })
        );
        setChatMessages(updated);
      } finally {
        setChatTranslating(false);
      }
    };

    void translateAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLang]);

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
  const [doseEvents, setDoseEvents] = useState<DoseEventItem[]>([]);
  const [reminderGroup, setReminderGroup] = useState<ReminderGroup | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

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
      setAllMeds((medsRes.value.items ?? []) as MedicationItem[]);
    } else {
      setMedications(null);
      setAllMeds([]);
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

  const loadDoseEvents = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const response = await api.getDoseEvents(userId, 7);
      setDoseEvents(response.items ?? []);
    } catch {
      setDoseEvents([]);
    }
  }, [userId]);

  useEffect(() => {
    void loadDashboard();
    void loadDoseEvents();
  }, [loadDashboard, loadDoseEvents]);

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
  const latestDoseEventBySlot = useMemo(() => {
    const latest = new Map<string, DoseEventItem>();
    for (const event of doseEvents) {
      if (!event.scheduled_for) {
        continue;
      }
      const key = `${event.medication_id}:${event.scheduled_for}`;
      const previous = latest.get(key);
      if (!previous || new Date(event.timestamp).getTime() > new Date(previous.timestamp).getTime()) {
        latest.set(key, event);
      }
    }
    return latest;
  }, [doseEvents]);
  const recentIntakeEvents = useMemo(
    () => doseEvents.filter((event) => event.response_status).slice(0, 4),
    [doseEvents]
  );

  const findDueReminderGroup = useCallback((): ReminderGroup | null => {
    const timezone = userProfile?.timezone || "Asia/Singapore";
    const medicationItems = medications?.items ?? [];
    if (medicationItems.length === 0) {
      return null;
    }

    const { date, time } = getClockParts(timezone);
    const dueGroups = new Map<string, ReminderMedication[]>();

    for (const medication of medicationItems) {
      const times = medication.schedule?.times ?? [];
      for (const scheduledTime of times) {
        if (!scheduledTime || scheduledTime > time) {
          continue;
        }

        const scheduledFor = buildScheduledFor(date, scheduledTime);
        const latestEvent = latestDoseEventBySlot.get(`${medication.medication_id}:${scheduledFor}`);

        if (latestEvent?.response_status === "taken" || latestEvent?.response_status === "skipped") {
          continue;
        }

        if (latestEvent?.response_status === "snoozed") {
          const snoozeUntil = new Date(latestEvent.timestamp).getTime() + SNOOZE_MINUTES * 60_000;
          if (Date.now() < snoozeUntil) {
            continue;
          }
        }

        const medsForSlot = dueGroups.get(scheduledFor) ?? [];
        medsForSlot.push({
          medication_id: medication.medication_id,
          name: medication.name,
          dose_text: medication.dose_text
        });
        dueGroups.set(scheduledFor, medsForSlot);
      }
    }

    const nextScheduledFor = [...dueGroups.keys()].sort()[0];
    if (!nextScheduledFor) {
      return null;
    }

    return {
      scheduled_for: nextScheduledFor,
      scheduled_label: formatScheduledLabel(nextScheduledFor),
      medications: dueGroups.get(nextScheduledFor) ?? []
    };
  }, [latestDoseEventBySlot, medications, userProfile]);

  useEffect(() => {
    const evaluateReminder = () => {
      const nextReminder = findDueReminderGroup();
      setReminderGroup((current) => {
        if (!nextReminder) {
          return null;
        }
        if (current?.scheduled_for === nextReminder.scheduled_for) {
          return current;
        }
        return nextReminder;
      });
    };

    evaluateReminder();
    const intervalId = window.setInterval(evaluateReminder, 30_000);

    return () => window.clearInterval(intervalId);
  }, [findDueReminderGroup]);

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

  async function handleSendChat(overrideMessage?: string, overrideLang?: string) {
    const message = (overrideMessage ?? chatDraft).trim();
    if (!message || !userId) {
      return;
    }

    const lang = overrideLang ?? chatLang;
    setChatMessages((prev) => [...prev, { id: Date.now(), sender: "user", text: message, timestamp: new Date() }]);
    setChatDraft("");
    setChatLoading(true);
    setChatError(null);

    try {
      const response = await api.postChat(userId, message, lang);
      setChatResult(response);
      setChatMessages((prev) => [...prev, { id: Date.now() + 1, sender: "bot", text: response.reply, originalText: response.reply_en || response.reply, timestamp: new Date(), lang: response.language || lang }]);
    } catch (error) {
      const msg = safeMessage(error);
      setChatError(msg);
      setChatMessages((prev) => [...prev, { id: Date.now() + 2, sender: "bot", text: `Sorry, ${msg}`, timestamp: new Date() }]);
    } finally {
      setChatLoading(false);
    }
  }

  const LANG_SPEECH_MAP: Record<string, string> = {
    en: "en-SG",
    zh: "zh-CN",
    yue: "zh-HK",
    ms: "ms-MY",
    ta: "ta-SG",
    hi: "hi-IN",
  };

  function detectLangFromText(text: string): "en" | "zh" | "ms" | "ta" {
    if (/[\u4e00-\u9fff]/.test(text)) return "zh";
    if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
    const lower = text.toLowerCase();
    if (/\b(saya|makan|terima|kasih|apa|boleh|tidak)\b/.test(lower)) return "ms";
    return "en";
  }

  function handleVoiceInput() {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setChatError("Voice input is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isRecording) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = LANG_SPEECH_MAP[chatLang] || "en-SG";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    setIsRecording(true);
    setChatError(null);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        const detected = detectLangFromText(transcript);
        if (detected !== chatLang) {
          setChatLang(detected);
        }
        void handleSendChat(transcript, detected);
      }
      setIsRecording(false);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        setChatError(`Voice error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
  }

  async function handlePlayChatAudio(msgId: number, text: string, lang?: string) {
    if (chatAudioPlaying === msgId) return;
    setChatAudioLoading(msgId);
    try {
      const blob = await api.postTTS(text, lang || "en");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setChatAudioPlaying(msgId);
      setChatAudioLoading(null);
      audio.onended = () => { setChatAudioPlaying(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setChatAudioPlaying(null); URL.revokeObjectURL(url); };
      audio.play().catch(() => setChatAudioPlaying(null));
    } catch (error) {
      setChatError(`Audio: ${safeMessage(error)}`);
      setChatAudioLoading(null);
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
      void loadDashboard();
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
      void loadDashboard();
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

  async function handleReminderResponse(responseStatus: ReminderResponseStatus) {
    if (!userId || !reminderGroup) {
      return;
    }

    setReminderBusy(true);
    setReminderError(null);

    try {
      const response = await api.postMedicationIntake(userId, {
        medication_ids: reminderGroup.medications.map((medication) => medication.medication_id),
        scheduled_for: reminderGroup.scheduled_for,
        response_status: responseStatus,
        source: "dashboard_popup"
      });

      setDoseEvents((current) => [...response.items, ...current]);
      setReminderGroup(null);
      void loadDashboard();
    } catch (error) {
      setReminderError(safeMessage(error));
    } finally {
      setReminderBusy(false);
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
            <section className="chat-fullpage">
              <div className="chat-topbar">
                <div className="chat-topbar-left">
                  <div className="chat-avatar">BC</div>
                  <div>
                    <div className="chat-topbar-name">ByteCare</div>
                    <div className="chat-topbar-status"><span className="live-dot" /> Online</div>
                  </div>
                </div>
                <select
                  className="chat-lang-select"
                  value={chatLang}
                  onChange={(e) => setChatLang(e.target.value as "en" | "zh" | "yue" | "ms" | "ta" | "hi")}
                >
                  <option value="en">SG English</option>
                  <option value="zh">普通话 Mandarin</option>
                  <option value="yue">廣東話 Cantonese</option>
                  <option value="ms">Bahasa Melayu</option>
                  <option value="ta">தமிழ் Tamil</option>
                  <option value="hi">हिन्दी Hindi</option>
                </select>
              </div>

              <div className="chat-session-notice">
                Chat history is not saved. Messages will be cleared when you leave this page.
              </div>

              {chatTranslating ? (
                <div className="chat-translating-notice">Translating messages…</div>
              ) : null}

              <div className="chat-messages">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={message.sender === "user" ? "chat-row user" : "chat-row bot"}
                  >
                    {message.sender === "bot" ? (
                      <div className="chat-bubble-group">
                        <div className="bubble bubble-bot">
                          <div className="bubble-text">{message.text}</div>
                          <span className="bubble-time">
                            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="bubble-audio-btn"
                          onClick={() => void handlePlayChatAudio(message.id, message.text, message.lang || chatLang)}
                          disabled={chatAudioLoading === message.id || chatAudioPlaying === message.id}
                          title={chatAudioPlaying === message.id ? "Playing..." : "Listen"}
                        >
                          {chatAudioLoading === message.id ? (
                            <span className="audio-spinner" />
                          ) : chatAudioPlaying === message.id ? (
                            "🔊"
                          ) : (
                            "▶"
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="bubble bubble-user">
                        <div className="bubble-text">{message.text}</div>
                        <span className="bubble-time">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading ? (
                  <div className="chat-row bot">
                    <div className="chat-bubble-group">
                      <div className="bubble bubble-bot">
                        <div className="typing-dots"><span /><span /><span /></div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-input-bar">
                <input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder="Type a message..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendChat();
                    }
                  }}
                  disabled={chatLoading}
                />
                <button
                  type="button"
                  className={`mic-btn ${isRecording ? "mic-recording" : ""}`}
                  onClick={handleVoiceInput}
                  disabled={chatLoading || isRecording}
                  title={isRecording ? "Listening..." : "Voice input"}
                >
                  {isRecording ? "⏺" : "🎤"}
                </button>
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => void handleSendChat()}
                  disabled={chatLoading || !chatDraft.trim()}
                >
                  {chatLoading ? "…" : "➤"}
                </button>
              </div>
              {chatError ? <p className="chat-error">{chatError}</p> : null}
            </section>
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
                {recentIntakeEvents.length > 0 ? (
                  <div className="reminder-history">
                    {recentIntakeEvents.map((event) => (
                      <div key={event.event_id} className="reminder-history-row">
                        <span className="muted">{formatScheduledLabel(event.scheduled_for || event.timestamp)}</span>
                        <span className={`intake-status intake-${event.response_status || "taken"}`}>
                          {event.response_status || event.event_type}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
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

        {reminderGroup ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section
              className="medication-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="medication-reminder-title"
            >
              <p className="modal-kicker">Medication reminder</p>
              <h2 id="medication-reminder-title">Have you taken your medication?</h2>
              <p className="muted">
                Scheduled for {reminderGroup.scheduled_label}. This reminder stays active until you respond.
              </p>

              <div className="medication-modal-list">
                {reminderGroup.medications.map((medication) => (
                  <div key={medication.medication_id} className="medication-modal-item">
                    <strong>{medication.name}</strong>
                    <span>{medication.dose_text || "Dose not specified"}</span>
                  </div>
                ))}
              </div>

              {reminderError ? <p className="status-error modal-status">{reminderError}</p> : null}

              <div className="medication-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleReminderResponse("snoozed")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : `Snooze ${SNOOZE_MINUTES} min`}
                </button>
                <button
                  type="button"
                  className="skip-button"
                  onClick={() => void handleReminderResponse("skipped")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : "Skip"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleReminderResponse("taken")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : "Taken"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
