"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BriefcaseMedical,
  MessageSquare,
  Stethoscope,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";

import type { Account } from "../../../lib/api";
import {
  BadgePill,
  ChartCard,
  Header,
  PatientCard,
  SectionTitle,
  SummaryCard,
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
    if (parsed.role !== "clinician") {
      router.replace("/auth/signin");
      return;
    }
    setAccount(parsed);
  } catch {
    router.replace("/auth/signin");
  }
}

export default function ClinicianDashboardPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    loadAccount(router, setAccount);
  }, [router]);

  const tabs = useMemo(
    () => [
      { key: "patients", label: "PATIENTS", icon: <Users size={18} strokeWidth={2.1} /> },
      { key: "insights", label: "INSIGHTS", icon: <TrendingUp size={18} strokeWidth={2.1} /> },
      { key: "messages", label: "MESSAGES", icon: <MessageSquare size={18} strokeWidth={2.1} /> },
      { key: "profile", label: "PROFILE", icon: <UserRound size={18} strokeWidth={2.1} /> },
    ],
    []
  );

  if (!account) return null;

  return (
    <main className="flex min-h-screen justify-center bg-white">
      <div className="relative min-h-screen w-full max-w-md bg-[#F8FAFC] pb-24">
        <Header
          title="ByteCare - Clinician"
          left={
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#C9D9FF] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
              <BriefcaseMedical size={19} className="text-[#3B6EF5]" />
            </div>
          }
          right={
            <>
              <button type="button" className="grid h-11 w-11 place-items-center rounded-full bg-[#3B6EF5] text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]">
                <Bell size={19} />
              </button>
              <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-[#D8E5FF] bg-[#EEF4FF] shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
                <div className="h-7 w-7 rounded-full bg-[#C5D4ED]" />
              </div>
            </>
          }
        />

        <section className="space-y-5 px-3 pb-8 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[40px] font-bold leading-none text-[#1F2A37]">Active Patients</h2>
            <BadgePill label="12 Active" tone="blue" />
          </div>

          <PatientCard>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="relative grid h-14 w-14 place-items-center rounded-full bg-[#E7EDF8]">
                  <UserRound size={24} className="text-[#6B7280]" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#EF5A5A]" />
                </div>
                <div>
                  <p className="text-[36px] font-bold leading-none text-[#1F2A37]">Mr Tan</p>
                  <p className="mt-1 text-[13px] text-[#667085]">Condition: Diabetes</p>
                </div>
              </div>
              <BadgePill label="HIGH RISK" tone="red" />
            </div>

            <div className="mt-4 border-t border-[#E9EEF7]">
              <div className="grid grid-cols-3 text-center text-[15px] font-semibold text-[#667085]">
                <button type="button" className="mt-0 rounded-t-lg bg-[#3B6EF5] py-3 text-white">Overview</button>
                <button type="button" className="mt-0 border-b border-[#E9EEF7] bg-transparent py-3 text-[#667085]">Medications</button>
                <button type="button" className="mt-0 border-b border-[#E9EEF7] bg-transparent py-3 text-[#667085]">Conditions</button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <article className="rounded-2xl bg-[#F9FAFB] p-3">
                <p className="text-[11px] font-bold text-[#98A2B3]">MES SCORE</p>
                <div className="mt-1 flex items-end gap-2">
                  <span className="text-[44px] font-bold leading-none text-[#EF5A5A]">62</span>
                  <span className="mb-1 text-[13px] font-semibold text-[#EF5A5A]">▼12%</span>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-[#E9EEF7]">
                  <div className="h-full w-[74%] rounded-full bg-[#EF5A5A]" />
                </div>
              </article>

              <article className="rounded-2xl bg-[#F9FAFB] p-3">
                <p className="text-[11px] font-bold text-[#98A2B3]">ADHERENCE</p>
                <div className="mt-1 flex items-end gap-2">
                  <span className="text-[44px] font-bold leading-none text-[#1F2A37]">74%</span>
                  <span className="mb-1 text-[12px] font-semibold text-[#98A2B3]">⌁</span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  <span className="h-1.5 rounded-full bg-[#3B6EF5]" />
                  <span className="h-1.5 rounded-full bg-[#3B6EF5]" />
                  <span className="h-1.5 rounded-full bg-[#EF7D7D]" />
                  <span className="h-1.5 rounded-full bg-[#EF7D7D]" />
                </div>
              </article>
            </div>

            <section className="mt-4 rounded-2xl border border-[#F0E1B7] bg-[#FFF8E8] p-3">
              <p className="text-[16px] font-semibold text-[#9A6A20]">⚠ Drift Detected: Schedule Shift</p>
              <p className="mt-1 text-[14px] leading-5 text-[#A3722A]">
                Patient has shifted doses by &gt;4 hours. Severity: Moderate. Morning Metformin consistently missed.
              </p>
            </section>

            <SummaryCard title="Clinician Summary Report" icon={<Stethoscope size={16} className="text-[#3B6EF5]" />}>
              <p className="text-[14px] italic leading-6 text-[#667085]">
                "Patient demonstrated declining medication adherence over the past week with multiple missed morning doses,
                correlating with reported fatigue."
              </p>
              <p className="mt-3 text-[14px] font-medium text-[#3B6EF5]">
                ℹ Patient reminder sent. Consider nurse follow-up if pattern continues.
              </p>
            </SummaryCard>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-[#3B6EF5] py-3 text-[16px] font-semibold text-white shadow-[0_4px_10px_rgba(59,110,245,0.24)]"
              >
                Schedule Follow-up
              </button>
              <button type="button" className="grid h-12 w-12 place-items-center rounded-xl border border-[#E9EEF7] bg-white text-[#667085]">
                <MessageSquare size={18} />
              </button>
            </div>
          </PatientCard>

          <section className="space-y-3">
            {[
              { name: "Mrs Lim", subtitle: "Hypertension • Stable" },
              { name: "Mr Ahmad", subtitle: "Post-Op • Recovering" },
            ].map((item) => (
              <article key={item.name} className="flex items-center justify-between rounded-2xl border border-[#E9EEF7] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-[#EEF2F7]">
                    <UserRound size={20} className="text-[#98A2B3]" />
                  </div>
                  <div>
                    <p className="text-[30px] font-semibold leading-none text-[#1F2A37]">{item.name}</p>
                    <p className="mt-1 text-[13px] text-[#667085]">{item.subtitle}</p>
                  </div>
                </div>
                <span className="text-[#98A2B3]">›</span>
              </article>
            ))}
          </section>

          <section className="space-y-2">
            <SectionTitle title="Cohort Adherence Trends" />
            <ChartCard>
              <div className="flex h-[180px] items-end justify-between gap-2 px-3 pt-2">
                {[
                  { day: "Mon", value: 58, active: false },
                  { day: "Tue", value: 72, active: false },
                  { day: "Wed", value: 90, active: false },
                  { day: "Thu", value: 61, active: false },
                  { day: "Fri", value: 105, active: true },
                ].map((bar) => (
                  <div key={bar.day} className="flex flex-1 flex-col items-center justify-end gap-2">
                    <span className="text-[12px] font-semibold text-[#98A2B3]">{bar.day}</span>
                    <div className={`w-full max-w-[34px] rounded-t-sm ${bar.active ? "bg-[#3B6EF5]" : "bg-[#BCC8DF]"}`} style={{ height: `${bar.value}px` }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#E9EEF7] pt-3 text-[12px] text-[#667085]">
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#3B6EF5]" /> On-time Doses</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#EF5A5A]" /> Missed/Late</div>
              </div>
            </ChartCard>
          </section>
        </section>

        <TabBar tabs={tabs} active="patients" />
      </div>
    </main>
  );
}
