# ByteCare Specification

## Purpose

ByteCare is an **Agentic AI health companion** designed to help chronic disease patients maintain medication adherence and daily health routines outside the clinical setting.

### The Problem

Many chronic disease patients struggle with:
- Forgetting medication
- Inconsistent daily routines
- Missed appointments
- Poor lifestyle habits
- Limited support between doctor visits

Traditional reminder apps only send passive alerts. They cannot detect behavioural changes or proactively intervene.

### The Solution

ByteCare addresses this gap by:
1. Estimating medication adherence likelihood
2. Detecting behavioural drift over time
3. Proactively engaging the patient
4. Escalating important insights to clinicians

ByteCare acts as a risk-aware digital companion that helps patients stay on track and helps clinicians intervene earlier.

---

## Target User Persona

**Primary User: Mr Tan**

Mr Tan is a 68-year-old Singaporean patient with:
- Type 2 Diabetes
- Hypertension

Mr Tan lives alone and manages multiple medications.

He often:
- Forgets to take medication
- Delays clinic appointments
- Eats unhealthy meals when tired
- Becomes socially isolated

His doctor cannot monitor his daily behaviour between visits.

ByteCare aims to support patients like Mr Tan.

---

## ByteCare Core Capabilities

### 1. Medication Adherence Intelligence

ByteCare uses multiple signals to estimate whether a medication dose was likely taken.

**Signals include:**
- Pillbox open events
- Manual confirmation
- Voice confirmation
- Timing deviations
- Refill delays

These signals are combined to generate a **Medication Evidence Score (0–100)**.

The score represents the likelihood that the medication dose was taken.

Risk Level
Condition (example)
Action
Low:
MES ≥ 80, no drift
Celebrate + tip
Medium:
MES 60–79 or mild drift
Gentle nudge + ask barrier
High:
MES < 60 or sustained drift
Caregiver alert + include in clinician PDF
Critical:
Severe drift + high-criticality med
Immediate caregiver alert + suggest clinic contact

### 2. Behaviour Drift Detection

ByteCare continuously monitors adherence patterns.

If behaviour changes significantly, ByteCare detects behaviour drift.

**Examples:**
- Multiple missed doses
- Large drop in adherence score
- Irregular medication timing

This helps identify problems early.

### 3. Proactive Patient Engagement

Instead of passive reminders, ByteCare takes context-aware actions.

**Examples:**
- Gentle check-in messages
- Suggestions to adjust medication schedule
- Food swap suggestions
- Invitations to community activities ("Jio events")

ByteCare communicates using natural conversational tone.

### 4. Clinician Insight Summaries

ByteCare summarizes patient behaviour into concise reports for clinicians.

These reports include:
- Adherence trends
- Drift events
- Intervention history
- Potential risks

This allows clinicians to intervene without reviewing large volumes of data.

---

## Safety Principles

ByteCare must follow strict safety rules.

### What ByteCare Must NOT Do

- **Diagnose medical conditions** - ByteCare does not diagnose or interpret symptoms
- **Change medication prescriptions** - ByteCare does not prescribe, adjust doses, or suggest medication switches
- **Replace clinical advice** - ByteCare escalates to healthcare professionals for clinical decisions

### What ByteCare Can Do

- Provide adherence support through reminders and check-ins
- Offer general lifestyle suggestions (e.g., meal planning, activity ideas)
- Recommend consulting healthcare professionals
- Summarize adherence data for clinician review

---

## Demo Flow

### 1. Create User
```
Input: Name (Mr Tan), Age (72), Timezone (UTC+8)
Output: User profile created, ready for medication entry
```

### 2. Add Medications
```
Input:
- Amlodipine 5mg (1 tablet, every morning)
- Metformin 500mg (1 tablet, twice daily with meals)
- Aspirin 100mg (1 tablet, every morning)
- Paracetamol 500mg (as needed, max 3x daily)
- Diclofenac 50mg (1 tablet, 3x daily with meals)

Output: Medication list displayed with schedule and criticality flags
```

