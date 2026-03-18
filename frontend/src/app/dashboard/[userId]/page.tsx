"use client";

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Brain,
  Camera,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  Clock3,
  FileText,
  Heart,
  HelpCircle,
  Home,
  Info,
  Leaf,
  LogOut,
  MapPin,
  MessageSquare,
  Mic,
  Package,
  Pencil,
  PhoneCall,
  Pill,
  Play,
  Scan,
  SendHorizonal,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  User,
  Volume2,
  XCircle,
  Utensils,
  Sparkles
} from "lucide-react";
import {
  api,
  type Account,
  type AdaptiveTimingItem,
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
  type MEEScoreResponse,
  type NextActionResponse,
  type OrchestrateResponse,
  type NutritionScanResult,
  type RefillStatusItem,
  type ReportSummaryResponse,
  type TCMResponse,
  type UserProfile,
  type VoiceAgentResponse,
  type VoiceResponse,
  type LearningEvidenceResponse,
  type LearningEvidenceMed,
} from "../../../lib/api";

type Tab = "home" | "chat" | "events" | "health" | "profile";
type ChatMessage = {
  id: number;
  sender: "user" | "bot" | "system";
  text: string;
  originalText?: string;
  timestamp: Date;
  lang?: string;
  quickReplies?: string[];
  navigation?: { label: string; route: string; tab?: string } | null;
};

type ReminderResponseStatus = "taken" | "snoozed" | "not_taken";
type ReminderMedication = Pick<MedicationItem, "medication_id" | "name" | "dose_text">;
type ReminderGroup = {
  scheduled_for: string;
  scheduled_label: string;
  medications: ReminderMedication[];
};

const QUICK_FOOD_QUESTIONS = [
  "Can I eat laksa today?",
  "Is bubble tea okay for me?",
  "Can I eat spinach today?",
  "What should I eat for dinner?",
  "Can I eat this after taking my medicine?",
  "Show healthier alternatives",
];

const SNOOZE_MINUTES = 5;

function formatTimerLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes}m ${rem}s`;
}

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

function toCalendarStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildCalendarUrl(appointment: { datetime: string; location: string; notes?: string }): string {
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
    return "Please fast for 8-10 hours before your appointment. Only plain water is allowed.";
  }
  return "Please arrive 10 minutes early and bring any relevant medication or test records.";
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

function getRiskLevel(score?: number | null): "HIGH" | "MEDIUM" | "LOW" {
  if ((score ?? 0) < 50) return "HIGH";
  if ((score ?? 0) < 75) return "MEDIUM";
  return "LOW";
}

function friendlyActionLabel(action?: string | null): string {
  switch (action) {
    case "gentle_reminder":  return "Gentle reminder sent";
    case "chatbot_support":  return "Support message sent";
    case "caregiver_alert":  return "Caregiver alerted";
    case "none":             return "On track";
    default:                 return action?.replace(/_/g, " ") ?? "Reminder needed";
  }
}

function getAdherenceRate(counts?: {
  taken: number;
  not_taken: number;
  late: number;
  missed?: number;
  skipped?: number;
  snoozed?: number;
} | null): number {
  if (!counts) return 0;
  const notTaken = (counts.not_taken ?? 0) + (counts.missed ?? 0) + (counts.skipped ?? 0);
  const total = counts.taken + counts.late + notTaken;
  if (total <= 0) return 0;
  return Math.round(((counts.taken + 0.5 * counts.late) / total) * 100);
}

function intakeStatusMeta(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "taken") {
    return {
      label: "Taken",
      icon: CheckCircle2,
      iconClass: "text-emerald-500",
      chipClass: "bg-emerald-50 text-emerald-600",
    };
  }
  if (normalized === "late" || normalized === "snoozed") {
    return {
      label: normalized === "late" ? "Late" : "Snoozed",
      icon: Clock3,
      iconClass: "text-amber-500",
      chipClass: "bg-amber-50 text-amber-600",
    };
  }
  return {
    label: "Not Taken",
    icon: XCircle,
    iconClass: "text-red-500",
    chipClass: "bg-red-50 text-red-600",
  };
}

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const common = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...common} />;
  if (tab === "chat") return <MessageSquare {...common} />;
  if (tab === "events") return <CalendarDays {...common} />;
  if (tab === "health") return <Heart {...common} />;
  return <User {...common} />;
}

function QuickActionTile({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tone: "blue" | "violet" | "teal" | "orange" | "green" | "red" | "purple";
  onClick: () => void;
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
    teal: "bg-teal-50 text-teal-600",
    orange: "bg-orange-50 text-orange-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "auto", background: "transparent", marginTop: 0, padding: 0, borderRadius: 0 }}
      className="group flex flex-col items-center gap-2 rounded-2xl p-2.5 transition active:scale-95"
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-105 ${tones[tone]}`}>
        {icon}
      </div>
      <span className="text-center text-[10px] font-semibold leading-tight text-slate-600">{label}</span>
    </button>
  );
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

