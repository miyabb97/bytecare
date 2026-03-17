"use client";

import React, { useEffect, useMemo, useState } from "react";

type Medication = {
  medication_id: string;
  name: string;
  schedule: { frequency: string; times: string[] };
};

type DoseEvent = {
  event_id: string;
  medication_id: string;
  event_type: string;
  response_status: string;
  timestamp: string; // ISO
  scheduled_for?: string;
};

type Props = {
  accountId: string;
  patientUserId: string;
  days?: number;
  singleMedId?: string | null;
};

function mealAnchorsForDay(base: Date) {
  const anchors: { name: string; dt: Date }[] = [];
  const breakfast = new Date(base);
  breakfast.setHours(7, 0, 0, 0);
  anchors.push({ name: "breakfast", dt: breakfast });
  const lunch = new Date(base);
  lunch.setHours(12, 0, 0, 0);
  anchors.push({ name: "lunch", dt: lunch });
  const dinner = new Date(base);
  dinner.setHours(18, 0, 0, 0);
  anchors.push({ name: "dinner", dt: dinner });
  return anchors;
}

function nearestMealOffsetMinutes(evDt: Date) {
  const anchors = mealAnchorsForDay(evDt);
  let best = { name: "", minutes: Infinity };
  for (const a of anchors) {
    const diff = Math.round((evDt.getTime() - a.dt.getTime()) / 60000);
    if (Math.abs(diff) < Math.abs(best.minutes)) best = { name: a.name, minutes: diff };
  }
  return best; // minutes positive = after meal, negative = before
}

