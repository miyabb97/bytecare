# ByteCare System Architecture

ByteCare is an Agentic AI health companion that helps chronic disease patients maintain medication adherence and daily health routines outside the clinical setting.

The system monitors behavioural signals, detects medication adherence drift, and proactively engages the patient while summarising key insights for caregivers and clinicians.

The MVP architecture is designed to run on standard development machines and be accessible through a mobile-responsive web application.

---

## 1. High Level System Architecture

### System Flow

```
User → Web Application → Backend API → Core Engines → AI Layer → Database → Output Modules
```

### Detailed Flow

Patient or Caregiver
→ interacts with mobile responsive web interface
→ requests handled by backend API
→ behaviour signals processed by medication adherence engines
→ agent orchestrator determines actions
→ AI chatbot generates responses
→ data stored in database
→ reports and alerts generated

---

## 2. System Modules

The ByteCare MVP consists of the following modules.

1. Engagement Interface
2. AI Chatbot Layer
3. Medication Evidence Engine (MEE)
4. Drift Detection Engine
5. Agent Orchestrator
6. Lifestyle Support Modules
7. Clinician Insight Engine
8. PDF Report Generator
9. Data Layer
10. Pillbox Simulation Engine

Each module should be implemented independently and communicate through API calls.

---

## 3. Engagement Interface (Frontend)

**Purpose:**
Provide the primary interface for patient interaction.

**Capabilities:**
- Chatbot conversation
- Medication schedule display
- Medication confirmation button
- Adherence calendar visualization
- Alerts and reminders
- Appointment reminders

**Technology requirements:**

- Frontend Framework: Next.js
- Language: TypeScript or JavaScript
- Styling: TailwindCSS
- Layout: Mobile responsive design

**Supported devices:**
- Mobile browsers
- Tablets
- Desktop browsers

---

## 4. AI Chatbot Layer

**Purpose:**
Provide conversational interaction with the patient.

**Model:**

MERaLiON (multilingual model supporting Singlish and Southeast Asian languages)

**Capabilities:**
- Medication reminders
- Adherence check-ins
- Lifestyle nudges
- Simple health education
- Emotional tone responses

**Example interaction:**

User input:
```
"I forgot to take my medicine."
```

Chatbot response:
```
"No worries Mr Tan. Would you like me to set a reminder so you don't miss tomorrow's dose?"
```

---

## 5. Behaviour Signal Layer

This layer collects behavioural signals used to estimate medication adherence.

**Supported signals:**

- `pillbox_open_event`
- `manual_dose_confirmation`
- `voice_confirmation`
- `timing_deviation`
- `refill_delay`

These signals are passed into the Medication Evidence Engine.

---

## 6. Medication Evidence Engine (MEE)

**Purpose:**
Compute Medication Evidence Score (MES) for each medication dose.

**MES range:**
0 to 100

MES represents the likelihood that a medication dose was taken.

**Important:**
- MES estimates adherence likelihood
- MES does NOT confirm ingestion

**Inputs:**

- `pillbox_event`
- `manual_confirmation`
- `voice_confirmation`
- `dose_time`
- `scheduled_time`
- `recent_adherence_history`

**Example scoring model:**

- pillbox_event = 40 points
- timing_consistency = 30 points
- routine_consistency = 20 points

**MES example calculation:**

```
MES = pillbox_event + timing_consistency + routine_consistency
```

**Example result:**

```
MES = 90
```

The score is stored per medication dose event.

---

## 7. Drift Detection Engine

**Purpose:**
Detect behavioural changes indicating declining medication adherence.

**Drift detection rules:**

Drift occurs when ANY of the following conditions are met:
- Three or more missed doses within seven days
- Seven day rolling MES average drops by twenty or more points
- Two or more doses taken more than two hours outside scheduled window within seven days

**Example drift output:**

```
drift_type = "Adherence Drift"
severity = "Orange"
pattern = "Morning doses missed"
```

