import { API_BASE } from "./config";

export type UserProfile = {
  user_id: string;
  name: string;
  age: number;
  conditions?: string[];
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
  medications_taken_today?: string[];
  food_query?: string | null;
  interaction_warning?: boolean;
  warning_message?: string;
  recommended_foods?: string[];
  avoid_foods?: string[];
  reasoning?: string[];
  explanation?: string;
};

export type NutritionScanResult = {
  detected_food: string;
  ocr_text: string;
  ingredients: string[];
  source: "extracted_text" | "groq_vision" | "local_ocr" | "fallback" | string;
  fallback_reason?: string | null;
};

export type NutritionScanResponse = {
  scan_result: NutritionScanResult;
  nutrition_result: FoodResponse;
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
  is_recommended?: boolean;
};

export type CommunityResponse = {
  events: CommunityEventItem[];
};

export type CommunityAllEventsResponse = {
  events: CommunityEventItem[];
};

export type CommunityMyEventsResponse = {
  joined: CommunityEventItem[];
  saved: CommunityEventItem[];
};

export type ChatNavigation = {
  label: string;
  route: string;
  tab?: string;
};

export type ChatResponse = {
  reply: string;
  reply_en?: string;
  quick_replies?: string[];
  context: {
    drift_detected: boolean;
    severity: string;
    next_action: string;
    suggested_action?: string;
    intent?: string;
    food_query?: string | null;
    recommendation_level?: string | null;
    reminder_mode?: "timer" | "medication_schedule" | null;
    reminder_delay_seconds?: number | null;
    navigation?: ChatNavigation | null;
  };
  language: string;
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
  patient_name?: string;
  patient_age?: number;
  patient_conditions?: string[];
  all_medications?: string[];
  identification_source?: string;
  identification_confidence?: string;
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
  total_supply: number;
  reminder_offset_minutes?: number | null;
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

export type DoseEventItem = {
  event_id: string;
  user_id: string;
  medication_id: string;
  event_type: string;
  source: string;
  scheduled_for: string;
  response_status: "taken" | "skipped" | "snoozed" | "missed" | "late" | "";
  timestamp: string;
  created_at: string;
};

export type DoseEventListResponse = {
  items: DoseEventItem[];
};

export type AdaptiveTimingItem = {
  medication_id: string;
  medication_name: string;
  schedule_time: string;
  learned_time: string | null;
  display_time: string;
  sample_count: number;
  average_deviation_minutes: number;
  smart_reminder_time: string | null;
  routine_type: string;
  timing_status: string;
  confidence: "learned" | "default";
};

export type AdaptiveTimingResponse = {
  user_id: string;
  items: AdaptiveTimingItem[];
};

export type Account = {
  account_id: string;
  name: string;
  email: string;
  role: "patient" | "caregiver" | "clinician" | "admin";
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
  postNutritionScanImage: async (userId: string, imageFile: File): Promise<NutritionScanResponse> => {
    const formData = new FormData();
    formData.append("image", imageFile);
    const response = await fetch(`${API_BASE}/users/${userId}/nutrition/scan`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    return payload as NutritionScanResponse;
  },
  getAppointments: (userId: string) =>
    apiRequest<AppointmentResponse>(`/users/${userId}/appointments`),
  getDoseEvents: (userId: string, days: number = 7) =>
    apiRequest<DoseEventListResponse>(`/users/${userId}/dose-events?days=${days}`),
  getAdaptiveTiming: (userId: string) =>
    apiRequest<AdaptiveTimingResponse>(`/users/${userId}/adaptive-timing`),
  getCommunityEvents: (userId: string) =>
    apiRequest<CommunityResponse>(`/users/${userId}/community-events`),
  getAllCommunityEvents: (userId: string) =>
    apiRequest<CommunityAllEventsResponse>(`/users/${userId}/community-events/all`),
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
  postChat: (userId: string, message: string, language: string = "en") =>
    apiRequest<ChatResponse>(`/users/${userId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, language })
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
  postTTS: async (text: string, lang: string = "en", slow: boolean = false): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, slow }),
    });
    if (!response.ok) throw new Error(`TTS failed: HTTP ${response.status}`);
    return response.blob();
  },
  postTranslate: async (text: string, targetLang: string): Promise<{ translated_text: string; target_lang: string }> => {
    const response = await fetch(`${API_BASE}/voice/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_lang: targetLang }),
    });
    if (!response.ok) throw new Error(`Translate failed: HTTP ${response.status}`);
    return response.json();
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
  postMedicationIntake: (
    userId: string,
    data: {
      medication_ids: string[];
      scheduled_for: string;
      response_status: "taken" | "skipped" | "snoozed" | "missed" | "late";
      source?: string;
    }
  ) =>
    apiRequest<DoseEventListResponse>(`/users/${userId}/dose-events/intake`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  deleteDoseEvent: (userId: string, eventId: string) =>
    apiRequest<{ status: string; event_id: string }>(`/users/${userId}/dose-events/${eventId}`, {
      method: "DELETE",
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
  signUp: (data: { name: string; email: string; password: string; role: "patient" | "caregiver" | "clinician" }) =>
    apiRequest<Account>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  signIn: (data: { email: string; password: string }) =>
    apiRequest<Account>("/auth/signin", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // --- Demo ---
  seedDemoPatients: () =>
    apiRequest<{ patients: DemoPatient[]; count: number }>("/demo/seed", {
      method: "POST",
    }),

  // --- Care plan status ---
  getCarePlanStatus: (userId: string) =>
    apiRequest<CarePlanStatus>(`/users/${userId}/care-plan-status`),

  // --- Clinician endpoints ---
  clinicianGetPatients: (accountId: string) =>
    apiRequest<ClinicianPatientList>(`/clinician/patients?account_id=${encodeURIComponent(accountId)}`),

  clinicianGetAllPatients: (accountId: string) =>
    apiRequest<ClinicianAllPatientList>(`/clinician/all-patients?account_id=${encodeURIComponent(accountId)}`),

  clinicianAssignPatient: (accountId: string, patientUserId: string) =>
    apiRequest<{ status: string }>(`/clinician/patients/assign?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: JSON.stringify({ patient_user_id: patientUserId }),
    }),

  clinicianUnassignPatient: (accountId: string, patientUserId: string) =>
    apiRequest<{ status: string }>(`/clinician/patients/${patientUserId}/unassign?account_id=${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    }),

  clinicianGetPatientDetail: (accountId: string, patientUserId: string) =>
    apiRequest<ClinicianPatientDetail>(`/clinician/patients/${patientUserId}?account_id=${encodeURIComponent(accountId)}`),

  clinicianUpdateConditions: (accountId: string, patientUserId: string, conditions: string[]) =>
    apiRequest<UserProfile>(`/clinician/patients/${patientUserId}/conditions?account_id=${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify({ conditions }),
    }),

  clinicianAddMedication: (accountId: string, patientUserId: string, data: { name: string; dose_text: string; schedule: { frequency: string; times: string[] }; time_window_minutes: number; criticality: string }) =>
    apiRequest<MedicationItem>(`/clinician/patients/${patientUserId}/medications?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  clinicianUpdateMedication: (accountId: string, patientUserId: string, medId: string, data: { name: string; dose_text: string; schedule: { frequency: string; times: string[] }; time_window_minutes: number; criticality: string }) =>
    apiRequest<MedicationItem>(`/clinician/patients/${patientUserId}/medications/${medId}?account_id=${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  clinicianDeleteMedication: (accountId: string, patientUserId: string, medId: string) =>
    apiRequest<void>(`/clinician/patients/${patientUserId}/medications/${medId}?account_id=${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    }),

  clinicianAddAppointment: (accountId: string, patientUserId: string, data: { datetime: string; location: string; notes: string }) =>
    apiRequest<AppointmentItem>(`/clinician/patients/${patientUserId}/appointments?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  clinicianUpdateAppointment: (accountId: string, patientUserId: string, apptId: string, data: { datetime: string; location: string; notes: string }) =>
    apiRequest<AppointmentItem>(`/clinician/patients/${patientUserId}/appointments/${apptId}?account_id=${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  clinicianDeleteAppointment: (accountId: string, patientUserId: string, apptId: string) =>
    apiRequest<void>(`/clinician/patients/${patientUserId}/appointments/${apptId}?account_id=${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    }),

  clinicianGetWeeklySummary: (accountId: string, patientUserId: string) =>
    apiRequest<WeeklySummaryResponse>(`/clinician/patients/${patientUserId}/weekly-summary?account_id=${encodeURIComponent(accountId)}`),

  // --- Phase 11: MEE / Orchestrator / Chat messages / Caregiver ---
  getMEEScore: (userId: string) =>
    apiRequest<MEEScoreResponse>(`/users/${userId}/mee`),

  getMEEPerMedication: (userId: string) =>
    apiRequest<MEEPerMedResponse>(`/users/${userId}/mee/medications`),

  getInterventions: (userId: string) =>
    apiRequest<InterventionListResponse>(`/users/${userId}/interventions`),

  postOrchestrate: (userId: string) =>
    apiRequest<OrchestrateResponse>(`/users/${userId}/orchestrate`, { method: "POST" }),

  getChatMessages: (userId: string) =>
    apiRequest<ChatMessageListResponse>(`/users/${userId}/chat/messages`),

  getUnreadCount: (userId: string) =>
    apiRequest<UnreadCountResponse>(`/users/${userId}/chat/unread-count`),

  postMarkRead: (userId: string) =>
    apiRequest<{ status: string }>(`/users/${userId}/chat/mark-read`, { method: "POST" }),

  caregiverGetPatients: (accountId: string) =>
    apiRequest<CaregiverPatientListResponse>(`/caregiver/${accountId}/patients`),

  caregiverGetPatientDetail: (accountId: string, patientUserId: string) =>
    apiRequest<CaregiverPatientDetail>(`/caregiver/${accountId}/patients/${patientUserId}`),

  caregiverGetBriefing: (accountId: string, patientUserId: string) =>
    apiRequest<CaregiverBriefing>(`/caregiver/${accountId}/patients/${patientUserId}/briefing`),
  caregiverGetMedRecommendations: (accountId: string, patientUserId: string, medId: string) =>
    apiRequest<MedRecommendationResponse>(`/caregiver/${accountId}/patients/${patientUserId}/medications/${medId}/recommendations`),

  // --- Admin endpoints ---
  adminGetAccounts: () =>
    apiRequest<AdminAccountListResponse>("/admin/accounts"),

  adminGetAllInterventions: () =>
    apiRequest<AdminInterventionListResponse>("/admin/interventions"),

  // --- Refill reminder endpoints ---
  getRefillStatus: (userId: string) =>
    apiRequest<RefillStatusResponse>(`/users/${userId}/refill-status`),

  runRefillCheck: (userId: string) =>
    apiRequest<{ triggered: boolean; low_medications: string[]; statuses: RefillStatusItem[] }>(`/users/${userId}/refill-check`, { method: "POST" }),

  updateMedicationSupply: (userId: string, medId: string, remaining: number) =>
    apiRequest<MedicationItem>(`/users/${userId}/medications/${medId}/supply`, {
      method: "PUT",
      body: JSON.stringify({ remaining }),
    }),

  requestRefill: (userId: string, medId: string) =>
    apiRequest<{ success: boolean; medication: string }>(`/users/${userId}/medications/${medId}/refill-request`, { method: "POST" }),

  // --- Memory & Focus Check ---
  startMemoryCheck: (userId: string, lang: string = "en") =>
    apiRequest<MemoryCheckStartResponse>(`/users/${userId}/memory-check/start`, {
      method: "POST",
      body: JSON.stringify({ lang }),
    }),

  submitMemoryCheck: (userId: string, sessionId: string, responses: string[], lang: string = "en") =>
    apiRequest<MemoryCheckResult>(`/users/${userId}/memory-check/submit`, {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, responses, lang }),
    }),

  getMemoryCheckHistory: (userId: string) =>
    apiRequest<MemoryCheckHistoryResponse>(`/users/${userId}/memory-check/history`),

  getMemoryCheckAnalysis: (userId: string, lang: string = "en") =>
    apiRequest<MemoryCheckAnalysisResponse>(`/users/${userId}/memory-check/analysis`, {
      method: "POST",
      body: JSON.stringify({ lang }),
    }),

  // --- Reminder agent endpoints ---
  checkReminders: (userId: string) =>
    apiRequest<{ fired: Array<{ medication: string; scheduled_at: string; reminder_text: string }>; checked: number }>(
      `/users/${userId}/reminders/check`,
      { method: "POST" }
    ),

  setMedicationReminder: (userId: string, medId: string, offsetMinutes: number = 10) =>
    apiRequest<{ success: boolean; set_count: number; offset_minutes: number; medications: string[] }>(
      `/users/${userId}/medications/${medId}/reminder`,
      { method: "PUT", body: JSON.stringify({ offset_minutes: offsetMinutes }) }
    ),

  clearMedicationReminder: (userId: string, medId: string) =>
    apiRequest<{ success: boolean; medication: string }>(
      `/users/${userId}/medications/${medId}/reminder`,
      { method: "DELETE" }
    ),
};

export type DemoPatient = {
  user_id: string;
  name: string;
  email: string;
  password: string;
  age: number;
  conditions: string[];
  medication_count: number;
  already_existed?: boolean;
};

export type CarePlanStatus = {
  managed_by_clinician: boolean;
  clinician_name: string | null;
};

export type ClinicianPatientSummary = {
  user_id: string;
  name: string;
  age: number;
  conditions: string[];
  medication_count: number;
  appointment_count: number;
};

export type ClinicianPatientList = {
  items: ClinicianPatientSummary[];
};

export type ClinicianAllPatientItem = {
  user_id: string;
  name: string;
  age: number;
  conditions: string[];
  assigned_clinician_id: string | null;
};

export type ClinicianAllPatientList = {
  items: ClinicianAllPatientItem[];
};

export type ClinicianPatientDetail = {
  patient: UserProfile & { conditions?: string[] };
  medications: MedicationItem[];
  appointments: AppointmentItem[];
  dose_events: DoseEventItem[];
  interventions: InterventionItem[];
  drift: DriftResponse;
  mee: MEEScoreResponse | null;
  food_recommendations: { condition?: string; recommendations?: string[] } | null;
  community_events: { joined: CommunityEventItem[]; saved: CommunityEventItem[] };
  tcm_warnings: TCMWarningItem[];
};

export type TCMWarningItem = {
  herb: string;
  risk_level: string;
  flagged_medications: string[];
  guidance: string;
};

export type WeeklySummaryResponse = {
  patient_name: string;
  patient_age: number;
  conditions: string[];
  period: string;
  overall_status: string;
  summary_bullets: string[];
  adherence: {
    current_score: number;
    prior_score: number;
    delta: number;
    taken: number;
    missed: number;
    late: number;
  };
  drift: DriftResponse;
  interventions: InterventionItem[];
  intervention_count: number;
  tcm_status: string;
  tcm_warnings: TCMWarningItem[];
  community_joined_count: number;
  community_events_joined: CommunityEventItem[];
  food_summary: string;
  food_recommendations: string[];
};

// --- Phase 11: Adherence / MEE / Orchestrator / Caregiver types ---

export type MEEScoreResponse = {
  user_id: string;
  score: number;
  explanation: string;
  period_days: number;
  counts: { taken: number; missed: number; late: number; skipped: number; snoozed: number };
  total_events: number;
  computed_at: string;
};

export type MEEPerMedItem = {
  medication_id: string;
  medication_name: string;
  average_mes: number;
  dose_count: number;
};

export type MEEPerMedResponse = {
  items: MEEPerMedItem[];
};

export type DriftResponseV2 = DriftResponse & {
  risk_level: string;
  drift_type: string;
};

export type OrchestrateResponse = {
  intervention_id: string;
  user_id: string;
  action_type: string;
  risk_level: string;
  reason: string;
  message: string;
  mee_score: number;
  drift_severity: string;
  timestamp: string;
};

export type InterventionItem = {
  intervention_id: string;
  user_id: string;
  action_type: string;
  risk_level: string;
  reason: string;
  message: string;
  timestamp: string;
};

export type InterventionListResponse = {
  items: InterventionItem[];
};

export type ChatMessageItem = {
  message_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  language: string;
  is_read: boolean;
  created_at: string;
};

export type ChatMessageListResponse = {
  items: ChatMessageItem[];
};

export type UnreadCountResponse = {
  unread_count: number;
};

export type CaregiverBriefing = {
  patient_name: string;
  risk: { level: string; score?: number; reason?: string } | string;
  adherence_pct: number;
  missed?: number;
  today_summary?: string;
  monitoring?: string[];
  escalations?: string[];
  actions: Array<{ text: string; reason?: string; confidence?: number }> | string[];
  source: "llm" | "fallback";
  confidence?: number;
};

export type MedRecommendationResponse = {
  medication_id: string;
  medication_name: string;
  recommendations: string[];
  confidence?: number | null;
  source: string;
};

export type CaregiverPatientSummary = {
  user_id: string;
  name: string;
  age: number;
  conditions: string[];
  medication_count: number;
  appointment_count: number;
};

export type CaregiverPatientListResponse = {
  items: CaregiverPatientSummary[];
};

export type CaregiverPatientDetail = {
  patient: UserProfile & { conditions?: string[] };
  medications: MedicationItem[];
  appointments: AppointmentItem[];
  dose_events: DoseEventItem[];
  interventions: InterventionItem[];
};

// --- Admin types ---

export type AdminAccountItem = {
  account_id: string;
  name: string;
  email: string;
  role: string;
  user_id: string | null;
  created_at: string;
};

export type AdminAccountListResponse = {
  items: AdminAccountItem[];
};

export type AdminInterventionItem = InterventionItem & {
  patient_name: string;
};

export type AdminInterventionListResponse = {
  items: AdminInterventionItem[];
};

// --- Refill reminder types ---

export type RefillStatusItem = {
  medication_id: string;
  name: string;
  dose_text: string;
  total_supply: number;
  taken_count: number;
  doses_remaining: number | null;
  days_remaining: number | null;
  is_low: boolean;
  needs_refill: boolean;
  tracking_enabled: boolean;
};

export type RefillStatusResponse = {
  items: RefillStatusItem[];
};

// --- Memory & Focus Check types ---

export type MemoryCheckQuestion = {
  type: "orientation" | "recall" | "attention";
  question: string;
  answer_hint?: string;
  words?: string[];
  answer?: string;
};

export type MemoryCheckStartResponse = {
  session_id: string;
  questions: MemoryCheckQuestion[];
};

export type MemoryCheckScoringDetail = {
  question: string;
  correct: boolean;
};

export type MemoryCheckResult = {
  session_id: string;
  user_id: string;
  questions: MemoryCheckQuestion[];
  expected_answers: string[];
  user_responses: string[];
  score: number;
  status: string;
  insight: string;
  completed: boolean;
  created_at: string;
  scoring_details?: MemoryCheckScoringDetail[];
  alert_triggered?: boolean;
  alert_message?: string;
};

export type MemoryCheckHistoryResponse = {
  sessions: MemoryCheckResult[];
};

export type MemoryCheckAnalysisResponse = {
  analysis: string;
  session_count: number;
  average_score: number | null;
  alert_notified?: boolean;
  alert_notified_at?: string;
};
