"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  Mic,
  Search,
  Settings,
  TriangleAlert,
  User,
  Utensils
} from "lucide-react";
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

type Tab = "home" | "chat" | "events" | "health" | "profile";
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

const PROFILE_IMAGE_URL = "https://lh3.googleusercontent.com/aida-public/AB6AXuDrpjijg5RYen-KEp80Ku17lHJt6RK6oQ8jsW9yOGV8G22INjaHluVxszAVSYh7377YZduJY0z1JadmjpP-_slJeGgQKFmm53tOjbijQFoPrqrf32G8qlRqKcx5fRUjfVjGlREMUBlc9xtjTdcHypDPv6OA4gWbCQ2VxJVehPCypeFLrmiGy3QwVzlKW5gKU4PVT0_SQBD3riOiporPY9unbl6_T7IjdEnwDL7j1yxZItw3L9Fgj9T6Q8f8esWe3APv7JdvBOUrA0M";
const IMAGE_WALK = "https://lh3.googleusercontent.com/aida-public/AB6AXuAVNP892HZuLcbaTsZyc-eOMPlYKDMlqVdP8ybsdVb0P1LZ6ug1VbuJgmaUGiqhMRe5x6J1iiLvm3WoSUQdUZQcnFbsq7ITJTq6mRYdfqHtLPGx-_sxdDCm5L3btLTI7HStACdyt49FXrTIAaaZzYAUxW2brjZZMGXVbX_FzFWxte_JaGXr5wQepX-cc_Lrot54PUiK5B-uSnldnT6OnrQTs_il1EbTxYpYop22BsDCibjOX49JtovQHcfTqTkd7XeeLSJGxgpP_dM";
const IMAGE_TAI_CHI = "https://lh3.googleusercontent.com/aida-public/AB6AXuA3YolzPqhmPsepHcKCNeiXvywh-4SmaMp4_WdWbln4_lyFbklKzB9EOtjAPGYN_rbWybaVuXmZDQmNkonLqc593lRpRfrTbMRluqYuW3tvwHkzyVPO5jp2nUf6TCFC48TX9xDrJu6bw0fob2ND-eXkQhlDQG84otSIfX1lBKh1aPxuh9jnH1yoc7GKSRrCg0QjpvKlLonHjpChtDQOe1M0aIRCB73rjG3uuF3hZMnzP1XxOV7zBlPH4A-ve-5nzyHW1n2Kb27_PKk";
const IMAGE_COOKING = "https://lh3.googleusercontent.com/aida-public/AB6AXuBpTeUp98FkA_ijR4sKh9qL3wEqou6Af_Wd1AG7ALOUOnS6LXcC3KMY9CI0WqHvqbty9JM28p60IhnEq4D_m62M71bVaabYuZeg99AKdjn9Y9guhYmaCVhSoptJDwyUU1B_XFSApLn_Y_j5BV8hu4QzqcKomqmc5Me5zXNXRSo4_RIBkK-RBcjf7Vw1xOA4vbU4WOYMZEvMPiG9OU4FpUWKXh22gbqkCbGRQbH7Nj0MszNOcVbVJlyE83xNHgFE_az2edlt3DCN0kM";

function eventImageFor(event: CommunityEventItem): string {
  const title = event.title.toLowerCase();
  if (title.includes("walk")) return IMAGE_WALK;
  if (title.includes("tai chi")) return IMAGE_TAI_CHI;
  if (title.includes("cook")) return IMAGE_COOKING;
  const type = event.type.toLowerCase();
  if (type.includes("education")) return IMAGE_COOKING;
  if (type.includes("exercise")) return IMAGE_TAI_CHI;
  return IMAGE_WALK;
}

function eventTagFor(event: CommunityEventItem): string {
  const title = event.title.toLowerCase();
  if (title.includes("walk")) return "HEALTH FOCUSED";
  if (title.includes("tai chi")) return "MOBILITY";
  if (title.includes("cook")) return "NUTRITION";
  if (event.type.toLowerCase().includes("social")) return "SOCIAL";
  return event.type.toUpperCase();
}

function formatEventTimeShort(value: string): string {
  return new Date(value)
    .toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(",", "");
}

function isDietChangeSuggestion(item: string): boolean {
  const text = item.toLowerCase();
  return [
    "reduce",
    "avoid",
    "limit",
    "cut",
    "less",
    "sugary",
    "salt",
    "fried",
    "processed"
  ].some((keyword) => text.includes(keyword));
}

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const common = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...common} />;
  if (tab === "chat") return <MessageSquare {...common} />;
  if (tab === "events") return <CalendarDays {...common} />;
  if (tab === "health") return <Heart {...common} />;
  return <User {...common} />;
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

