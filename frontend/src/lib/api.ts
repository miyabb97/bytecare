import { API_BASE } from "./config";

export type UserProfile = {
  user_id: string;
  name: string;
  age: number;
  timezone: string;
  created_at: string;
};

export type UserListResponse = {
  items: UserProfile[];
};

export type DriftResponse = {
  drift_detected: boolean;
  severity: string;
  trigger: string;
  details: {
    missed_doses: number;
    late_doses: number;
    avg_mes: number;
  };
};

export type NextActionResponse = {
  risk_level: string;
  next_action: string;
  reason: string;
  suggested_message: string;
};

export type FoodResponse = {
  condition: string;
  recommendations: string[];
};

export type AppointmentResponse = {
  next_appointment: {
    datetime: string;
    location: string;
  } | null;
  days_remaining: number | null;
};

export type CommunityResponse = {
  events: Array<{
    title: string;
    location: string;
    date: string;
    reason: string;
  }>;
};

export type ChatResponse = {
  reply: string;
  context: {
    drift_detected: boolean;
    severity: string;
    next_action: string;
  };
};

export type VoiceResponse = {
  cleaned_text: string;
  language_hint: string;
  emotion_tag: string;
  intent: string;
};

export type TCMResponse = {
  interaction_warning: boolean;
  message: string;
};

export type ReportSummaryResponse = {
  patient_name: string;
  summary: string;
  drift_detected: boolean;
  severity: string;
  avg_mes_7d: number;
  missed_doses_7d: number;
  late_doses_7d: number;
  next_action: string;
  recommended_follow_up: string;
};

export type MedicationListResponse = {
  items: Array<{
    medication_id: string;
    user_id: string;
    name: string;
  }>;
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : payload?.status?.message ?? response.statusText;
    throw new Error(detail || `HTTP ${response.status}`);
  }

  return payload as T;
}

export const api = {
  getUsers: () => apiRequest<UserListResponse>("/users"),
  getUser: (userId: string) => apiRequest<UserProfile>(`/users/${userId}`),
  getMedications: (userId: string) => apiRequest<MedicationListResponse>(`/users/${userId}/medications`),
  getDrift: (userId: string) => apiRequest<DriftResponse>(`/users/${userId}/drift`),
  getNextAction: (userId: string) => apiRequest<NextActionResponse>(`/users/${userId}/next-action`),
  getFoodRecommendations: (userId: string) =>
    apiRequest<FoodResponse>(`/users/${userId}/food-recommendations`),
  getAppointments: (userId: string) =>
    apiRequest<AppointmentResponse>(`/users/${userId}/appointments`),
  getCommunityEvents: (userId: string) =>
    apiRequest<CommunityResponse>(`/users/${userId}/community-events`),
  getReportSummary: (userId: string) =>
    apiRequest<ReportSummaryResponse>(`/users/${userId}/report-summary`),
  postChat: (userId: string, message: string) =>
    apiRequest<ChatResponse>(`/users/${userId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message })
    }),
  postVoiceTranscript: (userId: string, transcript: string) =>
    apiRequest<VoiceResponse>(`/users/${userId}/voice/transcript`, {
      method: "POST",
      body: JSON.stringify({ transcript })
    }),
  postTCMCheck: (userId: string, herb: string) =>
    apiRequest<TCMResponse>(`/users/${userId}/tcm-check`, {
      method: "POST",
      body: JSON.stringify({ herb })
    })
};