Drift events are passed to the Agent Orchestrator.

---

## 8. Agent Orchestrator

**Purpose:**
Determine the next best action based on system signals.

**Inputs:**

- MES score
- Drift alerts
- User interaction history
- Medication criticality

**Possible actions:**

- `send_patient_nudge`
- `suggest_routine_change`
- `recommend_food_swap`
- `suggest_jio_event`
- `alert_caregiver`
- `include_in_clinician_report`

**Example decision logic:**

```
If MES >= 80
→ send encouragement message

If MES between 60 and 79
→ send gentle reminder

If MES < 60
→ notify caregiver

If sustained drift detected
→ include issue in clinician report
```

---

## 9. Lifestyle Support Modules

These modules support healthy daily habits.

### Food Recommendation Module

**Purpose:**

Suggest healthier alternatives for common meals.

**Example:**

User logs meal:
```
"Chicken rice"
```

Suggestion:
```
"You could try brown rice or reduce sauce to help maintain blood sugar control."
```

### Day Planner Module

**Purpose:**

Help patients structure daily routines.

**Features:**

- Medication schedule
- Walking reminders
- Meal reminders
- Sleep schedule

### Appointment Tracker

**Purpose:**

Track upcoming clinic appointments.

**Features:**

- Appointment reminders
- Countdown notifications
- Missed appointment alerts

### Medication Restock Tracker

**Purpose:**

Detect refill delays.

**Example:**

Medication refill overdue by three days.

System suggestion:
```
"Consider visiting the pharmacy to refill your medication."
```

### Jio Event Module

**Purpose:**

Encourage social participation and reduce isolation.

**Example message:**

```
"Mr Tan, there is a community walking group at the nearby Active Ageing Centre this Saturday."
```

---

## 10. TCM Safety Check Module

**Purpose:**

Detect possible herb–drug interactions.

**Workflow:**
1. User uploads photo of herbal product
2. OCR extracts product name
3. System checks interaction dataset
4. Safety advisory returned

**Example response:**

```
"This herbal supplement may interact with your blood thinner medication."
```

---

## 11. Clinician Insight Engine

**Purpose:**

Summarize patient adherence behaviour for healthcare professionals.

**Reports include:**

- Adherence trend
- Drift events
- Intervention history
- Medication adherence summary

This reduces clinician review burden.

---

## 12. PDF Report Generator

**Purpose:**

Generate clinic-ready summary reports.

**Report sections:**

- Patient summary
- Medication list
- Adherence percentage
- MES trend chart
- Drift detection summary
- Recommendations

**Output format:**

PDF file suitable for clinic visits.

---

## 13. Data Layer

**Database system:**

PostgreSQL

**Stored data types:**

- Patient profiles
- Medication schedules
- Medication events
- MES history
- Drift alerts
- Chatbot interactions
- Appointment reminders

---

## 14. Pillbox Simulation Engine

**Purpose:**

Simulate medication adherence behaviour for demo.

**Example simulation:**

```
Day 1 to Day 7
All doses taken

Day 8 to Day 9
Morning doses missed

Day 10 to Day 14
Irregular timing
```

These events feed into the Medication Evidence Engine.

---

## 15. Security and Privacy

The system follows basic healthcare data safety principles.

**Key safeguards:**

- Explicit user consent for voice logging
- Minimal data collection
- Encrypted data storage
- Limited retention of personal health data

ByteCare does not store full medical records.

---

## 16. MVP Deployment Stack

**Recommended development stack:**

**Frontend**
- Next.js
- React
- TailwindCSS

**Backend**
- Node.js
- Express

**Database**
- PostgreSQL

**AI Model**
- MERaLiON API

**PDF Generation**
- Server side PDF generator

The MVP should run locally on developer machines and deploy easily to cloud platforms.

---

## 17. Future Extensions

Future versions may integrate:

- Smart pillbox hardware
- Wearable devices
- Hospital EHR systems
- Continuous glucose monitors
