"use client";

import React from "react";

export default function TrendPredictionCard({ days, predictedPct, trendLabel, recommendation }: { days: number[]; predictedPct: number | null; trendLabel: string; recommendation: string }) {
  // days: array of 7 numbers (missed counts per day, oldest->newest)
  const max = Math.max(...days, 1);
  const points = days.map((d, i) => `${(i / (days.length - 1)) * 100},${100 - (d / max) * 70}`).join(' ');

  return (
    <section className="rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_4px_12px_rgba(16,24,40,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#1F2A37]">Trend & prediction</p>
          <p className="mt-1 text-[13px] text-[#344054]">{trendLabel}. {recommendation}</p>
        </div>
        <div className="flex flex-col items-end">
          <svg viewBox="0 0 100 100" className="h-12 w-28" preserveAspectRatio="none">
            <polyline fill="none" stroke="#3B6EF5" strokeWidth={2} points={points} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="mt-1 text-[12px] text-[#98A2B3]">Est. adherence: {predictedPct !== null ? `${predictedPct}%` : 'n/a'}</div>
        </div>
      </div>
    </section>
  );
}
