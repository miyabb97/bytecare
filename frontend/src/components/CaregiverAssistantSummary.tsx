"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { CaregiverPatientDetail, CaregiverBriefing } from "../lib/api";
import { SummaryCard } from "./mobile/DashboardPrimitives";

type TrendProps = {
  days?: number[];
  predictedPct?: number | null;
  trendLabel?: string;
  recommendation?: string;
};

function firstNSentences(text: string, n: number) {
  const parts = text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()) || [text];
  return parts.slice(0, n).join(' ').trim();
}

export default function CaregiverAssistantSummary({ detail, briefing, stats, days, predictedPct, trendLabel, recommendation }: { detail: CaregiverPatientDetail | null; briefing?: CaregiverBriefing | null; stats?: { taken: number; missed: number; late: number; pct: number } | null } & TrendProps) {
  if (!detail) return null;

  let summary = "";

  if (briefing && typeof briefing.today_summary === 'string' && briefing.today_summary.trim().length > 0) {
    summary = firstNSentences(briefing.today_summary, 3);
  } else if (stats) {
    const name = detail.patient.name.split(' ')[0];
    const missed = stats.missed;
    const pct = stats.pct;

    const s1 = `${name}’s adherence over the last week is ${pct}%.`;
    const s2 = missed > 0
      ? `${name} missed ${missed} dose${missed !== 1 ? 's' : ''} in the past 7 days.`
      : `No missed doses were recorded in the past week.`;
    const s3 = missed > 0
      ? `Consider a gentle check-in or sending a reminder to help them stay on track.`
      : `Keep up regular check-ins to maintain this routine.`;

    summary = [s1, s2, s3].slice(0, 3).join(' ');
  } else {
    summary = `Summary unavailable — try refreshing or generating a briefing.`;
  }

  const final = firstNSentences(summary, 3);

  return (
    <SummaryCard title="Quick summary" icon={<Sparkles size={16} className="text-[#3B6EF5]" />}>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#344054] leading-6 min-w-0">{final}</p>
        {days && days.length > 0 && (
          <div className="ml-3 flex flex-col items-end">
            <svg viewBox="0 0 100 40" className="h-8 w-24" preserveAspectRatio="none">
              <polyline fill="none" stroke="#3B6EF5" strokeWidth={2} points={days.map((d,i)=>`${(i/(days.length-1))*100},${40 - (d/Math.max(...days,1))*30}`).join(' ')} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="mt-1 text-[12px] text-[#98A2B3]">{trendLabel ?? ''}</div>
            {predictedPct !== undefined && predictedPct !== null && (
              <div className="text-[12px] text-[#667085]">Est. {predictedPct}%</div>
            )}
          </div>
        )}
      </div>
    </SummaryCard>
  );
}