### 3. Simulate 14 Days
```
Day 1–7: All doses taken on time → MES: 95 (Green)
Day 8–9: Mr Tan travels; skips 2 morning doses → MES: 85 (Yellow)
Day 10–14: Medication confusion; misses 3 more doses → MES: 62 (Yellow → Orange drift)

Output: Adherence calendar, MES trend graph, drift timeline
```

### 4. See Drift Detection
```
Drift Alert:
- Type: Adherence Drift (4 missed doses in 7 days)
- Severity: Orange (Moderate Concern)
- Pattern: Morning doses missed on travel days
- Potential Impact: Reduced effectiveness of blood pressure management if missed doses persist.
- Recommendation: Set phone alarm, use pill organizer, involve family check-ins
- Detects behavioural drift when any of the following conditions occur:
    • ≥3 missed doses within a 7-day window
    • 7-day rolling MES average drops by ≥20 points compared to baseline
    • ≥2 medication doses taken more than 2 hours outside the scheduled time window within 7 days
- Example Drift Alert

Type: Adherence Drift
Severity: Orange (Moderate Concern)

Pattern detected:
Morning doses missed during travel days.

Potential impact:
Reduced effectiveness of blood pressure management if missed doses persist.

Recommended actions:
• Set a phone reminder
• Use a pill organizer
• Ask family members to check in regularly
```

### 5. ByteCare Nudges
```
Notification 1 (Day 11): "Hi Mr Tan, we noticed you missed your morning BP medication yesterday. Would you like to set a phone reminder?"

Notification 2 (Day 13): "Mr Tan, three doses have been missed this week. Your blood pressure medication works best when taken consistently. Your daughter can help you set up a reminder system."

Alert to Caregiver: "Mr Tan's medication adherence has declined to 62% (Orange level). Pattern: missing morning doses while traveling. Please check in with him about support needs."
```

### 6. Export PDF Report
```
Report Includes:
✓ Patient summary (name, age, condition overview)
✓ Medication list with adherence % per medication
✓ 14-day adherence calendar (visual grid)
✓ MES trend chart (day-by-day score)
✓ Drift detection summary with timestamps
✓ Risk assessment and recommendations
✓ Caregiver alerts log
✓ Disclaimer and next steps

Output: PDF ready to print or email to healthcare provider
```

---

## Technical Constraints

- **Simulation Window**: Up to 30 days of historical or projected data
- **Medication Limit**: Up to 15 concurrent medications per user
- **MES Recalculation**: Real-time updates as new adherence data is logged
- **Voice Logging**: Optional; requires explicit consent from user and caregiver
- **PDF Export**: Available only after day 3 of tracking (minimum data for meaningful report)
- **Data Retention**: 2 years of historical data; older records archived

---

## Success Metrics

A successful ByteCare engagement demonstrates:
1. **Awareness**: Patient/caregiver recognizes their adherence pattern
2. **Action**: At least one behavioral change (reminder set, family involvement, clinic appointment booked)
3. **Sustainability**: Improved adherence score or maintained consistency over 30+ days
4. **Trust**: User returns to ByteCare for ongoing monitoring

---

## Next Steps

- **Development**: Implement simulator engine, MEE (Medication Evidence Engine), and drift detection
- **Testing**: Validate with Mr Tan demo and test cases for edge scenarios
- **Deployment**: Beta test with patient cohort; gather feedback for UX refinement
- **Integration**: Connect to EHR systems and wearable devices for real-time data

---

## System Modules

ByteCare MVP consists of the following modules:

### 1. Pillbox Simulator
Generates simulated medication events for testing.

### 2. Medication Evidence Engine (MEE)
Computes adherence likelihood score.

### 3. Drift Detection Engine
Detects behavioural drift from score patterns.

### 4. Orchestrator
Determines the next best action.

### 5. Engagement Interface
Chat and voice interactions with the patient.

### 6. TCM Safety Check
Checks herbal supplements against medication list.

### 7. Clinician PDF Export
Generates weekly summary reports.