function formatReminderStatusLabel(status: ReminderResponseStatus | string): string {
  if (status === "snoozed") return "Take later";
  if (status === "not_taken") return "Not taken";
  if (status === "late") return "Late";
  return status.charAt(0).toUpperCase() + status.slice(1);
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

  // Read account from session for role checks
  const [accountRole, setAccountRole] = useState<string>("patient");
  useEffect(() => {
    const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
    if (raw) {
      try { setAccountRole((JSON.parse(raw) as Account).role); } catch { }
    }
  }, []);

  const [activeTab, setActiveTab] = useState<Tab>("home");

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [medications, setMedications] = useState<MedicationListResponse | null>(null);
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [nextAction, setNextAction] = useState<NextActionResponse | null>(null);
  const [food, setFood] = useState<FoodResponse | null>(null);
  const [nutritionScanResult, setNutritionScanResult] = useState<NutritionScanResult | null>(null);
  const [nutritionCheckLoading, setNutritionCheckLoading] = useState(false);
  const [nutritionCheckError, setNutritionCheckError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentResponse | null>(null);
  const [community, setCommunity] = useState<CommunityResponse | null>(null);
  const [myCommunityEvents, setMyCommunityEvents] = useState<CommunityMyEventsResponse | null>(null);
  const [reportSummary, setReportSummary] = useState<ReportSummaryResponse | null>(null);

  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [communityActionLoading, setCommunityActionLoading] = useState<string | null>(null);
  const [communityActionError, setCommunityActionError] = useState<string | null>(null);
  const [joinConfirmEvent, setJoinConfirmEvent] = useState<CommunityEventItem | null>(null);

  const [chatDraft, setChatDraft] = useState("");
  const [chatResult, setChatResult] = useState<ChatResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: "bot",
      text: "Hello! I am ByteCare, your health companion. I can help with your medications, appointments, food advice, events, and more. How can I help you today?",
      originalText: "Hello! I am ByteCare, your health companion. I can help with your medications, appointments, food advice, events, and more. How can I help you today?",
      timestamp: new Date(),
    }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLang, setChatLang] = useState<"en" | "zh" | "yue" | "ms" | "ta" | "hi">("en");
  const [isRecording, setIsRecording] = useState(false);
  const [showQuickFoodQuestions, setShowQuickFoodQuestions] = useState(true);
  const [translatedFoodQuestions, setTranslatedFoodQuestions] = useState<string[]>(QUICK_FOOD_QUESTIONS);
  const [chatAudioLoading, setChatAudioLoading] = useState<number | null>(null);
  const [chatAudioPlaying, setChatAudioPlaying] = useState<number | null>(null);
  const [chatTranslating, setChatTranslating] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const bottomNavRef = useRef<HTMLDivElement>(null);
  const prevChatLang = useRef(chatLang);
  const nutritionImageInputRef = useRef<HTMLInputElement>(null);
  const [bottomNavBounds, setBottomNavBounds] = useState<{ left: number; width: number } | null>(null);
  const [bottomNavHeight, setBottomNavHeight] = useState(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    const updateBottomNavBounds = () => {
      const shell = shellRef.current;
      const nav = bottomNavRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      setBottomNavBounds({ left: rect.left, width: rect.width });
      if (nav) {
        setBottomNavHeight(nav.getBoundingClientRect().height);
      }
    };

    updateBottomNavBounds();

    window.addEventListener("resize", updateBottomNavBounds);
    window.addEventListener("scroll", updateBottomNavBounds, { passive: true });

    const shell = shellRef.current;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && shell
        ? new ResizeObserver(() => updateBottomNavBounds())
        : null;

    if (resizeObserver && shell) {
      resizeObserver.observe(shell);
    }

    return () => {
      window.removeEventListener("resize", updateBottomNavBounds);
      window.removeEventListener("scroll", updateBottomNavBounds);
      resizeObserver?.disconnect();
    };
  }, []);

  // Load system messages from backend when chat tab opens
  const chatLoadedRef = useRef(false);
  // Reset chatLoadedRef when leaving chat so we reload on return
  useEffect(() => {
    if (activeTab !== "chat") {
      chatLoadedRef.current = false;
    }
  }, [activeTab]);
  useEffect(() => {
    if (activeTab !== "chat" || !userId || chatLoadedRef.current) return;
    chatLoadedRef.current = true;

    (async () => {
      try {
        // Fire any due medication reminders before loading messages
        api.checkReminders(userId).catch(() => { });
        const res = await api.getChatMessages(userId);
        const backendMsgs = res.items ?? [];
        // Find system messages that aren't already in our local state
        const systemMsgs = backendMsgs.filter((m) => m.role === "system");
        if (systemMsgs.length > 0) {
          // Only show the single most recent system alert
          const latestSystem = [...systemMsgs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          setChatMessages((prev) => {
            // Remove any existing system messages so there is always at most one
            const withoutSystem = prev.filter((m) => m.sender !== "system");
            const existingTexts = new Set(withoutSystem.map((m) => m.text));
            if (existingTexts.has(latestSystem.content)) return prev;
            const alertMsg = {
              id: Date.now(),
              sender: "system" as const,
              text: latestSystem.content,
              originalText: latestSystem.content,
              timestamp: new Date(latestSystem.created_at),
            };
            return [alertMsg, ...withoutSystem];
          });
        }
        // Mark all as read
        await api.postMarkRead(userId);
        setUnreadCount(0);
      } catch { /* ignore */ }
    })();
  }, [activeTab, userId]);

  // While chat is open, poll for new system reminders (e.g. timer reminders)
  useEffect(() => {
    if (activeTab !== "chat" || !userId) return;

    const syncSystemMessages = async () => {
      try {
        const res = await api.getChatMessages(userId);
        const backendMsgs = res.items ?? [];
        const systemMsgs = backendMsgs.filter((m) => m.role === "system");
        if (systemMsgs.length === 0) return;

        const latestSystem = [...systemMsgs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];

        setChatMessages((prev) => {
          const withoutSystem = prev.filter((m) => m.sender !== "system");
          const existingTexts = new Set(prev.map((m) => m.text));
          if (existingTexts.has(latestSystem.content)) return prev;

          const alertMsg = {
            id: Date.now(),
            sender: "system" as const,
            text: latestSystem.content,
            originalText: latestSystem.content,
            timestamp: new Date(latestSystem.created_at),
          };
          return [alertMsg, ...withoutSystem];
        });
      } catch {
        // ignore polling errors
      }
    };

    const intervalId = window.setInterval(syncSystemMessages, 5000);
    return () => window.clearInterval(intervalId);
  }, [activeTab, userId]);

  useEffect(() => {
    if (prevChatLang.current === chatLang) return;
    prevChatLang.current = chatLang;

    const translateAll = async () => {
      setChatTranslating(true);
      try {
        const updated = await Promise.all(
          chatMessages.map(async (msg) => {
            if (msg.sender !== "bot" && msg.sender !== "system") return msg;
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

        // Translate quick food questions
        if (chatLang === "en") {
          setTranslatedFoodQuestions(QUICK_FOOD_QUESTIONS);
        } else {
          const translatedQuestions = await Promise.all(
            QUICK_FOOD_QUESTIONS.map(async (q) => {
              try {
                const res = await api.postTranslate(q, chatLang);
                return res.translated_text;
              } catch {
                return q;
              }
            })
          );
          setTranslatedFoodQuestions(translatedQuestions);
        }
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

  // --- Reschedule state (home card) ---
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleSlot, setRescheduleSlot] = useState<string | null>(null);
  const [rescheduleSent, setRescheduleSent] = useState(false);

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
  const [timerReminderGroup, setTimerReminderGroup] = useState<ReminderGroup | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [appReminderNotice, setAppReminderNotice] = useState<string | null>(null);
  const [userMentionedReminderSeconds, setUserMentionedReminderSeconds] = useState<number | null>(null);
  const [lastTimerResponse, setLastTimerResponse] = useState<ReminderResponseStatus | null>(null);
  const [timerResponseByMedId, setTimerResponseByMedId] = useState<Map<string, ReminderResponseStatus>>(new Map());
  const appTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (appTimerRef.current) {
        window.clearTimeout(appTimerRef.current);
      }
    };
  }, []);

  // --- Care plan lock state (clinician-managed) ---
  const [carePlanLocked, setCarePlanLocked] = useState(false);
  const [clinicianName, setClinicianName] = useState<string | null>(null);

  // --- Phase 11: MEE / Adherence / Unread count ---
  const [meeScore, setMeeScore] = useState<MEEScoreResponse | null>(null);
  const [orchestrateResult, setOrchestrateResult] = useState<OrchestrateResponse | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adherenceTracking, setAdherenceTracking] = useState<Record<string, string>>({});

  // --- Adaptive Timing state ---
  const [adaptiveTiming, setAdaptiveTiming] = useState<AdaptiveTimingItem[]>([]);
  const [timingInsight, setTimingInsight] = useState<string | null>(null);
  const [timingInsightLoading, setTimingInsightLoading] = useState(false);
  const [learningEvidence, setLearningEvidence] = useState<LearningEvidenceResponse | null>(null);
  const [learningEvidenceOpen, setLearningEvidenceOpen] = useState(false);

  // --- Medication Supply / Refill reminder state ---
  const [refillStatus, setRefillStatus] = useState<RefillStatusItem[] | null>(null);
  const [supplyInputs, setSupplyInputs] = useState<Record<string, string>>({});
  const [supplyLoading, setSupplyLoading] = useState<string | null>(null);
  const [refillCheckLoading, setRefillCheckLoading] = useState(false);
  const [refillOrdered, setRefillOrdered] = useState<Record<string, boolean>>({});

  // True when the user should not edit the care plan (caregiver or clinician-locked patient)
  const carePlanReadOnly = carePlanLocked || accountRole === "caregiver";

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

    const [userRes, medsRes, driftRes, nextRes, foodRes, appointmentRes, communityRes, myEventsRes, adaptiveRes] = await Promise.allSettled([
      api.getUser(userId),
      api.getMedications(userId),
      api.getDrift(userId),
      api.getNextAction(userId),
      api.getFoodRecommendations(userId),
      api.getAppointments(userId),
      api.getCommunityEvents(userId),
      getMyCommunityEventsSafe(userId),
      api.getAdaptiveTiming(userId)
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

    if (adaptiveRes.status === "fulfilled") {
      setAdaptiveTiming(adaptiveRes.value.items ?? []);
      // Fetch timing insight and learning evidence once adaptive data is loaded
      if ((adaptiveRes.value.items ?? []).some(i => i.confidence === "learned" || i.confidence === "learned_weekend")) {
        setTimingInsightLoading(true);
        api.getTimingInsight(userId).then(res => setTimingInsight(res.insight)).catch(() => {}).finally(() => setTimingInsightLoading(false));
        api.getLearningEvidence(userId).then(setLearningEvidence).catch(() => {});
      }
    } else {
      setAdaptiveTiming([]);
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
    // Load care plan lock status
    if (userId) {
      api.getCarePlanStatus(userId).then((res) => {
        setCarePlanLocked(res.managed_by_clinician);
        setClinicianName(res.clinician_name);
      }).catch(() => { });
      // Load MEE score + unread count
      api.getMEEScore(userId).then(setMeeScore).catch(() => { });
      api.getUnreadCount(userId).then((res) => setUnreadCount(res.unread_count)).catch(() => { });
      api.postOrchestrate(userId).then(setOrchestrateResult).catch(() => { });
    }
  }, [loadDashboard, loadDoseEvents, userId]);

  // Poll unread count every 30s so the badge updates after orchestration
  useEffect(() => {
    if (!userId) return;
    const id = window.setInterval(() => {
      if (activeTab === "chat") return; // skip while viewing chat
      api.getUnreadCount(userId)
        .then((res) => setUnreadCount(res.unread_count))
        .catch(() => { });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [userId, activeTab]);



  const appointmentText = useMemo(
    () => formatAppointment(appointments?.next_appointment ?? null, appointments?.days_remaining ?? null),
    [appointments]
  );
  const nutritionRecommendations = useMemo(
    () => (food?.recommended_foods ?? food?.recommendations ?? []),
    [food]
  );

  const handleNutritionScan = useCallback(async (selectedFile?: File | null) => {
    if (!userId) return;
    const fileToScan = selectedFile ?? null;
    if (!fileToScan) {
      setNutritionCheckError("Please upload a food image first.");
      return;
    }

    setNutritionCheckLoading(true);
    setNutritionCheckError(null);
    try {
      const result = await api.postNutritionScanImage(userId, fileToScan);
      setNutritionScanResult(result.scan_result);
      setFood(result.nutrition_result);
    } catch (error) {
      setNutritionCheckError(safeMessage(error));
    } finally {
      setNutritionCheckLoading(false);
    }
  }, [userId]);

  const handleNutritionImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    void handleNutritionScan(file);
  }, [handleNutritionScan]);

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
  const healthSupplyItems = useMemo(
    () => refillStatus ?? allMeds.map<RefillStatusItem>((m) => ({
      medication_id: m.medication_id,
      name: m.name,
      dose_text: m.dose_text,
      total_supply: m.total_supply ?? 0,
      taken_count: 0,
      doses_remaining: null,
      days_remaining: null,
      is_low: false,
      needs_refill: false,
      tracking_enabled: false,
    })),
    [allMeds, refillStatus]
  );
  const nextHealthAppointment = useMemo(() => {
    const sorted = [...allAppts].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    if (appointments?.next_appointment) {
      const matchingFullAppointment = sorted.find((appt) =>
        appt.datetime === appointments.next_appointment?.datetime &&
        appt.location === appointments.next_appointment?.location
      );
      if (matchingFullAppointment) {
        return matchingFullAppointment;
      }
      return {
        datetime: appointments.next_appointment.datetime,
        location: appointments.next_appointment.location,
        notes: "",
      };
    }
    return sorted[0] ?? null;
  }, [allAppts, appointments]);

  // Adaptive timing lookup: "medId:scheduleTime" -> AdaptiveTimingItem
  const adaptiveMap = useMemo(() => {
    const m = new Map<string, AdaptiveTimingItem>();
    for (const a of adaptiveTiming) {
      m.set(`${a.medication_id}:${a.schedule_time}`, a);
    }
    return m;
  }, [adaptiveTiming]);

  // Build today's dose slots for the home tab overview
  type TodayDoseSlot = { med: MedicationItem; scheduledFor: string; timeLabel: string; status: string | null; eventId: string | null };
  const todayDoseSlots = useMemo(() => {
    const timezone = userProfile?.timezone || "Asia/Singapore";
    const { date } = getClockParts(timezone);
    const slots: TodayDoseSlot[] = [];
    for (const med of medications?.items ?? []) {
      for (const t of med.schedule?.times ?? []) {
        if (!t) continue;
        const scheduledFor = buildScheduledFor(date, t);
        const ev = latestDoseEventBySlot.get(`${med.medication_id}:${scheduledFor}`);
        slots.push({ med, scheduledFor, timeLabel: t, status: ev?.response_status ?? null, eventId: ev?.event_id ?? null });
      }
    }
    slots.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    return slots;
  }, [medications, latestDoseEventBySlot, userProfile?.timezone]);

  const [quickMarkLoading, setQuickMarkLoading] = useState<string | null>(null);
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  // Track last recorded event per slot for Undo
  const [undoEvents, setUndoEvents] = useState<Map<string, { eventId: string; status: string }>>(new Map());
  async function handleQuickMark(slot: TodayDoseSlot, status: ReminderResponseStatus) {
    if (!userId) return;
    const key = `${slot.med.medication_id}:${slot.scheduledFor}`;
    setQuickMarkLoading(key);
    try {
      const response = await api.postMedicationIntake(userId, {
        medication_ids: [slot.med.medication_id],
        scheduled_for: slot.scheduledFor,
        response_status: status,
        source: "dashboard_quick_mark"
      });
      setDoseEvents((current) => [...response.items, ...current]);
      // Track the event for undo
      if (response.items.length > 0) {
        setUndoEvents((prev) => {
          const next = new Map(prev);
          next.set(key, { eventId: response.items[0].event_id, status });
          return next;
        });
      }
      api.getMEEScore(userId).then(setMeeScore).catch(() => { });
      api.getLearningEvidence(userId).then(setLearningEvidence).catch(() => {});
      // Trigger orchestration pipeline so the flow
      // patient action → MEE/risk → intervention → chat message works end-to-end
      api.postOrchestrate(userId)
        .then((res) => { setOrchestrateResult(res); return api.getUnreadCount(userId); })
        .then((res) => setUnreadCount(res.unread_count))
        .catch(() => { });
    } catch { /* ignore */ } finally {
      setQuickMarkLoading(null);
    }
  }

  async function handleCorrectDose(slot: TodayDoseSlot, newStatus: ReminderResponseStatus) {
    if (!userId) return;
    // Find the existing event ID — prefer undoEvents (just created), then slot.eventId from DB
    const key = `${slot.med.medication_id}:${slot.scheduledFor}`;
    const undo = undoEvents.get(key);
    const eventId = undo?.eventId ?? slot.eventId;
    if (!eventId) {
      // No existing event to correct — fall back to creating a new one
      return handleQuickMark(slot, newStatus);
    }
    setQuickMarkLoading(key);
    try {
      const updated = await api.patchDoseEvent(userId, eventId, newStatus);
      // Replace the event in local state
      setDoseEvents((current) =>
        current.map((ev) => (ev.event_id === eventId ? updated : ev))
      );
      // Update undo tracking to reflect the corrected event
      setUndoEvents((prev) => {
        const next = new Map(prev);
        next.set(key, { eventId, status: updated.response_status });
        return next;
      });
      api.getMEEScore(userId).then(setMeeScore).catch(() => { });
      api.getLearningEvidence(userId).then(setLearningEvidence).catch(() => {});
      api.postOrchestrate(userId)
        .then((res) => { setOrchestrateResult(res); return api.getUnreadCount(userId); })
        .then((res) => setUnreadCount(res.unread_count))
        .catch(() => { });
    } catch { /* ignore */ } finally {
      setQuickMarkLoading(null);
    }
  }

  async function handleUndoDose(slot: TodayDoseSlot) {
    if (!userId) return;
    const key = `${slot.med.medication_id}:${slot.scheduledFor}`;
    const undo = undoEvents.get(key);
    if (!undo) return;
    setQuickMarkLoading(key);
    try {
      await api.deleteDoseEvent(userId, undo.eventId);
      // Remove the event from local doseEvents
      setDoseEvents((current) => current.filter((ev) => ev.event_id !== undo.eventId));
      setUndoEvents((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      api.getMEEScore(userId).then(setMeeScore).catch(() => { });
      api.getLearningEvidence(userId).then(setLearningEvidence).catch(() => {});
    } catch { /* ignore */ } finally {
      setQuickMarkLoading(null);
    }
  }

  // Close the dose status dropdown when clicking outside
  useEffect(() => {
    if (!openDropdownKey) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dose-dropdown]')) {
        setOpenDropdownKey(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdownKey]);

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

        if (latestEvent?.response_status === "taken" || latestEvent?.response_status === "not_taken" || latestEvent?.response_status === "late") {
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
      setChatMessages((prev) => [...prev, {
        id: Date.now() + 1,
        sender: "bot",
        text: response.reply,
        originalText: response.reply_en || response.reply,
        timestamp: new Date(),
        lang: response.language || lang,
        quickReplies: response.quick_replies ?? [],
        navigation: response.context?.navigation ?? null,
      }]);

      if (response.context?.reminder_mode === "timer" && response.context?.reminder_delay_seconds) {
        const delaySeconds = response.context.reminder_delay_seconds;
        setUserMentionedReminderSeconds(delaySeconds);
        setAppReminderNotice(`Timer reminder set for ${formatTimerLabel(delaySeconds)}.`);
        if (appTimerRef.current) {
          window.clearTimeout(appTimerRef.current);
        }
        appTimerRef.current = window.setTimeout(() => {
          setUserMentionedReminderSeconds(null);
          const meds = (medications?.items ?? []).map((medication) => ({
            medication_id: medication.medication_id,
            name: medication.name,
            dose_text: medication.dose_text,
          }));

          if (meds.length === 0) {
            setAppReminderNotice("Time to take your medication now.");
            return;
          }

          const now = new Date();
          const scheduledFor = now.toISOString().slice(0, 19);
          const label = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setTimerReminderGroup({
            scheduled_for: scheduledFor,
            scheduled_label: label,
            medications: meds,
          });
          setAppReminderNotice(null);
        }, delaySeconds * 1000);
      }

      // Refresh medications to show the reminder badge if a reminder was just set
      if (response.context?.suggested_action === "set_reminder") {
        api.getMedications(userId).then((res) => {
          setMedications(res);
          setAllMeds((res.items ?? []) as MedicationItem[]);
        }).catch(() => { });
      }
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

  async function handleConfirmJoinEvent() {
    if (!joinConfirmEvent) return;
    const selected = joinConfirmEvent;
    setJoinConfirmEvent(null);
    await handleToggleCommunityEvent(selected);
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
    if (activeTab === "health" && userId) {
      api.getRefillStatus(userId).then((res) => setRefillStatus(res.items)).catch(() => { });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  async function handleSetSupply(medId: string) {
    const val = parseInt(supplyInputs[medId] ?? "", 10);
    if (isNaN(val) || val < 0) return;
    setSupplyLoading(medId);
    try {
      await api.updateMedicationSupply(userId, medId, val);
      const res = await api.getRefillStatus(userId);
      setRefillStatus(res.items);
      setSupplyInputs((prev) => { const n = { ...prev }; delete n[medId]; return n; });
    } catch { /* ignore */ } finally {
      setSupplyLoading(null);
    }
  }

  async function handleRefillCheck() {
    if (!userId) return;
    setRefillCheckLoading(true);
    try {
      const result = await api.runRefillCheck(userId);
      const [statusRes, countRes] = await Promise.all([
        api.getRefillStatus(userId),
        api.getUnreadCount(userId),
      ]);
      setRefillStatus(statusRes.items);
      setUnreadCount(countRes.unread_count);

      if (result.triggered && result.low_medications?.length > 0) {
        // Inject the system message into chat and navigate there
        const msgText = (result as any).message ??
          `Refill Reminder:\n${result.low_medications.join(", ")} running low. Please arrange a refill soon.`;
        setChatMessages((prev) => {
          const withoutRefill = prev.filter((m) => !(m.sender === "system" && m.text.includes("Refill")));
          return [{
            id: Date.now(),
            sender: "system" as const,
            text: msgText,
            originalText: msgText,
            timestamp: new Date(),
          }, ...withoutRefill];
        });
        // Reset chatLoadedRef so the latest message is fetched from DB too
        chatLoadedRef.current = false;
        setActiveTab("chat");
      }
    } catch { /* ignore */ } finally {
      setRefillCheckLoading(false);
    }
  }

  async function submitReminderResponse(group: ReminderGroup, responseStatus: ReminderResponseStatus) {
    if (!userId) {
      return;
    }

    setReminderBusy(true);
    setReminderError(null);

    try {
      const response = await api.postMedicationIntake(userId, {
        medication_ids: group.medications.map((medication) => medication.medication_id),
        scheduled_for: group.scheduled_for,
        response_status: responseStatus,
        source: "dashboard_popup"
      });

      setDoseEvents((current) => [...response.items, ...current]);
      setReminderGroup(null);
      void loadDashboard();
      // Refresh adherence score and learning evidence after recording a dose event
      api.getMEEScore(userId).then(setMeeScore).catch(() => { });
      api.getLearningEvidence(userId).then(setLearningEvidence).catch(() => {});
    } catch (error) {
      setReminderError(safeMessage(error));
    } finally {
      setReminderBusy(false);
    }
  }

  async function handleReminderResponse(responseStatus: ReminderResponseStatus) {
    if (!reminderGroup) {
      return;
    }
    await submitReminderResponse(reminderGroup, responseStatus);
    setReminderGroup(null);
    void loadDashboard();
  }

  async function handleTimerReminderResponse(responseStatus: ReminderResponseStatus) {
    if (!timerReminderGroup) {
      return;
    }
    await submitReminderResponse(timerReminderGroup, responseStatus);
    setLastTimerResponse(responseStatus);
    // Update per-medication status so each dose row updates immediately
    setTimerResponseByMedId((prev) => {
      const next = new Map(prev);
      for (const medication of timerReminderGroup.medications) {
        next.set(medication.medication_id, responseStatus);
      }
      return next;
    });
    if (responseStatus === "taken") {
      setAppReminderNotice("You marked timer reminder as Taken.");
    } else if (responseStatus === "not_taken") {
      setAppReminderNotice("You marked timer reminder as Not Taken.");
    } else if (responseStatus === "snoozed") {
      setAppReminderNotice(`You marked timer reminder as Not yet (${SNOOZE_MINUTES} min).`);
    }
    setTimerReminderGroup(null);
    void loadDashboard();
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
      <div
        ref={shellRef}
        className={`relative min-h-screen w-full max-w-md bg-slate-50 ${
          activeTab === "chat" ? "flex h-screen flex-col overflow-hidden" : ""
        } ${
          activeTab === "chat" ? "pb-0" : "pb-24"
        } md:border-x md:border-slate-200 md:bg-slate-50 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]`}
        style={activeTab === "chat" && bottomNavHeight > 0 ? { paddingBottom: `${bottomNavHeight}px` } : undefined}
      >
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

        {activeTab === "events" ? (
          <section className="border-b border-slate-200 bg-white px-4 py-5">
            <div className="mb-4 flex items-center">
              <h1 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Jio Events</h1>
            </div>
            <p className="text-[0.77rem] text-slate-600">
              Discover nearby activities to stay healthy and connected.
            </p>
          </section>
        ) : null}

        {dashboardLoading ? <p className="px-4 pt-2 text-xs text-emerald-700">Loading dashboard...</p> : null}
        {dashboardError ? <p className="px-4 pt-2 text-xs text-red-700">{dashboardError}</p> : null}

        <section
          key={activeTab}
          className={`tc-motion-stack ${
            activeTab === "chat"
              ? "flex-1 min-h-0 px-0 py-0"
              : activeTab === "events"
                ? "space-y-5 px-4 py-6"
                : "space-y-4 px-4 py-4"
          }`}
        >
          {activeTab === "home" ? (
            <>
              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
                    <User className="text-blue-600" size={28} />
                  </div>
                  <div>
                    <h2 className="text-[1.45rem] font-bold leading-tight tracking-[-0.02em] text-slate-900">
                      {userProfile?.name ?? "-"}, {userProfile?.age ?? "-"}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {userProfile?.conditions && userProfile.conditions.length > 0 ? userProfile.conditions.join(", ") : food?.condition ?? "No condition data"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-blue-600">{medicationCount} Medications Active</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="px-1 text-sm font-bold text-slate-900">Quick Access</h3>
                <div className="grid grid-cols-3 gap-3 rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <QuickActionTile
                    icon={<Pill className="h-5 w-5" />}
                    label="Log Meds"
                    tone="blue"
                    onClick={() => document.getElementById("today-doses")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  />
                  <QuickActionTile
                    icon={<CalendarDays className="h-5 w-5" />}
                    label="Book Visit"
                    tone="violet"
                    onClick={() => document.getElementById("upcoming-visit")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  />
                  <QuickActionTile
                    icon={<CalendarDays className="h-5 w-5" />}
                    label="Planner"
                    tone="teal"
                    onClick={() => router.push(`/dashboard/${userId}/planner`)}
                  />
                  <QuickActionTile
                    icon={<Scan className="h-5 w-5" />}
                    label="Scan Food"
                    tone="orange"
                    onClick={() => document.getElementById("diet-suggestions")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  />
                  <QuickActionTile
                    icon={<Leaf className="h-5 w-5" />}
                    label="TCM Check"
                    tone="green"
                    onClick={() => setActiveTab("health")}
                  />
                  <QuickActionTile
                    icon={<PhoneCall className="h-5 w-5" />}
                    label="Support"
                    tone="red"
                    onClick={() => setActiveTab("chat")}
                  />
                  <QuickActionTile
                    icon={<Brain className="h-5 w-5" />}
                    label="Memory Check"
                    tone="purple"
                    onClick={() => router.push(`/dashboard/${userId}/memory-check`)}
                  />
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Pill className="text-[#3670e2]" size={18} />
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Medication Adherence</h3>
                  {meeScore ? (() => {
                    const riskLevel = (orchestrateResult?.risk_level?.toUpperCase() as "HIGH" | "MEDIUM" | "LOW") ?? getRiskLevel(meeScore.score);
                    return (
                      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${riskLevel === "HIGH" ? "bg-red-100 text-red-600" : riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>
                        {riskLevel} Risk
                      </span>
                    );
                  })() : (
                    <span className="ml-auto rounded-full bg-red-100 px-2.5 py-0.5 text-[9px] font-bold text-red-600">
                      {(drift?.severity ?? "red").replace(/^./, (s) => s.toUpperCase())}
                    </span>
                  )}
                </div>

                {meeScore ? (() => {
                  const riskLevel = (orchestrateResult?.risk_level?.toUpperCase() as "HIGH" | "MEDIUM" | "LOW") ?? getRiskLevel(meeScore.score);
                  const adherenceRate = getAdherenceRate(meeScore.counts);
                  const radius = 28;
                  const circumference = 2 * Math.PI * radius;
                  const dashOffset = circumference - (adherenceRate / 100) * circumference;
                  return (
                    <div className="mt-3 flex items-center gap-4">
                      {/* Compact ring */}
                      <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center">
                        <svg className="h-full w-full -rotate-90" viewBox="0 0 68 68" aria-hidden="true">
                          <circle cx="34" cy="34" r={radius} fill="transparent" stroke="currentColor" strokeWidth="6" className="text-slate-100" />
                          <circle cx="34" cy="34" r={radius} fill="transparent" stroke="currentColor" strokeWidth="6" strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" className={riskLevel === "HIGH" ? "text-red-500" : riskLevel === "MEDIUM" ? "text-amber-500" : "text-emerald-500"} />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                          <span className="text-[13px] font-black leading-none text-slate-900">{adherenceRate}%</span>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex flex-1 flex-col gap-1.5">
                        <div className="flex items-center gap-2 text-[11px] flex-wrap">
                          <span className="text-slate-500">Taken <span className="font-bold text-slate-800">{meeScore.counts.taken}</span></span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">Late <span className="font-bold text-amber-500">{meeScore.counts.late}</span></span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">Not Taken <span className="font-bold text-red-500">{meeScore.counts.not_taken}</span></span>
                        </div>
                        <p className="text-[10px] text-slate-400 italic leading-snug">
                          {riskLevel === "LOW" ? "Great adherence — keep it up!" : riskLevel === "MEDIUM" ? "Some doses were missed or late — stay on track." : "Multiple missed doses — your care team has been notified."}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-500">Next action</span>
                          <span className="text-[11px] font-semibold text-blue-600 truncate max-w-[130px]">{friendlyActionLabel(orchestrateResult?.action_type ?? nextAction?.next_action)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="mt-3 flex items-center gap-2 text-slate-600">
                    <TriangleAlert size={16} className="text-amber-500" />
                    <p className="text-xs italic">Drift detected: {drift?.drift_detected ? "Yes" : "No"}</p>
                  </div>
                )}
              </section>

              {/* Today's Doses */}
              {todayDoseSlots.length > 0 && (
                <section id="today-doses" className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm overflow-visible">
                  <div className="mb-3 flex items-center gap-3">
                    <CalendarDays className="text-[#3670e2]" size={22} />
                    <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Today&apos;s Doses</h3>
                  </div>
                  <div className="space-y-3">
                    {todayDoseSlots.map((slot, slotIdx) => {
                      const key = `${slot.med.medication_id}:${slot.scheduledFor}`;
                      const isLoading = quickMarkLoading === key;
                      const undoInfo = undoEvents.get(key);
                      const effectiveStatus = timerResponseByMedId.get(slot.med.medication_id) ?? slot.status;
                      const adaptive = adaptiveMap.get(`${slot.med.medication_id}:${slot.timeLabel}`);
                      const isLearned = adaptive?.confidence === "learned" || adaptive?.confidence === "learned_weekend";
                      const dropdownUp = slotIdx >= todayDoseSlots.length - 3;
                      // Check if this dose is still in the future (can't mark yet)
                      const nowDate = new Date();
                      const schedDate = new Date(slot.scheduledFor);
                      const isFuture = schedDate.getTime() > nowDate.getTime();
                      return (
                        <div key={key} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{slot.med.name}</p>
                            <p className="text-xs text-slate-500">{slot.timeLabel} &middot; {slot.med.dose_text}</p>
                            {isLearned && adaptive.learned_time && adaptive.learned_time !== slot.timeLabel ? (
                              <p className="mt-0.5 text-xs text-slate-400">
                                Usually around {adaptive.learned_time}
                                {adaptive.learned_time_weekday && adaptive.learned_time_weekend && adaptive.learned_time_weekday !== adaptive.learned_time_weekend
                                  ? ` (${adaptive.is_weekend ? "weekend" : "weekday"})`
                                  : ""}
                                {" "}&middot; {adaptive.timing_status}
                              </p>
                            ) : null}
                            {userMentionedReminderSeconds ? (
                              <p className="mt-0.5 text-xs font-medium text-blue-500">Reminder in {formatTimerLabel(userMentionedReminderSeconds)}</p>
                            ) : isLearned && adaptive.smart_reminder_time ? (
                              <p className="mt-0.5 text-xs font-medium text-blue-500">Smart reminder around {adaptive.smart_reminder_time}</p>
                            ) : slot.med.reminder_offset_minutes ? (
                              <p className="mt-0.5 text-xs font-medium text-blue-500">Reminder {slot.med.reminder_offset_minutes} min before</p>
                            ) : null}
                          </div>
                          {effectiveStatus ? (
                            <div className="flex items-center gap-1.5">
                              <div className="relative" data-dose-dropdown>
                                <button
                                  type="button"
                                  disabled={isLoading}
                                  onClick={() => setOpenDropdownKey(openDropdownKey === key ? null : key)}
                                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition active:scale-95 ${effectiveStatus === "taken" ? "bg-emerald-100 text-emerald-600"
                                      : effectiveStatus === "not_taken" ? "bg-orange-50 text-orange-600"
                                        : effectiveStatus === "snoozed" ? "bg-blue-100 text-blue-600"
                                          : effectiveStatus === "late" ? "bg-amber-100 text-amber-600"
                                            : "bg-red-100 text-red-600"
                                    }`}
                                >
                                  {formatReminderStatusLabel(effectiveStatus)}
                                  <span className="ml-0.5 opacity-60 text-[9px]">▾</span>
                                </button>
                                {openDropdownKey === key && (
                                  <div className={`absolute right-0 z-50 min-w-[110px] overflow-hidden rounded-xl border border-slate-200 bg-gray-50 shadow-md ${dropdownUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
                                    {(["taken", "not_taken", "snoozed"] as ReminderResponseStatus[])
                                      .filter((s) => s !== effectiveStatus)
                                      .map((s) => (
                                        <button
                                          key={s}
                                          type="button"
                                          disabled={isLoading}
                                          onClick={() => { setOpenDropdownKey(null); void handleCorrectDose(slot, s); }}
                                          style={{ background: "none", marginTop: 0, borderRadius: 0, padding: "0.5rem 1rem" }}
                                          className={`block w-full text-left text-xs font-medium outline-none transition hover:bg-slate-200 ${s === "taken" ? "text-emerald-700"
                                            : s === "snoozed" ? "text-blue-600"
                                              : "text-red-700"
                                            }`}
                                        >
                                          Mark as {formatReminderStatusLabel(s)}
                                        </button>
                                      ))}
                                  </div>
                                )}
                              </div>
                              {undoInfo && (
                                <button
                                  type="button"
                                  disabled={isLoading}
                                  onClick={() => void handleUndoDose(slot)}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                                >
                                  Undo
                                </button>
                              )}
                            </div>
                          ) : isFuture ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-400">
                              Upcoming
                            </span>
                          ) : (
                            <div className="relative" data-dose-dropdown>
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => setOpenDropdownKey(openDropdownKey === key ? null : key)}
                                className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 transition active:scale-95"
                              >
                                Mark
                                <span className="ml-0.5 opacity-60 text-[9px]">▾</span>
                              </button>
                              {openDropdownKey === key && (
                                <div className={`absolute right-0 z-50 min-w-[110px] overflow-hidden rounded-xl border border-slate-200 bg-gray-50 shadow-md ${dropdownUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
                                  {(["taken", "not_taken", "snoozed"] as ReminderResponseStatus[]).map((s) => (
                                    <button
                                      key={s}
                                      type="button"
                                      disabled={isLoading}
                                      onClick={() => { setOpenDropdownKey(null); void handleQuickMark(slot, s); }}
                                      style={{ background: "none", marginTop: 0, borderRadius: 0, padding: "0.5rem 1rem" }}
                                      className={`block w-full text-left text-xs font-medium outline-none transition hover:bg-slate-200 ${s === "taken" ? "text-emerald-700"
                                        : s === "snoozed" ? "text-blue-600"
                                          : "text-red-700"
                                        }`}
                                    >
                                      Mark as {formatReminderStatusLabel(s)}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {nextHealthAppointment ? (
                <div id="upcoming-visit" className="relative overflow-hidden rounded-[2rem] bg-[#3670e2] px-5 py-5 text-white shadow-[0_16px_36px_rgba(54,112,226,0.3)]">
                  <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
                  <div className="relative z-10 space-y-4">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CalendarDays size={16} className="opacity-90" />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">Upcoming Visit</span>
                        </div>
                        <p className="text-lg font-bold leading-tight">{new Date(nextHealthAppointment.datetime).toLocaleString()}</p>
                        {clinicianName && (
                          <p className="text-[11px] text-blue-100/80">Dr. {clinicianName}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-3xl font-black leading-none">{appointments?.days_remaining ?? "-"}</span>
                        <span className="text-[11px] opacity-80">days to go</span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      <div className="flex items-center gap-2.5">
                        <MapPin size={15} className="text-blue-200 flex-shrink-0" />
                        <p className="text-sm font-medium">{nextHealthAppointment.location}</p>
                      </div>
                      {nextHealthAppointment.notes ? (
                        <div className="flex items-center gap-2.5">
                          <Clock3 size={15} className="text-blue-200 flex-shrink-0" />
                          <p className="text-sm text-blue-50/90">{nextHealthAppointment.notes}</p>
                        </div>
                      ) : null}
                    </div>

                    {/* Prep note */}
                    <div className="flex items-start gap-2.5 rounded-[1.2rem] border border-white/12 bg-white/10 px-3 py-3">
                      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-white" />
                      <p className="text-xs leading-relaxed text-blue-50">{appointmentPrepNote(nextHealthAppointment)}</p>
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
                          ].map((slot) => (
                            <button
                              key={slot.value}
                              type="button"
                              style={{ width: "auto", margin: 0, borderRadius: "0.85rem" }}
                              className={`px-3 py-2 text-sm font-medium transition text-left ${
                                rescheduleSlot === slot.value
                                  ? "bg-white text-[#3670e2] font-semibold"
                                  : "bg-white/15 text-white hover:bg-white/25"
                              }`}
                              onClick={() => setRescheduleSlot(slot.value)}
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            style={{ width: "auto", margin: 0, borderRadius: "0.85rem" }}
                            className="flex-1 bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25"
                            onClick={() => { setShowReschedule(false); setRescheduleSlot(null); }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={!rescheduleSlot}
                            style={{ width: "auto", margin: 0, borderRadius: "0.85rem" }}
                            className="flex-1 bg-white px-3 py-2 text-sm font-semibold text-[#3670e2] transition disabled:opacity-40"
                            onClick={() => { if (rescheduleSlot) setRescheduleSent(true); }}
                          >
                            Send Request
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sent confirmation */}
                    {rescheduleSent && (
                      <div className="flex items-center gap-2.5 rounded-[1.2rem] bg-white/15 px-3 py-3">
                        <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
                        <p className="text-xs text-blue-50">
                          Reschedule request sent to {clinicianName ? `Dr. ${clinicianName}` : "your clinician"}. They will confirm shortly.
                        </p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        style={{ width: "auto", margin: 0, borderRadius: "1.25rem" }}
                        className="flex-1 bg-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25"
                        onClick={() => {
                          setShowReschedule((v) => !v);
                          setRescheduleSent(false);
                          setRescheduleSlot(null);
                        }}
                      >
                        {showReschedule ? "Hide" : "Reschedule"}
                      </button>
                      <button
                        type="button"
                        style={{ width: "auto", margin: 0, borderRadius: "1.25rem" }}
                        className="flex-1 bg-white px-4 py-2.5 text-sm font-semibold text-[#3670e2] shadow-[0_10px_20px_rgba(15,23,42,0.12)] transition hover:bg-slate-50"
                        onClick={() => window.open(buildCalendarUrl(nextHealthAppointment), "_blank", "noopener,noreferrer")}
                      >
                        Add to calendar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div id="upcoming-visit" className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 text-sm text-slate-500 shadow-sm">
                  No upcoming appointments scheduled.
                </div>
              )}

              <section id="diet-suggestions" className="rounded-[1.75rem] border border-slate-200 bg-white px-6 py-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50">
                    <Utensils className="text-emerald-500" size={24} strokeWidth={2.2} />
                  </div>
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">
                    Diet Suggestions
                  </h3>
                </div>
                <ul className="mt-4 space-y-3.5 pb-4">
                  {nutritionRecommendations.slice(0, 3).map((item) => {
                    const needsChange = isDietChangeSuggestion(item);
                    return (
                      <li key={item} className="flex items-center gap-3 text-[0.92rem] text-slate-700">
                        <span className={`h-3 w-3 shrink-0 rounded-full ${needsChange ? "bg-red-500" : "bg-emerald-500"}`} />
                        <span className={needsChange ? "text-red-500" : "text-slate-700"}>{item}</span>
                      </li>
                    );
                  })}
                  {nutritionRecommendations.length === 0 ? (
                    <li className="text-sm text-slate-500">No diet suggestions available.</li>
                  ) : null}
                </ul>

                <div className="border-t border-slate-100 pt-4">
                  <input
                    ref={nutritionImageInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleNutritionImageChange}
                  />
                  <button
                    type="button"
                    onClick={() => nutritionImageInputRef.current?.click()}
                    disabled={nutritionCheckLoading}
                    className="flex w-full items-center justify-center gap-3 rounded-[1.35rem] bg-[#eef4ff] px-5 py-4 text-base font-semibold text-blue-600 transition hover:bg-[#e4edff] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Camera size={20} strokeWidth={2.2} />
                    {nutritionCheckLoading ? "Scanning your meal..." : "Scan your meal"}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-400">
                    On mobile, this can open the camera directly.
                  </p>

                  {nutritionScanResult?.detected_food ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <p>
                        <span className="font-semibold text-slate-800">Detected meal:</span>{" "}
                        {nutritionScanResult.detected_food}
                      </p>
                      {nutritionScanResult.ingredients.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Possible ingredients: {nutritionScanResult.ingredients.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {food?.interaction_warning && food.warning_message ? (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {food.warning_message}
                    </div>
                  ) : null}
                  {!food?.interaction_warning && food?.warning_message ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      {food.warning_message}
                    </div>
                  ) : null}

                  {nutritionCheckError ? (
                    <p className="mt-3 text-xs font-medium text-red-500">{nutritionCheckError}</p>
                  ) : null}
                  {nutritionScanResult?.source === "fallback" && nutritionScanResult.fallback_reason ? (
                    <p className="mt-3 text-xs text-amber-600">
                      We could not read this image clearly. Try a brighter photo, or type the food name instead.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Recommended For You</h2>
                    <p className="mt-1 text-[0.75rem] text-slate-500">A preview of activities picked for your health profile.</p>
                  </div>
                  <button
                    type="button"
                    className="tc-btn-link"
                    onClick={() => router.push(`/dashboard/${encodeURIComponent(userId)}/events`)}
                  >
                    See all
                  </button>
                </div>
                {homeEventsPreview.map((event, index) => {
                  const isJoined = joinedEventIds.has(event.event_id);
                  const isLoading = communityActionLoading === event.event_id;
                  return (
                    <article
                      key={event.event_id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        router.push(
                          `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                        )
                      }
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                          keyEvent.preventDefault();
                          router.push(
                            `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                          );
                        }
                      }}
                      className="tc-animated-card tc-fade-item cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
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
                          <h4 className="text-[1.35rem] font-bold leading-tight">{event.title}</h4>
                        </div>
                      </div>
                      <div className="p-4">
                        {event.reason ? <p className="mb-3 text-[10px] italic text-slate-500">{event.reason}</p> : null}
                        <div className="flex items-center justify-between">
                          <div className="space-y-1 text-xs text-slate-500">
                            <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(event.datetime)}</div>
                            <div className="flex items-center gap-1"><MapPin size={12} /> {event.location}</div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="tc-btn tc-btn-secondary tc-btn-event"
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                router.push(
                                  `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                                );
                              }}
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              className={isJoined ? "tc-btn tc-btn-danger tc-btn-event" : "tc-btn tc-btn-primary tc-btn-event"}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                if (isJoined) {
                                  void handleToggleCommunityEvent(event);
                                  return;
                                }
                                setJoinConfirmEvent(event);
                              }}
                              disabled={isLoading}
                            >
                              {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                            </button>
                          </div>
                        </div>
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
                  <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Recommended For You</h2>
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
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          router.push(
                            `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                          )
                        }
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                            keyEvent.preventDefault();
                            router.push(
                              `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                            );
                          }
                        }}
                        className="tc-animated-card tc-fade-item cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
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
                            <h4 className="text-[1.35rem] font-bold leading-tight">{event.title}</h4>
                          </div>
                        </div>
                        <div className="p-4">
                          {event.reason ? <p className="mb-3 text-[10px] italic text-slate-500">{event.reason}</p> : null}
                          <div className="flex items-center justify-between">
                            <div className="space-y-1 text-xs text-slate-500">
                              <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(event.datetime)}</div>
                              <div className="flex items-center gap-1"><MapPin size={12} /> {event.location}</div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="tc-btn tc-btn-secondary tc-btn-event"
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation();
                                  router.push(
                                    `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                                  );
                                }}
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                className={isJoined ? "tc-btn tc-btn-danger tc-btn-event" : "tc-btn tc-btn-primary tc-btn-event"}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation();
                                  if (isJoined) {
                                    void handleToggleCommunityEvent(event);
                                    return;
                                  }
                                  setJoinConfirmEvent(event);
                                }}
                                disabled={isLoading}
                              >
                                {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {recommendedEventsPanel.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No recommended events available.</p> : null}
              </section>

              <section>
                <h2 className="mb-4 text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">My Events</h2>
                {joinedEvents.length > 0 ? (
                  <article
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      router.push(
                        `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(joinedEvents[0].event_id)}`
                      )
                    }
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                        keyEvent.preventDefault();
                        router.push(
                          `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(joinedEvents[0].event_id)}`
                        );
                      }
                    }}
                    className="tc-animated-card tc-fade-item cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="relative h-32">
                      <Image
                        src={PROFILE_IMAGE_URL}
                        alt={joinedEvents[0].title}
                        fill
                        className="object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <div className="absolute left-4 top-3 inline-flex items-center rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                        Joined
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
                        <button
                          type="button"
                          className="tc-btn tc-btn-secondary tc-btn-event"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            router.push(
                              `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(joinedEvents[0].event_id)}`
                            );
                          }}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className="tc-btn tc-btn-danger tc-btn-event"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            void handleToggleCommunityEvent(joinedEvents[0]);
                          }}
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
                    className={
                      message.sender === "system"
                        ? "chat-row system"
                        : message.sender === "user"
                          ? "chat-row user"
                          : "chat-row bot"
                    }
                  >
                    {message.sender === "system" ? (
                      <div className="mx-auto w-full max-w-[95%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <div className="mb-1 flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 font-bold">
                            <TriangleAlert className="h-4 w-4 shrink-0" />
                            <span>ByteCare Alert</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setChatMessages((prev) => prev.filter((m) => m.id !== message.id))}
                            className="tc-icon-btn"
                            style={{ width: "auto", margin: 0, padding: 0, opacity: 0.5 }}
                            aria-label="Dismiss alert"
                          >
                            <XCircle size={15} />
                          </button>
                        </div>
                        <p style={{ whiteSpace: "pre-line" }}>{message.text}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-500">
                            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            type="button"
                            className="bubble-audio-btn"
                            onClick={() => void handlePlayChatAudio(message.id, message.text, message.lang || chatLang)}
                            disabled={chatAudioLoading === message.id || chatAudioPlaying === message.id}
                            aria-label={chatAudioPlaying === message.id ? "Playing audio" : "Play audio"}
                            title={chatAudioPlaying === message.id ? "Playing..." : "Listen"}
                          >
                            {chatAudioLoading === message.id ? (
                              <span className="audio-spinner" />
                            ) : chatAudioPlaying === message.id ? (
                              <Volume2 size={14} strokeWidth={2.1} />
                            ) : (
                              <Play size={14} strokeWidth={2.1} />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : message.sender === "bot" ? (
                      <div className="chat-bubble-group">
                        <div className="chat-bubble-stack">
                          <div className="bubble bubble-bot">
                            <div className="bubble-text">{message.text}</div>
                            <span className="bubble-time">
                              {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          {message.quickReplies && message.quickReplies.length > 0 ? (
                            <div className="chat-quick-replies">
                              {message.quickReplies.map((quickReply) => (
                                <button
                                  key={`${message.id}:${quickReply}`}
                                  type="button"
                                  className="chat-quick-reply-btn"
                                  disabled={chatLoading}
                                  onClick={() => void handleSendChat(quickReply)}
                                >
                                  {quickReply}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {message.navigation ? (
                            <button
                              type="button"
                              className="chat-nav-btn"
                              onClick={() => {
                                if (message.navigation?.tab) {
                                  setActiveTab(message.navigation.tab as Tab);
                                  // Scroll to the relevant section after tab switch
                                  if (message.navigation.tab === "home") {
                                    setTimeout(() => {
                                      document.getElementById("upcoming-visit")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                    }, 150);
                                  }
                                } else if (message.navigation?.route) {
                                  router.push(`/dashboard/${userId}${message.navigation.route}`);
                                }
                              }}
                            >
                              <ChevronRight size={15} strokeWidth={2.2} />
                              {message.navigation.label}
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="bubble-audio-btn"
                          onClick={() => void handlePlayChatAudio(message.id, message.text, message.lang || chatLang)}
                          disabled={chatAudioLoading === message.id || chatAudioPlaying === message.id}
                          aria-label={chatAudioPlaying === message.id ? "Playing audio" : "Play audio"}
                          title={chatAudioPlaying === message.id ? "Playing..." : "Listen"}
                        >
                          {chatAudioLoading === message.id ? (
                            <span className="audio-spinner" />
                          ) : chatAudioPlaying === message.id ? (
                            <Volume2 size={14} strokeWidth={2.1} />
                          ) : (
                            <Play size={14} strokeWidth={2.1} />
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

              <div className="chat-quick-food-wrap">
                <button
                  type="button"
                  className="tc-list-row-btn flex w-full items-center justify-between px-0 text-left"
                  style={{ margin: 0 }}
                  onClick={() => setShowQuickFoodQuestions((prev) => !prev)}
                  aria-expanded={showQuickFoodQuestions}
                  aria-label={showQuickFoodQuestions ? "Collapse quick food questions" : "Expand quick food questions"}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Quick food questions
                  </p>
                  <ChevronRight
                    size={16}
                    className={`text-slate-400 transition-transform ${showQuickFoodQuestions ? "rotate-90" : ""}`}
                  />
                </button>
                {showQuickFoodQuestions ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {QUICK_FOOD_QUESTIONS.map((question, idx) => (
                      <button
                        key={question}
                        type="button"
                        className="tc-list-row-btn rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-left text-xs font-medium text-blue-700 transition hover:border-blue-200 hover:bg-blue-100"
                        style={{ width: "auto", margin: 0 }}
                        disabled={chatLoading}
                        onClick={() => void handleSendChat(translatedFoodQuestions[idx] || question)}
                      >
                        {translatedFoodQuestions[idx] || question}
                      </button>
                    ))}
                  </div>
                ) : null}
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
                  aria-label={isRecording ? "Listening" : "Voice input"}
                  title={isRecording ? "Listening..." : "Voice input"}
                >
                  <Mic size={18} strokeWidth={2.1} />
                </button>
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => void handleSendChat()}
                  disabled={chatLoading || !chatDraft.trim()}
                  aria-label={chatLoading ? "Sending" : "Send message"}
                >
                  {chatLoading ? <span className="audio-spinner" /> : <SendHorizonal size={18} strokeWidth={2.1} />}
                </button>
              </div>
              {chatError ? (
                <p className="chat-error" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span>{chatError}</span>
                  <button
                    type="button"
                    onClick={() => setChatError(null)}
                    className="tc-icon-btn"
                    style={{ width: "auto", margin: 0, padding: 0, flexShrink: 0, opacity: 0.6 }}
                    aria-label="Dismiss error"
                  >
                    <XCircle size={15} />
                  </button>
                </p>
              ) : null}
            </section>
          ) : null}

          {/* ── HEALTH TAB ── */}
          {activeTab === "health" ? (
            <>
              <section className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                  <ShieldCheck className="text-[#3670e2]" size={24} />
                  <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">TCM Safety Check</h2>
                </div>
                <div className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                  <div className="space-y-4">
                    <p className="text-sm leading-relaxed text-slate-500">
                      Check herb-drug interactions against your current medications.
                    </p>

                    <div className="flex rounded-2xl bg-slate-100 p-1">
                      <button
                        type="button"
                        className={`tc-segment-btn flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${tcmMode === "manual" ? "tc-segment-btn-active" : "hover:text-slate-700"
                          }`}
                        onClick={() => setTcmMode("manual")}
                      >
                        Type Herb Name
                      </button>
                      <button
                        type="button"
                        className={`tc-segment-btn flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${tcmMode === "image" ? "tc-segment-btn-active" : "hover:text-slate-700"
                          }`}
                        onClick={() => setTcmMode("image")}
                      >
                        Upload Image
                      </button>
                    </div>

                    {tcmMode === "manual" ? (
                      <div className="space-y-2">
                        <label className="ml-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Herb Name</label>
                        <input
                          value={herb}
                          onChange={(e) => setHerb(e.target.value)}
                          placeholder="e.g. ginseng, ginkgo, dong quai"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-300 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100/70"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <label className="ml-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Upload Herb Image</label>
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
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-medium text-slate-500">Selected: {tcmImageFile.name}</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={URL.createObjectURL(tcmImageFile)}
                              alt="Uploaded herb"
                              style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 16, marginTop: 8, objectFit: "contain" }}
                            />
                          </div>
                        ) : null}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleTCMCheck()}
                      disabled={tcmLoading || (tcmMode === "manual" ? !herb.trim() : !tcmImageFile)}
                      className="w-full rounded-2xl bg-[#3670e2] py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(54,112,226,0.22)] transition hover:bg-[#2f62ca] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tcmLoading ? "Scanning..." : "Check Herb"}
                    </button>

                    {tcmError ? <p className="text-sm text-red-600">{tcmError}</p> : null}

                    {tcmResult ? (
                      <div className="space-y-4">
                        <div
                          className={`rounded-[1.5rem] border p-4 ${tcmResult.risk_level === "high"
                              ? "border-red-100 bg-red-50"
                              : tcmResult.risk_level === "moderate"
                                ? "border-amber-100 bg-amber-50"
                                : "border-emerald-100 bg-emerald-50"
                            }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm text-slate-900">{tcmResult.herb_detected ?? "Unknown Herb"}</strong>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${tcmResult.risk_level === "high"
                                ? "bg-red-100 text-red-600"
                                : tcmResult.risk_level === "moderate"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}>
                              {tcmResult.risk_level} risk
                            </span>
                            {tcmResult.identification_source ? (
                              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium text-slate-500">
                                via {tcmResult.identification_source}{tcmResult.identification_confidence ? ` · ${tcmResult.identification_confidence}` : ""}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 text-sm leading-relaxed text-slate-700">{tcmTranslatedText?.message ?? tcmResult.message}</p>
                          {tcmResult.flagged_medications.length > 0 ? (
                            <div className="mt-4 space-y-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Flagged medications</p>
                              <ul className="space-y-1 text-sm text-slate-600">
                                {tcmResult.flagged_medications.map((m) => <li key={m}>{m}</li>)}
                              </ul>
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            ByteCare says{tcmLang === "en" ? " (Singlish)" : ""}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-slate-700">{tcmTranslatedText?.singlish ?? tcmResult.singlish_message}</p>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <label className="text-xs font-medium text-slate-500">Translate to:</label>
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
                                } catch { }
                                setTcmTranslating(false);
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                            >
                              <option value="en">English (Singlish)</option>
                              <option value="zh">普通话 (Mandarin)</option>
                              <option value="yue">廣東話 (Cantonese)</option>
                              <option value="ms">Bahasa Melayu (Malay)</option>
                              <option value="ta">தமிழ் (Tamil)</option>
                              <option value="hi">हिन्दी (Hindi)</option>
                            </select>
                          </div>

                          {tcmTranslating ? <p className="mt-2 text-xs text-slate-500">Translating...</p> : null}

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
                              } catch {
                                setTcmAudioPlaying(false);
                              }
                              setTcmAudioLoading(false);
                            }}
                            disabled={tcmAudioLoading || tcmAudioPlaying || (tcmLang !== "en" && tcmTranslating)}
                            className="mt-4 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-[#3670e2] ring-1 ring-slate-200 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {tcmAudioLoading ? "Loading audio..." : tcmAudioPlaying ? "Playing..." : tcmAudioUrl ? "Replay Audio" : "Listen"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                  <Package className="text-[#3670e2]" size={24} />
                  <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Medication Supply</h2>
                </div>
                <div className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="max-w-[18rem] text-sm leading-relaxed text-slate-500">
                        Each time you mark a dose as taken, your supply count updates automatically. You can correct the number anytime if needed.
                      </p>
                      <button
                        type="button"
                        className="w-auto rounded-2xl bg-[#3670e2] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_10px_20px_rgba(54,112,226,0.2)] transition hover:bg-[#2f62ca] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={refillCheckLoading}
                        onClick={() => void handleRefillCheck()}
                      >
                        {refillCheckLoading ? "Checking..." : "Check"}
                      </button>
                    </div>

                    <div className="space-y-4">
                      {healthSupplyItems.map((item) => {
                        const isEditing = supplyInputs[item.medication_id] !== undefined;
                        const toneClass = item.needs_refill
                          ? "bg-red-50 text-red-600"
                          : item.is_low
                            ? "bg-amber-50 text-amber-600"
                            : item.tracking_enabled
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-slate-100 text-slate-500";

                        return (
                          <div key={item.medication_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <h4 className="text-sm font-semibold text-slate-900">{item.name}</h4>
                                  <p className="mt-1 text-xs text-slate-500">{item.dose_text}</p>
                                </div>
                                <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${toneClass}`}>
                                  {item.tracking_enabled && item.doses_remaining !== null
                                    ? `${item.doses_remaining} left${item.days_remaining !== null ? ` · ${item.days_remaining}d` : ""}`
                                    : "Not tracked"}
                                </span>
                              </div>

                              {!isEditing ? (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                                    onClick={() => setSupplyInputs((prev) => ({
                                      ...prev,
                                      [item.medication_id]: item.doses_remaining !== null ? String(item.doses_remaining) : ""
                                    }))}
                                  >
                                    {item.tracking_enabled ? "Correct count" : "Set current supply"}
                                  </button>
                                  {(item.is_low || item.needs_refill) ? (
                                    <button
                                      type="button"
                                      className={`flex-1 rounded-2xl px-3 py-2.5 text-xs font-semibold transition ${refillOrdered[item.medication_id]
                                          ? "bg-emerald-50 text-emerald-600"
                                          : "bg-[#3670e2] text-white shadow-[0_10px_20px_rgba(54,112,226,0.18)] hover:bg-[#2f62ca]"
                                        }`}
                                      disabled={refillOrdered[item.medication_id]}
                                      onClick={async () => {
                                        if (!userId) return;
                                        try {
                                          await api.requestRefill(userId, item.medication_id);
                                          setRefillOrdered((prev) => ({ ...prev, [item.medication_id]: true }));
                                        } catch { }
                                      }}
                                    >
                                      {refillOrdered[item.medication_id] ? "Sent to Clinician" : "Order Refill"}
                                    </button>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="number"
                                    min={0}
                                    autoFocus
                                    placeholder="doses you have now"
                                    value={supplyInputs[item.medication_id]}
                                    onChange={(e) => setSupplyInputs((prev) => ({ ...prev, [item.medication_id]: e.target.value }))}
                                    className="w-[9.5rem] rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100/70"
                                  />
                                  <button
                                    type="button"
                                    className="rounded-2xl bg-[#3670e2] px-4 py-2.5 text-xs font-semibold text-white"
                                    disabled={supplyLoading === item.medication_id}
                                    onClick={() => void handleSetSupply(item.medication_id)}
                                  >
                                    {supplyLoading === item.medication_id ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600"
                                    onClick={() => setSupplyInputs((prev) => {
                                      const next = { ...prev };
                                      delete next[item.medication_id];
                                      return next;
                                    })}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {(healthSupplyItems ?? []).some((s) => s.is_low) ? (
                      <div className="flex gap-3 rounded-[1.5rem] border border-blue-100 bg-blue-50 p-4">
                        <Info className="mt-0.5 shrink-0 text-[#3670e2]" size={18} />
                        <p className="text-xs leading-relaxed text-slate-600">
                          Running low. Tap <span className="font-semibold text-[#3670e2]">Check</span> to refresh your supply status, or <span className="font-semibold text-[#3670e2]">Order Refill</span> to send a refill request.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                  <Pill className="text-[#3670e2]" size={24} />
                  <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Medication Schedule & Timing</h2>
                </div>
                <div className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">

                  {/* AI Insight */}
                  {(timingInsight || timingInsightLoading) && (
                    <div className="mb-5 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Sparkles className="text-blue-500" size={16} />
                        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-blue-600">AI Routine Insight</span>
                      </div>
                      {timingInsightLoading ? (
                        <p className="text-xs leading-relaxed text-slate-400 animate-pulse">Analysing your medication routine...</p>
                      ) : (
                        <p className="text-xs leading-relaxed text-slate-700">{timingInsight}</p>
                      )}
                    </div>
                  )}

                  {/* Recent History */}
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Recent History</p>
                    <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-2">
                      {recentIntakeEvents.length > 0 ? recentIntakeEvents.map((event) => {
                        const meta = intakeStatusMeta(event.response_status);
                        const Icon = meta.icon;
                        return (
                          <div key={event.event_id} className="min-w-[7rem] shrink-0 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                            <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full ${meta.chipClass}`}>
                              <Icon size={20} className={meta.iconClass} />
                            </div>
                            <p className="mt-3 text-[11px] font-semibold text-slate-700">{formatScheduledLabel(event.scheduled_for || event.timestamp)}</p>
                            <p className="mt-1 text-[11px] text-slate-500">{meta.label}</p>
                          </div>
                        );
                      }) : (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                          No recent dose responses yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Daily Schedule + Learned Timing (combined) */}
                  <div className="mt-6 space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Daily Schedule & Timing</p>
                    <div className="space-y-3">
                      {allMeds.length > 0 ? allMeds.map((med) => {
                        const schedTime = med.schedule.times[0] ?? "--:--";
                        const adaptive = adaptiveTiming.find(
                          (a) => a.medication_id === med.medication_id && a.schedule_time === schedTime
                        );
                        const isLearned = adaptive && (adaptive.confidence === "learned" || adaptive.confidence === "learned_weekend");
                        const hasWeekendDiff = adaptive?.learned_time_weekday && adaptive?.learned_time_weekend && adaptive.learned_time_weekday !== adaptive.learned_time_weekend;
                        return (
                          <div key={med.medication_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                            <div className="flex gap-4">
                              <div className="w-12 pt-0.5 text-xs font-semibold text-slate-500">{schedTime}</div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <h5 className="text-sm font-semibold text-slate-900">{med.name}</h5>
                                <p className="text-xs leading-relaxed text-slate-500">
                                  {med.dose_text} · {med.schedule.frequency}
                                </p>
                              </div>
                            </div>
                            {isLearned && adaptive ? (
                              <div className="mt-3 border-t border-slate-200 pt-3 space-y-1.5">
                                {hasWeekendDiff ? (
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-slate-400">Weekday</span>
                                      <span className="text-[11px] font-semibold text-slate-700">{adaptive.learned_time_weekday}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-slate-400">Weekend</span>
                                      <span className="text-[11px] font-semibold text-slate-700">{adaptive.learned_time_weekend}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-slate-400">Usually around</span>
                                    <span className="text-[11px] font-semibold text-slate-700">{adaptive.learned_time}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  {adaptive.smart_reminder_time ? (
                                    <span className="text-[10px] font-medium text-blue-600">Smart reminder ~{adaptive.smart_reminder_time}</span>
                                  ) : <span />}
                                  <span className={`text-[10px] font-semibold ${adaptive.average_deviation_minutes <= 30 ? "text-emerald-600" : adaptive.average_deviation_minutes <= 60 ? "text-amber-600" : "text-red-500"}`}>
                                    {adaptive.timing_status}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                          No medications recorded yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Learning Evidence — show judges how the system learned */}
              {learningEvidence && learningEvidence.medications.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-3 px-1">
                    <Brain className="text-[#3670e2]" size={24} />
                    <h2 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">How ByteCare Learns</h2>
                  </div>
                  <div className="rounded-[2rem] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">

                    {/* Expandable toggle */}
                    <button
                      type="button"
                      onClick={() => setLearningEvidenceOpen(!learningEvidenceOpen)}
                      className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Routine Learning & Smart Reminders</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Based on {learningEvidence.lookback_days} days of data · {learningEvidence.min_samples_needed}+ samples needed to learn
                        </p>
                      </div>
                      <ChevronRight size={18} className={`text-slate-400 transition-transform ${learningEvidenceOpen ? "rotate-90" : ""}`} />
                    </button>

                    {learningEvidenceOpen && (
                      <div className="mt-4 space-y-6">
                        {learningEvidence.medications.map((med) => (
                          <div key={`${med.medication_id}:${med.schedule_time}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                            <h4 className="text-sm font-semibold text-slate-900">{med.medication_name}</h4>
                            <p className="text-[10px] text-slate-400">Scheduled at {med.schedule_time}</p>

                            {/* Day-of-Week Pattern Learning */}
                            <div className="mt-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Timing Pattern Learning</p>

                              {/* Weekday samples */}
                              <div className="mb-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-semibold text-slate-600">Weekdays</span>
                                  <span className="text-[10px] text-slate-400">({med.weekday_count} doses recorded)</span>
                                  {med.weekday_median && (
                                    <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                      Learned: {med.weekday_median}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {med.weekday_samples.map((s, i) => (
                                    <div
                                      key={i}
                                      className={`rounded-lg px-2 py-1 text-[9px] font-mono ${s.status === "taken" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}
                                      title={`${s.day} ${s.date}`}
                                    >
                                      {s.time}
                                      <span className="ml-1 text-[8px] opacity-60">{s.day}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Weekend samples */}
                              <div className="mb-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-semibold text-slate-600">Weekends</span>
                                  <span className="text-[10px] text-slate-400">({med.weekend_count} doses recorded)</span>
                                  {med.weekend_median ? (
                                    <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                      Learned: {med.weekend_median}
                                    </span>
                                  ) : (
                                    <span className="ml-auto text-[10px] text-slate-400 italic">
                                      Need {learningEvidence.min_samples_needed - med.weekend_count} more
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {med.weekend_samples.length > 0 ? med.weekend_samples.map((s, i) => (
                                    <div
                                      key={i}
                                      className={`rounded-lg px-2 py-1 text-[9px] font-mono ${s.status === "taken" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}
                                      title={`${s.day} ${s.date}`}
                                    >
                                      {s.time}
                                      <span className="ml-1 text-[8px] opacity-60">{s.day}</span>
                                    </div>
                                  )) : (
                                    <span className="text-[10px] text-slate-400 italic">No weekend data yet</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Thompson Sampling Bandit Arms */}
                            {med.bandit_arms.length > 0 && (
                              <div className="mt-4 border-t border-slate-200 pt-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">
                                  Reinforcement Learning — Reminder Offset
                                </p>
                                <p className="text-[10px] text-slate-400 mb-2">
                                  Thompson Sampling tries different reminder times and learns which works best
                                </p>
                                <div className="space-y-1.5">
                                  {med.bandit_arms.map((arm) => {
                                    const isBest = arm.offset_minutes === med.best_offset;
                                    const barWidth = Math.max(8, arm.win_rate);
                                    return (
                                      <div key={arm.offset_minutes} className="flex items-center gap-2">
                                        <span className={`w-14 text-right text-[10px] font-mono ${isBest ? "font-bold text-blue-700" : "text-slate-500"}`}>
                                          {arm.offset_minutes} min
                                        </span>
                                        <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden relative">
                                          <div
                                            className={`h-full rounded-full transition-all ${isBest ? "bg-gradient-to-r from-blue-500 to-indigo-500" : "bg-slate-300"}`}
                                            style={{ width: `${barWidth}%` }}
                                          />
                                          <span className={`absolute inset-y-0 flex items-center text-[9px] font-bold ${barWidth > 50 ? "right-2 text-white" : "left-2 text-slate-600"}`} style={{ left: barWidth > 50 ? undefined : `${barWidth + 2}%` }}>
                                            {arm.win_rate}%
                                          </span>
                                        </div>
                                        <span className="w-16 text-[9px] text-slate-400">
                                          {arm.alpha}W / {arm.beta}L
                                        </span>
                                        {isBest && (
                                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold text-blue-700">BEST</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                <p className="mt-2 text-[10px] text-slate-500">
                                  Current winner: <span className="font-bold text-blue-700">{med.best_offset} min</span> before dose ({med.best_win_rate}% success rate)
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

            </>
          ) : null}

          {activeTab === "profile" ? (
            <>
              <section className="flex flex-col items-center px-2 pb-1 pt-2">
                <div className="relative">
                  <div className="relative h-28 w-28 overflow-hidden rounded-full border-4 border-white shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
                    <Image
                      src={PROFILE_IMAGE_URL}
                      alt={userProfile?.name ?? "Patient profile"}
                      fill
                      className="object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  {!editingProfile ? (
                    <button
                      type="button"
                      onClick={startEditProfile}
                      className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#3670e2] text-white shadow-md transition hover:bg-[#2f62ca]"
                      aria-label="Edit profile"
                    >
                      <Pencil size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 text-center">
                  <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-slate-900">
                    {userProfile?.name ?? "Patient"}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Patient ID: {userId}</p>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <User size={20} className="text-[#3670e2]" />
                    <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Personal Information</h3>
                  </div>
                  {!editingProfile ? (
                    <button type="button" className="icon-button" onClick={startEditProfile}>Edit</button>
                  ) : null}
                </div>

                {!editingProfile ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Role</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">Patient</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Age</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{userProfile?.age ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Timezone</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{userProfile?.timezone ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Language</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{userProfile?.language_preference ?? "-"}</p>
                    </div>
                  </div>
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
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <FileText size={20} className="text-[#3670e2]" />
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Medical Records</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Primary Condition</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(userProfile?.conditions?.length ?? 0) > 0 ? userProfile?.conditions?.map((condition) => (
                        <span key={condition} className="rounded-md bg-[#3670e2]/10 px-2 py-1 text-[10px] font-bold text-[#3670e2]">
                          {condition}
                        </span>
                      )) : (
                        <span className="text-sm text-slate-500">No conditions recorded</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Active Medications</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{medicationCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Care Plan</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {clinicianName ? `Managed by ${clinicianName}` : "Self managed"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Support Note</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {clinicianName
                        ? `Contact ${clinicianName} or open ByteCare chat if you need help with your care plan.`
                        : "Open ByteCare chat if you need help with your care plan or reminders."}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <PhoneCall size={20} className="text-[#3670e2]" />
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Help & Support</h3>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  Need help with medications, appointments, or reminders? Open the support chat and ByteCare will guide you.
                </p>
                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-[1rem] bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-600"
                  onClick={() => setActiveTab("chat")}
                >
                  <PhoneCall size={18} />
                  Open Support Chat
                </button>
              </section>

              <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">App Settings</h3>
                </div>
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="tc-list-row-btn flex items-center justify-between border-b border-slate-50 px-5 py-4 text-left transition hover:bg-slate-50"
                    onClick={() => void loadDashboard()}
                  >
                    <div className="flex items-center gap-3">
                      <Bell size={20} className="text-slate-400" />
                      <span className="text-sm font-medium text-slate-700">Refresh Profile Data</span>
                    </div>
                    <ChevronRight size={18} className="text-slate-300" />
                  </button>
                  <button
                    type="button"
                    className="tc-list-row-btn flex items-center justify-between border-b border-slate-50 px-5 py-4 text-left transition hover:bg-slate-50"
                    onClick={() => setActiveTab("health")}
                  >
                    <div className="flex items-center gap-3">
                      <ShieldCheck size={20} className="text-slate-400" />
                      <span className="text-sm font-medium text-slate-700">Health & Appointments</span>
                    </div>
                    <ChevronRight size={18} className="text-slate-300" />
                  </button>
                  <button
                    type="button"
                    className="tc-list-row-btn flex items-center justify-between border-b border-slate-50 px-5 py-4 text-left transition hover:bg-slate-50"
                    onClick={() => setActiveTab("chat")}
                  >
                    <div className="flex items-center gap-3">
                      <HelpCircle size={20} className="text-slate-400" />
                      <span className="text-sm font-medium text-slate-700">Help & Support</span>
                    </div>
                    <ChevronRight size={18} className="text-slate-300" />
                  </button>
                  <button
                    type="button"
                    className="tc-list-row-btn flex items-center justify-between px-5 py-4 text-left transition hover:bg-red-50"
                    onClick={() => { sessionStorage.removeItem("bytecare_account"); localStorage.removeItem("bytecare_account"); router.replace("/auth/signin"); }}
                  >
                    <div className="flex items-center gap-3">
                      <LogOut size={20} className="text-red-500" />
                      <span className="text-sm font-bold text-red-500">Log Out</span>
                    </div>
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </section>

        {joinConfirmEvent ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section
              className="medication-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="join-event-confirm-title-dashboard"
            >
              <p className="modal-kicker">Join event</p>
              <h2 id="join-event-confirm-title-dashboard">Confirm joining this activity?</h2>
              <p className="muted"><strong>{joinConfirmEvent.title}</strong></p>
              <p className="muted">
                {formatEventTimeShort(joinConfirmEvent.datetime)} &middot; {joinConfirmEvent.location}
              </p>
              <div className="medication-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setJoinConfirmEvent(null)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmJoinEvent()}
                  disabled={Boolean(communityActionLoading)}
                >
                  {communityActionLoading ? "Joining..." : "Join Event"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

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
                Scheduled for {reminderGroup.scheduled_label}. You can choose Taken, Skip, or Take later.
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
                  {reminderBusy ? "Saving..." : `Take later (${SNOOZE_MINUTES} min)`}
                </button>
                <button
                  type="button"
                  className="skip-button"
                  onClick={() => void handleReminderResponse("not_taken")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : "Not taking it"}
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

        {appReminderNotice ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section className="medication-modal" role="dialog" aria-modal="true" aria-labelledby="app-reminder-notice-title">
              <p className="modal-kicker">Reminder</p>
              <h2 id="app-reminder-notice-title">{appReminderNotice}</h2>
              <div className="medication-modal-actions">
                <button type="button" onClick={() => setAppReminderNotice(null)}>OK</button>
              </div>
            </section>
          </div>
        ) : null}

        {timerReminderGroup ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section
              className="medication-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="timer-reminder-title"
            >
              <p className="modal-kicker">Timer reminder</p>
              <h2 id="timer-reminder-title">It&apos;s time now. Have you taken your medication?</h2>
              <p className="muted">
                Reminder for {timerReminderGroup.scheduled_label}. Please confirm your status.
              </p>

              <div className="medication-modal-list">
                {timerReminderGroup.medications.map((medication) => (
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
                  onClick={() => void handleTimerReminderResponse("snoozed")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : `Not yet (${SNOOZE_MINUTES} min)`}
                </button>
                <button
                  type="button"
                  className="skip-button"
                  onClick={() => void handleTimerReminderResponse("not_taken")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : "Not taking it"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTimerReminderResponse("taken")}
                  disabled={reminderBusy}
                >
                  {reminderBusy ? "Saving..." : "Yes / Taken"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>

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
              <BottomNavIcon tab="home" active={activeTab === "home"} />
            </span>
            <span className={`text-[11px] ${activeTab === "home" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Home</span>
          </button>
          <button
            type="button"
            className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
            onClick={() => setActiveTab("chat")}
          >
            <span className={`relative ${activeTab === "chat" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}`}>
              <BottomNavIcon tab="chat" active={activeTab === "chat"} />
              {unreadCount > 0 ? (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  !
                </span>
              ) : null}
            </span>
            <span className={`text-[11px] ${activeTab === "chat" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Chat</span>
          </button>
          <button
            type="button"
            className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
            onClick={() => setActiveTab("events")}
          >
            <span className={activeTab === "events" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}>
              <BottomNavIcon tab="events" active={activeTab === "events"} />
            </span>
            <span className={`text-[11px] ${activeTab === "events" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Events</span>
          </button>
          <button
            type="button"
            className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
            onClick={() => setActiveTab("health")}
          >
            <span className={activeTab === "health" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}>
              <BottomNavIcon tab="health" active={activeTab === "health"} />
            </span>
            <span className={`text-[11px] ${activeTab === "health" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Health</span>
          </button>
          <button
            type="button"
            className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition"
            onClick={() => setActiveTab("profile")}
          >
            <span className={activeTab === "profile" ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}>
              <BottomNavIcon tab="profile" active={activeTab === "profile"} />
            </span>
            <span className={`text-[11px] ${activeTab === "profile" ? "font-medium text-blue-500" : "font-normal text-slate-400 group-hover:text-blue-500"}`}>Profile</span>
          </button>
          </nav>
        </div>
      </div>
    </main>
  );
}
