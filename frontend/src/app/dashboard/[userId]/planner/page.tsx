"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  Pill,
  Settings,
  User,
} from "lucide-react";

import {
  api,
  type CommunityEventItem,
  type MedicationItem,
  type UserProfile,
} from "../../../../lib/api";

const PROFILE_IMAGE_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDrpjijg5RYen-KEp80Ku17lHJt6RK6oQ8jsW9yOGV8G22INjaHluVxszAVSYh7377YZduJY0z1JadmjpP-_slJeGgQKFmm53tOjbijQFoPrqrf32G8qlRqKcx5fRUjfVjGlREMUBlc9xtjTdcHypDPv6OA4gWbCQ2VxJVehPCypeFLrmiGy3QwVzlKW5gKU4PVT0_SQBD3riOiporPY9unbl6_T7IjdEnwDL7j1yxZItw3L9Fgj9T6Q8f8esWe3APv7JdvBOUrA0M";

type Tab = "home" | "chat" | "events" | "health" | "profile";
type CalView = "week" | "month";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const TIMELINE_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const s = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...s} />;
  if (tab === "chat") return <MessageSquare {...s} />;
  if (tab === "events") return <CalendarDays {...s} />;
  if (tab === "health") return <Heart {...s} />;
  return <User {...s} />;
}

function safeMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function parseTimeMins(timeStr: string): number {
  const t = timeStr.trim();
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return parseInt(h24[1]) * 60 + parseInt(h24[2]);
  const h12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (h12) {
    let hrs = parseInt(h12[1]);
    const mins = parseInt(h12[2]);
    const period = h12[3].toUpperCase();
    if (period === "AM" && hrs === 12) hrs = 0;
    if (period === "PM" && hrs !== 12) hrs += 12;
    return hrs * 60 + mins;
  }
  return 0;
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? "AM" : "PM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${m.toString().padStart(2, "0")} ${period}`;
}

function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function fmtEventTime(dt: string): string {
  return new Date(dt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** Return the Sunday that starts the week containing `date` */
function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return all 7 days of the week containing `date` */
function weekDaysFor(date: Date): Date[] {
  const sun = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    return d;
  });
}

