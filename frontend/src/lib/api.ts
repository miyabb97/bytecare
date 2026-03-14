import { API_BASE } from "./config";

export type UserProfile = {
  user_id: string;
  name: string;
  age: number;
  timezone: string;
  language_preference: string;
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

export type CommunityEventItem = {
  event_id: string;
  title: string;
  location: string;
  datetime: string;
  reason?: string;
  type: string;
  description: string;
  organiser: string;
};

export type CommunityResponse = {
  events: CommunityEventItem[];
};

export type CommunityMyEventsResponse = {
  joined: CommunityEventItem[];
  saved: CommunityEventItem[];
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
  extracted_text?: string;
  interaction_warning: boolean;
  herb_detected: string | null;
  risk_level: string;
  flagged_medications: string[];
  message: string;
  singlish_message: string;
};

export type TCMIdentifyResponse = {
  extracted_text: string;
  identified_herb: string | null;
  herb_key: string | null;
  confidence: string | null;
  source: string;
};

export type VoiceAgentResponse = {
  reply: string;
  source: string;
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
  items: Array<MedicationItem>;
};

export type MedicationItem = {
  medication_id: string;
  user_id: string;
  name: string;
  dose_text: string;
  schedule: { frequency: string; times: string[] };
  time_window_minutes: number;
  criticality: string;
  created_at: string;
};

export type AppointmentItem = {
  appointment_id: string;
  user_id: string;
  datetime: string;
  location: string;
  notes: string;
  created_at: string;
};

export type AppointmentListResponse = {
  items: AppointmentItem[];
};

export type Account = {
  account_id: string;
  name: string;
  email: string;
  role: "patient" | "caregiver" | "admin";
  user_id?: string;
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
  getMyCommunityEvents: (userId: string) =>
    apiRequest<CommunityMyEventsResponse>(`/users/${userId}/community-events/my-events`),
  postJoinCommunityEvent: (userId: string, eventId: string) =>
    apiRequest<{ status: string; event_id: string }>(`/users/${userId}/community-events/join`, {
      method: "POST",
      body: JSON.stringify({ event_id: eventId })
    }),
  postCancelCommunityEvent: (userId: string, eventId: string) =>
    apiRequest<{ status: string; event_id: string }>(`/users/${userId}/community-events/cancel`, {
      method: "POST",
      body: JSON.stringify({ event_id: eventId })
    }),
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
    }),
  postTCMScan: async (userId: string, imageFile: File): Promise<TCMResponse> => {
    const formData = new FormData();
    formData.append("image", imageFile);
    const response = await fetch(`${API_BASE}/users/${userId}/tcm-scan`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    return payload as TCMResponse;
  },
  postTCMIdentify: async (userId: string, imageFile: File): Promise<TCMIdentifyResponse> => {
    const formData = new FormData();
    formData.append("image", imageFile);
    const response = await fetch(`${API_BASE}/users/${userId}/tcm-identify`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    return payload as TCMIdentifyResponse;
  },
  postVoiceAgent: (userId: string, message: string) =>
    apiRequest<VoiceAgentResponse>(`/users/${userId}/voice/agent`, {
      method: "POST",
      body: JSON.stringify({ message })
    }),
  postTTS: async (text: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`TTS failed: HTTP ${response.status}`);
    return response.blob();
  },

  // --- User CRUD ---
  createUser: (data: { name: string; age: number; timezone: string; language_preference: string }) =>
    apiRequest<UserProfile>("/users", {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updateUser: (userId: string, data: Partial<{ name: string; age: number; timezone: string; language_preference: string }>) =>
    apiRequest<UserProfile>(`/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(data)
    }),

  // --- Medication CRUD ---
  createMedication: (userId: string, data: { name: string; dose_text: string; schedule: { frequency: string; times: string[] }; time_window_minutes: number; criticality: string }) =>
    apiRequest<MedicationItem>(`/users/${userId}/medications`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updateMedication: (userId: string, medId: string, data: { name: string; dose_text: string; schedule: { frequency: string; times: string[] }; time_window_minutes: number; criticality: string }) =>
    apiRequest<MedicationItem>(`/users/${userId}/medications/${medId}`, {
      method: "PUT",
      body: JSON.stringify(data)
    }),
  deleteMedication: (userId: string, medId: string) =>
    fetch(`${API_BASE}/users/${userId}/medications/${medId}`, { method: "DELETE" }),

  // --- Appointment CRUD ---
  getAllAppointments: (userId: string) =>
    apiRequest<AppointmentListResponse>(`/users/${userId}/appointments/all`),
  createAppointment: (userId: string, data: { datetime: string; location: string; notes: string }) =>
    apiRequest<AppointmentItem>(`/users/${userId}/appointments`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updateAppointment: (userId: string, apptId: string, data: { datetime: string; location: string; notes: string }) =>
    apiRequest<AppointmentItem>(`/users/${userId}/appointments/${apptId}`, {
      method: "PUT",
      body: JSON.stringify(data)
    }),
  deleteAppointment: (userId: string, apptId: string) =>
    fetch(`${API_BASE}/users/${userId}/appointments/${apptId}`, { method: "DELETE" }),

  // --- Auth ---
  signUp: (data: { name: string; email: string; password: string; role: "patient" | "caregiver" }) =>
    apiRequest<Account>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  signIn: (data: { email: string; password: string }) =>
    apiRequest<Account>("/auth/signin", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