export default function MedicationEatingPatternCard({ accountId, patientUserId, days = 14, singleMedId = null }: Props) {
  const [loading, setLoading] = useState(true);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [events, setEvents] = useState<DoseEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/caregiver/${accountId}/patients/${patientUserId}`)
      .then((r) => r.json())
      .then((data) => {
        setMeds(data.medications || []);
        setEvents(data.dose_events || []);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [accountId, patientUserId]);

  const stats = useMemo(() => {
    const medsToProcess = singleMedId ? meds.filter(x => x.medication_id === singleMedId) : meds;
    if (!medsToProcess.length) return [];
    return medsToProcess.map((m) => {
      const medEvents = events.filter((e) => e.medication_id === m.medication_id && (e.response_status === "taken" || e.event_type === "pillbox_open" || e.event_type === "tap_confirm" || e.event_type === "voice_confirm"));
      const takenCount = medEvents.length;
      let withMealCount = 0;
      let totalOffset = 0;
      let offsetCount = 0;
      const perMeal: Record<string, number> = { breakfast: 0, lunch: 0, dinner: 0, unknown: 0 };

      medEvents.forEach((ev) => {
        try {
          const evDt = new Date(ev.timestamp);
          const nearest = nearestMealOffsetMinutes(evDt);
          const mealName = nearest && nearest.name ? nearest.name : "unknown";
          // with meal if within -30..+90 minutes of meal
          if (nearest && Math.abs(nearest.minutes) <= 90 && nearest.minutes >= -30) {
            withMealCount += 1;
            perMeal[mealName] = (perMeal[mealName] || 0) + 1;
          } else {
            perMeal[mealName] = (perMeal[mealName] || 0) + 0;
          }
          totalOffset += Math.abs(nearest.minutes);
          offsetCount += 1;
        } catch (e) {
          perMeal.unknown = (perMeal.unknown || 0) + 0;
        }
      });

      // estimate expected scheduled count from medication schedule
      const expectedPerDay = (m.schedule && m.schedule.times && m.schedule.times.length) ? m.schedule.times.length : 1;
      const expectedTotal = expectedPerDay * days;
      const missedEstimated = Math.max(0, expectedTotal - takenCount);

      const percentWithMeal = takenCount ? Math.round((withMealCount / takenCount) * 100) : 0;
      const avgOffset = offsetCount ? Math.round(totalOffset / offsetCount) : null;

      // derive insights
      const insights: string[] = [];
      const suggestions: string[] = [];

      // sample size check
      if (takenCount < 3) {
        insights.push("Insufficient data: only a few recorded intakes.");
        suggestions.push("Monitor for more events over the next 1–2 weeks before changing routines.");
      } else {
        // dominant meal
        const mealCounts = Object.entries(perMeal).filter(([k]) => k !== "unknown");
        const top = mealCounts.sort((a, b) => (b[1] as number) - (a[1] as number))[0];
        if (top && top[1] > 0) {
          const mealName = top[0];
          const share = Math.round(((top[1] as number) / takenCount) * 100);
          if (share >= 60) {
            insights.push(`Usually taken around ${mealName} (${share}% of recorded intakes).`);
            suggestions.push(`Coordinate reminders to align with ${mealName} (e.g., prompt 15 min before).`);
          } else if (share >= 35) {
            insights.push(`Often taken near ${mealName}, but not consistently (approx ${share}%).`);
            suggestions.push(`Consider gentle check-ins around ${mealName} to improve consistency.`);
          } else {
            insights.push(`No dominant meal association; intake timing is variable.`);
            suggestions.push(`Use a consistent reminder time or caregiver check-ins to stabilise routine.`);
          }
        } else {
          insights.push("No clear meal association detected.");
          suggestions.push("Encourage patient to take medication with a regular meal or at a fixed time.");
        }

        // timing delay insight
        if (avgOffset !== null) {
          if (avgOffset > 60) {
            insights.push("Intake tends to occur considerably away from meal anchors (often delayed)." );
            suggestions.push("Set an earlier reminder or ask caregiver to check-in around the usual meal.");
          } else if (avgOffset > 20) {
            insights.push("Occasional delays relative to meal times.");
            suggestions.push("Try a brief reminder 20–30 minutes before the typical meal time.");
          }
        }

        // missed dose heuristic
        if (missedEstimated >= Math.max(1, Math.round(expectedTotal * 0.2))) {
          insights.push(`Estimated ${missedEstimated} missed doses in the lookback window.`);
          suggestions.push("Check medication supply and consider assisting with a refill or supervised dosing.");
        }
      }

      return {
        medication_id: m.medication_id,
        name: m.name,
        takenCount,
        withMealCount,
        percentWithMeal,
        avgOffset,
        expectedTotal,
        missedEstimated,
        insights,
        suggestions,
      };
    });
  }, [meds, events, days, singleMedId]);

  if (loading) return <div className="p-4 bg-white rounded shadow-sm">Loading medication eating patterns…</div>;
  if (error) return <div className="p-4 bg-red-50 text-red-700 rounded">Error: {error}</div>;

  return (
    <div className="p-4 bg-white rounded-lg shadow-sm">
      <h3 className="text-sm font-semibold mb-2">Medication & Meal Association (last {days} days)</h3>
      <div className="text-xs text-gray-600 mb-3">Shows how often each medication was taken around meal times (inferred).</div>

      <div className="space-y-3">
        {stats.map((m) => (
          <div key={m.medication_id} className="border-b border-[#EEF2F6] pb-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{m.name}</div>
                <div className="text-xs text-gray-500">Taken {m.takenCount} times · {m.withMealCount} with meal</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-32">
                  <div className="h-3 w-full bg-gray-100 rounded overflow-hidden">
                    <div style={{ width: `${m.percentWithMeal}%` }} className="h-full bg-amber-400" />
                  </div>
                </div>
                <div className="text-xs text-gray-600 w-16 text-right">{m.percentWithMeal}%</div>
              </div>
            </div>

            {/* Insights */}
            {m.insights && m.insights.length > 0 && (
              <div className="mt-2 text-[13px] text-[#344054]">
                {m.insights.map((ins, idx) => (
                  <div key={idx} className={idx === 0 ? "" : "mt-1 text-[13px] text-[#475467]"}>• {ins}</div>
                ))}
              </div>
            )}

            {/* Suggestions (first one shown) */}
            {m.suggestions && m.suggestions.length > 0 && (
              <div className="mt-2 text-xs text-[#667085]">
                <div className="font-semibold text-[#1F2A37]">Suggested caregiver action</div>
                <div className="mt-1">• {m.suggestions[0]}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t text-sm text-gray-700">
        <div className="flex justify-between items-center">
          <div>Interpretation</div>
          <div className="text-xs text-gray-500">&gt;50% = usually taken with meals</div>
        </div>
      </div>
    </div>
  );
}
