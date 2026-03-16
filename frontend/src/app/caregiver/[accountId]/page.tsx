"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Calendar,
  ChevronRight,
  MessageSquare,
  Phone,
  Pill,
  PlusCircle,
  Siren,
} from "lucide-react";

import type { Account } from "../../../lib/api";
import {
  ActionTile,
  AlertCard,
  BadgePill,
  ChartCard,
  Header,
  QuickActionRow,
  SectionTitle,
  TabBar,
} from "../../../components/mobile/DashboardPrimitives";

function loadAccount(router: ReturnType<typeof useRouter>, setAccount: (value: Account) => void) {
  const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
  if (!raw) {
    router.replace("/auth/signin");
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Account;
    if (parsed.role !== "caregiver") {
      router.replace("/auth/signin");
      return;
    }
    setAccount(parsed);
  } catch {
    router.replace("/auth/signin");
  }
}

export default function CaregiverDashboardPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAccount(router, setAccount);
  }, [router]);

  const tabs = useMemo(
    () => [
      { key: "dashboard", label: "Dashboard", icon: <Pill size={18} strokeWidth={2.1} /> },
      { key: "patients", label: "Patients", icon: <Siren size={18} strokeWidth={2.1} /> },
      { key: "messages", label: "Messages", icon: <MessageSquare size={18} strokeWidth={2.1} /> },
      { key: "settings", label: "Settings", icon: <Calendar size={18} strokeWidth={2.1} /> },
    ],
    []
  );

  if (!account) return null;

  return (
    <main className="flex min-h-screen justify-center bg-white">
      <div ref={shellRef} className="relative min-h-screen w-full max-w-md bg-[#F8FAFC] pb-24">
        <Header
          title="ByteCare - Caregiver"
          left={
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#C9D9FF] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
              <PlusCircle size={19} className="text-[#3B6EF5]" />
            </div>
          }
          right={
            <>
              <button type="button" className="relative grid h-11 w-11 place-items-center rounded-full bg-[#3B6EF5] text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]">
                <Bell size={19} />
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-white bg-[#EF5A5A]" />
              </button>
            </>
          }
        />

        <section className="space-y-5 px-3 pb-8 pt-4">
          <section className="overflow-hidden rounded-2xl border border-[#D7E2F3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="relative h-[190px] bg-[#235B6A]">
              <div className="absolute right-3 top-3">
                <BadgePill label="SEVERITY: RED" tone="red" />
              </div>
              <div className="absolute bottom-[-24px] right-6 h-[150px] w-[130px] rounded-t-[120px] bg-[#F6EBD9]" />
              <div className="absolute bottom-0 right-8 h-[98px] w-[98px] rounded-full bg-[#EED7BD]" />
            </div>

            <div className="space-y-3 border-t border-[#E9EEF7] px-4 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[34px] font-bold leading-none text-[#1F2A37]">Mr. Tan Guan</h2>
                  <p className="mt-1 text-[13px] font-semibold tracking-[0.02em] text-[#EF5A5A]">STATUS: DECLINING</p>
                </div>
                <p className="rounded-full bg-[#F2F4F7] px-2 py-1 text-[11px] font-semibold text-[#98A2B3]">ID: 4492-BC</p>
              </div>

              <button
                type="button"
                className="w-full rounded-xl bg-[#3B6EF5] py-3 text-[15px] font-semibold text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]"
              >
                View Full Medical Profile
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle title="Medication Adherence" />
            <ChartCard>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[12px] font-medium text-[#98A2B3]">MES Score Trend</p>
                  <p className="mt-1 text-[44px] font-bold leading-none text-[#1F2A37]">82%</p>
                </div>
                <p className="mt-2 text-right text-[13px] font-semibold text-[#EF5A5A]">↓ 5.2%<br /><span className="text-[11px] font-medium text-[#98A2B3]">vs last 7 days</span></p>
              </div>

              <div className="mt-3">
                <svg viewBox="0 0 320 120" className="h-[110px] w-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="caregiverLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5D8BFF" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#5D8BFF" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M10 86 C35 60, 60 52, 84 64 C102 73, 124 72, 145 52 C160 38, 176 34, 192 50 C208 67, 225 99, 244 113 C262 94, 282 84, 307 42" fill="none" stroke="#3B6EF5" strokeWidth="3" />
                  <path d="M10 86 C35 60, 60 52, 84 64 C102 73, 124 72, 145 52 C160 38, 176 34, 192 50 C208 67, 225 99, 244 113 C262 94, 282 84, 307 42 L307 120 L10 120 Z" fill="url(#caregiverLineFill)" />
                </svg>
                <div className="mt-1 grid grid-cols-7 text-center text-[10px] font-semibold text-[#98A2B3]">
                  <span>MON</span>
                  <span>TUE</span>
                  <span>WED</span>
                  <span>THU</span>
                  <span>FRI</span>
                  <span>SAT</span>
                  <span>SUN</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 border-t border-[#E9EEF7] pt-3 text-center">
                <div>
                  <p className="text-[24px] font-bold leading-none text-[#1F2A37]">2</p>
                  <p className="mt-1 text-[11px] text-[#98A2B3]">Missed</p>
                </div>
                <div>
                  <p className="text-[24px] font-bold leading-none text-[#1F2A37]">4</p>
                  <p className="mt-1 text-[11px] text-[#98A2B3]">Late</p>
                </div>
                <div>
                  <p className="text-[24px] font-bold leading-none text-[#1F2A37]">18</p>
                  <p className="mt-1 text-[11px] text-[#98A2B3]">On-time</p>
                </div>
              </div>
            </ChartCard>
          </section>

          <section className="space-y-2">
            <SectionTitle title="Active Alerts" />
            <AlertCard
              tone="red"
              title="Missed doses detected"
              description="Statin & Beta-blocker doses missed in the last 24 hours."
              action="Suggested: Send Reminder →"
              icon={<Pill size={15} className="text-[#EF5A5A]" />}
            />
            <AlertCard
              tone="yellow"
              title="Drift detected"
              description="Vocal patterns indicate increased anxiety and cognitive fatigue."
              action="Suggested: Schedule Call →"
              icon={<Siren size={15} className="text-[#E7A93B]" />}
            />
          </section>

          <section className="space-y-2">
            <SectionTitle title="Recent Chat History" />
            <ChartCard>
              <div className="space-y-3">
                <div className="max-w-[86%] rounded-2xl bg-[#EEF2F7] px-3 py-2 text-[13px] text-[#475467]">
                  Hi Mr. Tan, have you taken your morning medication?
                  <p className="mt-1 text-[10px] text-[#98A2B3]">ByteCare AI • 08:30 AM</p>
                </div>
                <div className="ml-auto max-w-[86%] rounded-2xl bg-[#3B6EF5] px-3 py-2 text-[13px] text-white">
                  I forgot. My head feels a bit heavy today.
                  <p className="mt-1 text-right text-[10px] text-blue-100">Mr. Tan • 09:19 AM</p>
                </div>
              </div>
              <button type="button" className="mt-4 w-full rounded-xl border border-[#D8E5FF] bg-[#F5F8FF] py-2 text-[13px] font-semibold text-[#3B6EF5]">
                Open Full Conversation
              </button>
            </ChartCard>
          </section>

          <section className="space-y-2">
            <SectionTitle title="Caregiver Actions" />
            <QuickActionRow>
              <ActionTile icon={<Siren size={18} />} label="Send Reminder" />
              <ActionTile icon={<Phone size={18} />} label="Call Patient" />
              <ActionTile icon={<Calendar size={18} />} label="Schedule Appt" />
            </QuickActionRow>
          </section>

          <section className="space-y-2">
            <SectionTitle title="Support Suggestions" />
            <section className="overflow-hidden rounded-2xl border border-[#E9EEF7] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              {[
                { title: "Morning Garden Walk", subtitle: "Light physical activity" },
                { title: "Silver Community Tea", subtitle: "Social interaction (High rec.)" },
                { title: "Cognitive Puzzle App", subtitle: "Memory improvement session" },
              ].map((item, index) => (
                <div key={item.title} className={`flex items-center justify-between px-4 py-3 ${index > 0 ? "border-t border-[#E9EEF7]" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#F2F4F7]">
                      <Siren size={14} className="text-[#667085]" />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-[#1F2A37]">{item.title}</p>
                      <p className="text-[12px] text-[#98A2B3]">{item.subtitle}</p>
                    </div>
                  </div>
                  <PlusCircle size={16} className="text-[#98A2B3]" />
                </div>
              ))}
            </section>
          </section>
        </section>

        <TabBar tabs={tabs} active="dashboard" containerRef={shellRef} />
      </div>
    </main>
  );
}
