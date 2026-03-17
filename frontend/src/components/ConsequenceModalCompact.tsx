"use client";

import React from "react";
import { ArrowRight } from "lucide-react";

export default function ConsequenceModalCompact({ open, text, onConfirm, onClose }: { open: boolean; text: string; onConfirm: () => void; onClose: () => void; }) {
  if (!open) return null;
  return (
    <div className="fixed left-0 right-0 bottom-6 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#E6EEF9] bg-white px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-[#EEF4FF] grid place-items-center">
            <ArrowRight size={18} className="text-[#3B6EF5]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-[#344054] truncate">{text}</p>
            <p className="mt-1 text-[12px] text-[#98A2B3]">This will create a refill request on behalf of the patient.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="text-[13px] text-[#667085]">Cancel</button>
            <button type="button" onClick={onConfirm} className="inline-flex items-center gap-2 rounded-2xl bg-[#EF5A5A] px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm">
              <span>Confirm</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