async function getMyCommunityEventsSafe(userId: string): Promise<CommunityMyEventsResponse> {
  const maybeFn = (api as { getMyCommunityEvents?: (id: string) => Promise<CommunityMyEventsResponse> })
    .getMyCommunityEvents;
  if (typeof maybeFn === "function") {
    return maybeFn(userId);
  }
  return { joined: [], saved: [] };
}

async function postCancelCommunityEventSafe(userId: string, eventId: string): Promise<void> {
  const maybeFn = (api as { postCancelCommunityEvent?: (id: string, event: string) => Promise<unknown> })
    .postCancelCommunityEvent;
  if (typeof maybeFn === "function") {
    await maybeFn(userId, eventId);
  }
}

export default function DashboardPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [tcmLang, setTcmLang] = useState<"en" | "zh" | "yue" | "ms" | "ta" | "hi">("en");
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

  useEffect(() => {
    const tabFromQuery = searchParams.get("tab");
    if (tabFromQuery === "home" || tabFromQuery === "chat" || tabFromQuery === "events" || tabFromQuery === "health" || tabFromQuery === "profile") {
      setActiveTab(tabFromQuery);
    }
  }, [searchParams]);

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
      getMyCommunityEventsSafe(userId)
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
  const homeEventsPreview = recommendedEvents.slice(0, 2);
  const recommendedEventsPanel = recommendedEvents.slice(0, 3);
  const joinedEvents = myCommunityEvents?.joined ?? [];
  const voicePreviewText = voiceResult?.cleaned_text ?? "I forgot my medicine today lah.";
  const voicePreviewLanguage = voiceResult?.language_hint ?? "Singlish";
  const voicePreviewEmotion = voiceResult?.emotion_tag ?? "Anxious";
  const voicePreviewIntent = voiceResult?.intent ?? "Seeking advice";
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
        getMyCommunityEventsSafe(userId)
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
        await postCancelCommunityEventSafe(userId, event.event_id);
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
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="relative min-h-screen w-full max-w-md bg-slate-100 pb-24">
        {activeTab === "events" ? (
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-5">
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab("home")}
                className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
              >
                <ArrowLeft size={22} />
              </button>
              <h1 className="text-[2rem] font-bold leading-none tracking-tight text-slate-900">Jio Events</h1>
            </div>
            <p className="text-[0.77rem] text-slate-600">
              Discover nearby activities to stay healthy and connected.
            </p>
          </header>
        ) : (
          <header className="app-header">
            <div className="header-left">
              <Image
                src={PROFILE_IMAGE_URL}
                alt="ByteCare logo"
                width={38}
                height={38}
                className="h-[2.35rem] w-[2.35rem] rounded-full border-2 border-blue-100 object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="header-copy">
                <h1>ByteCare</h1>
                <p className="muted">{userProfile?.name ?? "Loading profile..."}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => void loadDashboard()}
              className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
            >
              <Settings size={20} />
            </button>
          </header>
        )}

        {dashboardLoading ? <p className="px-4 pt-2 text-xs text-emerald-700">Loading dashboard...</p> : null}
        {dashboardError ? <p className="px-4 pt-2 text-xs text-red-700">{dashboardError}</p> : null}

        <section
          key={activeTab}
          className={`tc-motion-stack ${activeTab === "events" ? "space-y-5 px-4 py-6" : "space-y-4 px-4 py-4"}`}
        >
          {activeTab === "home" ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
                    <User className="text-blue-600" size={30} />
                  </div>
                  <div>
                    <h2 className="text-[1.6rem] font-bold leading-tight text-slate-900">{userProfile?.name ?? "-"}, {userProfile?.age ?? "-"}</h2>
                    <p className="text-sm text-slate-500">
                      {userProfile?.conditions && userProfile.conditions.length > 0 ? userProfile.conditions.join(", ") : food?.condition ?? "No condition data"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-blue-600">{medicationCount} Medications Active</p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="text-[1.38rem] font-bold leading-none text-slate-900">Medication Adherence</h3>
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-600">
                    Severity: {(drift?.severity ?? "red").replace(/^./, (s) => s.toUpperCase())}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <TriangleAlert size={18} className="text-amber-500" />
                  <p className="text-sm italic">Drift detected: {drift?.drift_detected ? "Yes" : "No"}</p>
                </div>
                <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                  <p className="text-sm font-medium text-blue-600">Next action: {nextAction?.next_action ?? "Reminder needed"}</p>
                </div>
              </section>

              <section className="relative overflow-hidden rounded-3xl bg-blue-600 p-5 text-white shadow-lg">
                <div className="relative z-10">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-[0.11em] opacity-85">Upcoming Visit</span>
                    <Clock3 size={16} className="opacity-80" />
                  </div>
                  <h3 className="text-[1.45rem] font-bold leading-tight">{appointments?.next_appointment?.location ?? "Polyclinic Visit"}</h3>
                  <p className="mt-1 text-sm opacity-90">{appointments?.next_appointment ? formatDateTime(appointments.next_appointment.datetime) : appointmentText}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-5xl font-bold leading-none">{appointments?.days_remaining ?? "-"}</span>
                    <span className="text-sm opacity-85">days to go</span>
                  </div>
                </div>
                <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Mic className="text-blue-600" size={18} />
                  <h3 className="text-[1.3rem] font-bold leading-none text-slate-900">Voice Input Analysis</h3>
                </div>
                <p className="mb-4 rounded-2xl border-l-4 border-blue-200 bg-slate-100 p-3 text-sm italic text-slate-700">
                  "{voicePreviewText}"
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-600">{voicePreviewLanguage}</span>
                  <span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-xs text-orange-600">{voicePreviewEmotion}</span>
                  <span className="rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-xs text-blue-600">{voicePreviewIntent}</span>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Search className="text-slate-700" size={18} />
                  <h3 className="text-[1.3rem] font-bold leading-none text-slate-900">TCM Safety Check</h3>
                </div>
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                  <div className="flex gap-2">
                    <TriangleAlert size={18} className="mt-0.5 text-amber-500" />
                    <div>
                      <p className="text-sm font-bold text-red-700">Interaction Warning</p>
                      <p className="text-xs text-red-600">
                        {tcmResult?.message ?? "May interact with blood thinners. Consult your doctor."}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Utensils className="text-emerald-500" size={18} />
                  <h3 className="text-[1.3rem] font-bold leading-none text-slate-900">Diet Suggestions</h3>
                </div>
                <ul className="space-y-2">
                  {(food?.recommendations ?? []).slice(0, 3).map((item) => {
                    const needsChange = isDietChangeSuggestion(item);
                    return (
                      <li
                        key={item}
                        className={`flex items-center gap-3 text-sm ${needsChange ? "font-medium text-red-500" : "text-slate-700"}`}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${needsChange ? "bg-red-500" : "bg-emerald-500"}`} />
                        {item}
                      </li>
                    );
                  })}
                  {(food?.recommendations ?? []).length === 0 ? <li className="text-sm text-slate-500">No diet suggestions available.</li> : null}
                </ul>
              </section>

              <section className="space-y-4">
                {homeEventsPreview.map((event, index) => {
                  const isJoined = joinedEventIds.has(event.event_id);
                  const isLoading = communityActionLoading === event.event_id;
                  return (
                    <article
                      key={event.event_id}
                      className="tc-animated-card tc-fade-item overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                      style={{ animationDelay: `${80 + index * 60}ms` }}
                    >
                      <div className="relative h-32">
                        <Image
                          src={eventImageFor(event)}
                          alt={event.title}
                          fill
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
                        <div className="absolute bottom-3 left-4 text-white">
                          <h4 className="text-[1.52rem] font-bold leading-tight">{event.title}</h4>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-4">
                        <div className="space-y-1 text-xs text-slate-500">
                          <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(event.datetime)}</div>
                          <div className="flex items-center gap-1"><MapPin size={12} /> {event.location}</div>
                        </div>
                        <button
                          type="button"
                          className="tc-btn tc-btn-primary"
                          onClick={() => void handleToggleCommunityEvent(event)}
                          disabled={isLoading}
                        >
                          {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          {activeTab === "events" ? (
            <>
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[1.5rem] font-bold leading-none text-slate-900">Recommended For You</h2>
                  <button
                    type="button"
                    className="tc-btn-link"
                    onClick={() => router.push(`/dashboard/${encodeURIComponent(userId)}/events`)}
                  >
                    See all
                  </button>
                </div>
                {communityActionError ? <p className="mb-2 text-xs text-red-700">{communityActionError}</p> : null}
                <div className="space-y-4">
                  {recommendedEventsPanel.map((event, index) => {
                    const isJoined = joinedEventIds.has(event.event_id);
                    const isLoading = communityActionLoading === event.event_id;
                    return (
                      <article
                        key={event.event_id}
                        className="tc-animated-card tc-fade-item overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                        style={{ animationDelay: `${80 + index * 60}ms` }}
                      >
                        <div className="relative h-32">
                          <Image
                            src={eventImageFor(event)}
                            alt={event.title}
                            fill
                            className="object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                          <div className="absolute right-3 top-3 rounded-md border border-white/25 bg-white/25 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
                            {eventTagFor(event)}
                          </div>
                          <div className="absolute bottom-3 left-4 text-white">
                            <h4 className="text-[1.5rem] font-bold leading-tight">{event.title}</h4>
                          </div>
                        </div>
                        <div className="p-4">
                          {event.reason ? <p className="mb-3 text-[10px] italic text-slate-500">{event.reason}</p> : null}
                          <div className="flex items-center justify-between">
                            <div className="space-y-1 text-xs text-slate-500">
                              <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(event.datetime)}</div>
                              <div className="flex items-center gap-1"><MapPin size={12} /> {event.location}</div>
                            </div>
                            <button
                              type="button"
                              className="tc-btn tc-btn-primary"
                              onClick={() => void handleToggleCommunityEvent(event)}
                              disabled={isLoading}
                            >
                              {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {recommendedEventsPanel.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No recommended events available.</p> : null}
              </section>

              <section>
                <h2 className="mb-4 text-[1.5rem] font-bold leading-none text-slate-900">My Events</h2>
                {joinedEvents.length > 0 ? (
                  <article className="tc-animated-card tc-fade-item overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="relative h-32">
                      <Image
                        src={PROFILE_IMAGE_URL}
                        alt={joinedEvents[0].title}
                        fill
                        className="object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <div className="absolute left-4 top-3 inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                        <span aria-hidden="true">✓</span> Joined
                      </div>
                      <div className="absolute bottom-3 left-4 text-white">
                        <h4 className="text-[1.5rem] font-bold leading-tight">{joinedEvents[0].title}</h4>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4">
                      <div className="space-y-1 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(joinedEvents[0].datetime)}</div>
                        <div className="flex items-center gap-1"><MapPin size={12} /> {joinedEvents[0].location}</div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className="tc-btn tc-btn-secondary">Details</button>
                        <button
                          type="button"
                          className="tc-btn tc-btn-danger"
                          onClick={() => void handleToggleCommunityEvent(joinedEvents[0])}
                          disabled={communityActionLoading === joinedEvents[0].event_id}
                        >
                          {communityActionLoading === joinedEvents[0].event_id ? "Updating..." : "Cancel"}
                        </button>
                      </div>
                    </div>
                  </article>
                ) : (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No joined events yet.</p>
                )}
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
                            const lang = e.target.value as "en" | "zh" | "yue" | "ms" | "ta" | "hi";
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
                          <option value="zh">普通话 (Mandarin)</option>
                          <option value="yue">廣東話 (Cantonese)</option>
                          <option value="ms">Bahasa Melayu (Malay)</option>
                          <option value="ta">தமிழ் (Tamil)</option>
                          <option value="hi">हिन्दी (Hindi)</option>
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
                    <p className="muted profile-user-id">User ID: {userId}</p>
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

        <nav className="tc-bottom-nav fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 items-center justify-between border-t border-slate-200 bg-white px-5 py-2">
          <button
            type="button"
            className={`flex flex-col items-center gap-1 ${activeTab === "home" ? "text-blue-600" : "text-slate-400 hover:text-blue-500"}`}
            onClick={() => setActiveTab("home")}
          >
            <BottomNavIcon tab="home" active={activeTab === "home"} />
            <span className={`text-[11px] ${activeTab === "home" ? "font-medium" : "font-normal"}`}>Home</span>
          </button>
          <button
            type="button"
            className={`flex flex-col items-center gap-1 ${activeTab === "chat" ? "text-blue-600" : "text-slate-400 hover:text-blue-500"}`}
            onClick={() => setActiveTab("chat")}
          >
            <BottomNavIcon tab="chat" active={activeTab === "chat"} />
            <span className={`text-[11px] ${activeTab === "chat" ? "font-medium" : "font-normal"}`}>Chat</span>
          </button>
          <button
            type="button"
            className={`flex flex-col items-center gap-1 ${activeTab === "events" ? "text-blue-600" : "text-slate-400 hover:text-blue-500"}`}
            onClick={() => setActiveTab("events")}
          >
            <BottomNavIcon tab="events" active={activeTab === "events"} />
            <span className={`text-[11px] ${activeTab === "events" ? "font-medium" : "font-normal"}`}>Events</span>
          </button>
          <button
            type="button"
            className={`flex flex-col items-center gap-1 ${activeTab === "health" ? "text-blue-600" : "text-slate-400 hover:text-blue-500"}`}
            onClick={() => setActiveTab("health")}
          >
            <BottomNavIcon tab="health" active={activeTab === "health"} />
            <span className={`text-[11px] ${activeTab === "health" ? "font-medium" : "font-normal"}`}>Health</span>
          </button>
          <button
            type="button"
            className={`flex flex-col items-center gap-1 ${activeTab === "profile" ? "text-blue-600" : "text-slate-400 hover:text-blue-500"}`}
            onClick={() => setActiveTab("profile")}
          >
            <BottomNavIcon tab="profile" active={activeTab === "profile"} />
            <span className={`text-[11px] ${activeTab === "profile" ? "font-medium" : "font-normal"}`}>Profile</span>
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