/** Return all calendar cells for the month grid (including padding days) */
function monthCells(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export default function PlannerPage() {
  const params = useParams<{ userId: string }>();
  const userIdParam = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const userId = decodeURIComponent(userIdParam ?? "");
  const router = useRouter();

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const nowHour = new Date().getHours();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [events, setEvents] = useState<CommunityEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [calView, setCalView] = useState<CalView>("week");
  // week nav: reference date whose week is shown
  const [weekRef, setWeekRef] = useState<Date>(today);
  // month nav: reference date whose month is shown
  const [monthRef, setMonthRef] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [prof, meds, evts] = await Promise.all([
        api.getUser(userId),
        api.getMedications(userId),
        api.getCommunityEvents(userId),
      ]);
      setUserProfile(prof);
      setMedications(meds.items ?? []);
      setEvents(evts.events ?? []);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // All scheduled med times (repeat every day)
  const allMedSlots = useMemo(() => {
    const out: { med: MedicationItem; mins: number }[] = [];
    for (const med of medications) {
      for (const t of med.schedule.times) {
        out.push({ med, mins: parseTimeMins(t) });
      }
    }
    return out.sort((a, b) => a.mins - b.mins);
  }, [medications]);

  // Events on selected day
  const dayEvents = useMemo(() => {
    return events
      .filter((e) => isSameDay(new Date(e.datetime), selectedDate))
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  }, [events, selectedDate]);

  // Combined timeline items sorted by time
  type TLItem =
    | { kind: "med"; mins: number; med: MedicationItem }
    | { kind: "event"; mins: number; event: CommunityEventItem };

  const timelineItems = useMemo((): TLItem[] => {
    const items: TLItem[] = [
      ...allMedSlots.map((s) => ({ kind: "med" as const, mins: s.mins, med: s.med })),
      ...dayEvents.map((e) => {
        const dt = new Date(e.datetime);
        return { kind: "event" as const, mins: dt.getHours() * 60 + dt.getMinutes(), event: e };
      }),
    ];
    return items.sort((a, b) => a.mins - b.mins);
  }, [allMedSlots, dayEvents]);

  // Items grouped by hour
  const byHour = useMemo(() => {
    const map = new Map<number, TLItem[]>();
    for (const item of timelineItems) {
      const hr = Math.floor(item.mins / 60);
      if (!map.has(hr)) map.set(hr, []);
      map.get(hr)!.push(item);
    }
    return map;
  }, [timelineItems]);

  // Set of date-strings that have any items (for month dots)
  const datesWithItems = useMemo(() => {
    const set = new Set<string>();
    // meds repeat every day, so mark all days in the displayed month as having meds
    if (allMedSlots.length > 0) {
      const year = monthRef.getFullYear();
      const month = monthRef.getMonth();
      const days = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        set.add(new Date(year, month, d).toDateString());
      }
    }
    for (const e of events) {
      set.add(new Date(e.datetime).toDateString());
    }
    return set;
  }, [allMedSlots, events, monthRef]);

  // Navigation
  function prevWeek() {
    const d = new Date(weekRef);
    d.setDate(d.getDate() - 7);
    setWeekRef(d);
  }
  function nextWeek() {
    const d = new Date(weekRef);
    d.setDate(d.getDate() + 7);
    setWeekRef(d);
  }
  function prevMonth() {
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function nextMonth() {
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  const shownWeekDays = weekDaysFor(weekRef);
  const shownCells = monthCells(monthRef.getFullYear(), monthRef.getMonth());

  function navigateToTab(tab: Tab) {
    const base = `/dashboard/${encodeURIComponent(userId)}`;
    if (tab === "home") { router.push(base); return; }
    if (tab === "events") { router.push(`${base}/events`); return; }
    router.push(`${base}?tab=${tab}`);
  }

  const calHeaderLabel = calView === "week"
    ? (() => {
        const days = shownWeekDays;
        const first = days[0];
        const last = days[6];
        if (first.getMonth() === last.getMonth()) {
          return `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
        }
        return `${MONTH_NAMES[first.getMonth()].slice(0, 3)} – ${MONTH_NAMES[last.getMonth()].slice(0, 3)} ${last.getFullYear()}`;
      })()
    : `${MONTH_NAMES[monthRef.getMonth()]} ${monthRef.getFullYear()}`;

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="min-h-screen w-full max-w-md bg-slate-50 pb-24 md:border-x md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]">

        {/* App header */}
        <header className="app-header">
          <div className="header-left">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="ByteCare logo"
              width={38}
              height={38}
              className="h-[2.35rem] w-[2.35rem] rounded-full border-2 border-blue-100 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="header-copy">
              <h1>ByteCare</h1>
              <p className="muted">{userProfile?.name ?? "Loading profile..."}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void loadData()}
            className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
          >
            <Settings size={20} />
          </button>
        </header>

        {/* Page title */}
        <section className="border-b border-slate-200 bg-white px-4 py-5">
          <div className="mb-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/${encodeURIComponent(userId)}`)}
              className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
            >
              <ArrowLeft size={22} />
            </button>
            <h1 className="text-[2rem] font-bold leading-none tracking-tight text-slate-900">My Planner</h1>
          </div>
          <p className="pl-[3.25rem] text-[0.77rem] text-slate-600">Medications &amp; activities at a glance.</p>
        </section>

        <section className="space-y-4 px-4 py-4">

          {/* Calendar card */}
          <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">

            {/* Calendar top bar */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  style={{ width: "auto", margin: 0, padding: "4px", background: "transparent", border: 0, borderRadius: "50%" }}
                  className="tc-icon-btn inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full"
                  onClick={calView === "week" ? prevWeek : prevMonth}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-bold text-slate-800 min-w-[10rem] text-center">{calHeaderLabel}</span>
                <button
                  type="button"
                  style={{ width: "auto", margin: 0, padding: "4px", background: "transparent", border: 0, borderRadius: "50%" }}
                  className="tc-icon-btn inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full"
                  onClick={calView === "week" ? nextWeek : nextMonth}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Week / Month toggle */}
              <div className="flex items-center rounded-xl bg-slate-100 p-0.5">
                {(["week", "month"] as CalView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    style={{ width: "auto", margin: 0, padding: "4px 12px", border: 0, borderRadius: "10px" }}
                    className={`text-[11px] font-semibold capitalize transition ${
                      calView === v
                        ? "bg-white text-slate-800 shadow-sm"
                        : "bg-transparent text-slate-500"
                    }`}
                    onClick={() => setCalView(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Day-of-week labels */}
            <div className="grid grid-cols-7 px-3 pb-1">
              {DAY_LETTERS.map((l, i) => (
                <div key={i} className="text-center text-[10px] font-semibold text-slate-400">{l}</div>
              ))}
            </div>

            {/* Week view */}
            {calView === "week" && (
              <div className="grid grid-cols-7 gap-y-1 px-3 pb-4">
                {shownWeekDays.map((day) => {
                  const isSel = isSameDay(day, selectedDate);
                  const isToday = isSameDay(day, today);
                  const hasDot = datesWithItems.has(day.toDateString());
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      style={{ width: "auto", margin: 0, padding: "6px 0", background: "transparent", border: 0 }}
                      onClick={() => {
                        setSelectedDate(day);
                        // sync week ref when clicking a day from another week
                        setWeekRef(day);
                      }}
                      className="flex flex-col items-center gap-0.5 active:scale-95 transition"
                    >
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition ${
                          isSel
                            ? "bg-slate-200 text-slate-800"
                            : isToday
                            ? "text-[#3670e2]"
                            : "text-slate-700"
                        }`}
                      >
                        {day.getDate()}
                      </div>
                      {/* today indicator dot */}
                      {isToday && !isSel && (
                        <div className="h-1 w-1 rounded-full bg-[#3670e2]" />
                      )}
                      {/* items dot */}
                      {hasDot && (
                        <div className={`h-1 w-1 rounded-full ${isToday && !isSel ? "hidden" : "bg-violet-400"}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Month view */}
            {calView === "month" && (
              <div className="grid grid-cols-7 gap-y-1 px-3 pb-4">
                {shownCells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} />;
                  const isSel = isSameDay(day, selectedDate);
                  const isToday = isSameDay(day, today);
                  const hasDot = datesWithItems.has(day.toDateString());
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      style={{ width: "auto", margin: 0, padding: "4px 0", background: "transparent", border: 0 }}
                      onClick={() => {
                        setSelectedDate(day);
                        // sync month ref
                        setMonthRef(new Date(day.getFullYear(), day.getMonth(), 1));
                      }}
                      className="flex flex-col items-center gap-0.5 active:scale-95 transition"
                    >
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold transition ${
                          isSel
                            ? "bg-slate-200 text-slate-800"
                            : isToday
                            ? "text-[#3670e2] font-bold"
                            : "text-slate-700"
                        }`}
                      >
                        {day.getDate()}
                      </div>
                      {isToday && !isSel && (
                        <div className="h-1 w-1 rounded-full bg-[#3670e2]" />
                      )}
                      {hasDot && !isToday && (
                        <div className="h-1 w-1 rounded-full bg-violet-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected date label */}
            <div className="border-t border-slate-100 px-4 py-2.5">
              <p className="text-[0.72rem] font-semibold text-slate-500">
                {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>
          </section>

          {/* Loading / error */}
          {loading && (
            <p className="text-center text-xs text-slate-500">Loading your schedule...</p>
          )}
          {error && (
            <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>
          )}

          {/* Vertical timeline */}
          {!loading && !error && (
            <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
              <div className="px-5 pt-4 pb-2 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-900">Day Schedule</h3>
              </div>

              {timelineItems.length === 0 ? (
                <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing scheduled for this day.</p>
              ) : (
                <div className="px-4 py-3">
                  {TIMELINE_HOURS.map((hr) => {
                    const items = byHour.get(hr) ?? [];
                    const isPast = isSameDay(selectedDate, today) && hr < nowHour;
                    const isCurrent = isSameDay(selectedDate, today) && hr === nowHour;

                    return (
                      <div key={hr} className="flex gap-3 min-h-[2.75rem]">
                        {/* Time label */}
                        <div className="w-12 flex-shrink-0 flex flex-col items-end pt-1">
                          <span
                            className={`text-[10px] font-semibold leading-none ${
                              isCurrent ? "text-[#3670e2]" : isPast ? "text-slate-300" : "text-slate-400"
                            }`}
                          >
                            {fmtHour(hr)}
                          </span>
                        </div>

                        {/* Vertical line + content */}
                        <div className="flex flex-col items-center flex-shrink-0">
                          {/* dot */}
                          <div
                            className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${
                              isCurrent
                                ? "bg-[#3670e2]"
                                : items.length > 0
                                ? "bg-slate-300"
                                : "bg-slate-200"
                            }`}
                          />
                          {/* line segment */}
                          <div className={`flex-1 w-px mt-1 ${isPast ? "bg-slate-100" : "bg-slate-200"}`} />
                        </div>

                        {/* Cards */}
                        <div className="flex-1 pb-2 pt-0.5 space-y-1.5">
                          {items.map((item, idx) => {
                            if (item.kind === "med") {
                              const isHigh = item.med.criticality?.toLowerCase() === "high";
                              return (
                                <div
                                  key={`med-${item.med.medication_id}-${idx}`}
                                  className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 border ${
                                    isHigh
                                      ? "bg-blue-50 border-blue-100"
                                      : "bg-slate-50 border-slate-100"
                                  } ${isPast ? "opacity-40" : ""}`}
                                >
                                  <div
                                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl ${
                                      isHigh ? "bg-blue-100 text-[#3670e2]" : "bg-slate-200 text-slate-500"
                                    }`}
                                  >
                                    <Pill size={13} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="truncate text-[12px] font-semibold text-slate-800">{item.med.name}</p>
                                    <p className="text-[10px] text-slate-500">{item.med.dose_text} · {fmtMins(item.mins)}</p>
                                  </div>
                                  {isHigh && (
                                    <span className="flex-shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#3670e2]">
                                      Critical
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div
                                key={`evt-${item.event.event_id}`}
                                className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 bg-violet-50 border border-violet-100 ${
                                  isPast ? "opacity-40" : ""
                                }`}
                              >
                                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                                  <CalendarDays size={13} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="truncate text-[12px] font-semibold text-slate-800">{item.event.title}</p>
                                  <p className="flex items-center gap-1 text-[10px] text-slate-500">
                                    <MapPin size={9} />{item.event.location} · {fmtEventTime(item.event.datetime)}
                                  </p>
                                </div>
                                <span className="flex-shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-600">
                                  Activity
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

        </section>

        {/* Bottom nav */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(env(safe-area-inset-bottom),0px)]">
          <nav className="tc-bottom-nav pointer-events-auto flex w-full max-w-md items-center justify-between border-t border-slate-200 bg-white px-2 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.10)]">
            {(["home", "chat", "events", "health", "profile"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
                onClick={() => navigateToTab(tab)}
              >
                <BottomNavIcon tab={tab} active={false} />
                <span className="text-[11px] font-normal capitalize">{tab}</span>
              </button>
            ))}
          </nav>
        </div>

      </div>
    </main>
  );
}
