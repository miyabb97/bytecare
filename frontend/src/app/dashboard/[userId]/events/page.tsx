"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  Settings,
  Search,
  User
} from "lucide-react";

import {
  api,
  type CommunityEventItem,
  type CommunityMyEventsResponse,
  type UserProfile
} from "../../../../lib/api";

const PROFILE_IMAGE_URL = "https://lh3.googleusercontent.com/aida-public/AB6AXuDrpjijg5RYen-KEp80Ku17lHJt6RK6oQ8jsW9yOGV8G22INjaHluVxszAVSYh7377YZduJY0z1JadmjpP-_slJeGgQKFmm53tOjbijQFoPrqrf32G8qlRqKcx5fRUjfVjGlREMUBlc9xtjTdcHypDPv6OA4gWbCQ2VxJVehPCypeFLrmiGy3QwVzlKW5gKU4PVT0_SQBD3riOiporPY9unbl6_T7IjdEnwDL7j1yxZItw3L9Fgj9T6Q8f8esWe3APv7JdvBOUrA0M";
const IMAGE_WALK = "https://lh3.googleusercontent.com/aida-public/AB6AXuAVNP892HZuLcbaTsZyc-eOMPlYKDMlqVdP8ybsdVb0P1LZ6ug1VbuJgmaUGiqhMRe5x6J1iiLvm3WoSUQdUZQcnFbsq7ITJTq6mRYdfqHtLPGx-_sxdDCm5L3btLTI7HStACdyt49FXrTIAaaZzYAUxW2brjZZMGXVbX_FzFWxte_JaGXr5wQepX-cc_Lrot54PUiK5B-uSnldnT6OnrQTs_il1EbTxYpYop22BsDCibjOX49JtovQHcfTqTkd7XeeLSJGxgpP_dM";
const IMAGE_TAI_CHI = "https://lh3.googleusercontent.com/aida-public/AB6AXuA3YolzPqhmPsepHcKCNeiXvywh-4SmaMp4_WdWbln4_lyFbklKzB9EOtjAPGYN_rbWybaVuXmZDQmNkonLqc593lRpRfrTbMRluqYuW3tvwHkzyVPO5jp2nUf6TCFC48TX9xDrJu6bw0fob2ND-eXkQhlDQG84otSIfX1lBKh1aPxuh9jnH1yoc7GKSRrCg0QjpvKlLonHjpChtDQOe1M0aIRCB73rjG3uuF3hZMnzP1XxOV7zBlPH4A-ve-5nzyHW1n2Kb27_PKk";
const IMAGE_COOKING = "https://lh3.googleusercontent.com/aida-public/AB6AXuBpTeUp98FkA_ijR4sKh9qL3wEqou6Af_Wd1AG7ALOUOnS6LXcC3KMY9CI0WqHvqbty9JM28p60IhnEq4D_m62M71bVaabYuZeg99AKdjn9Y9guhYmaCVhSoptJDwyUU1B_XFSApLn_Y_j5BV8hu4QzqcKomqmc5Me5zXNXRSo4_RIBkK-RBcjf7Vw1xOA4vbU4WOYMZEvMPiG9OU4FpUWKXh22gbqkCbGRQbH7Nj0MszNOcVbVJlyE83xNHgFE_az2edlt3DCN0kM";

type RecommendationFilter = "all" | "recommended" | "others";
type Tab = "home" | "chat" | "events" | "health" | "profile";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function eventImageFor(event: CommunityEventItem): string {
  const title = event.title.toLowerCase();
  if (title.includes("walk")) return IMAGE_WALK;
  if (title.includes("tai chi")) return IMAGE_TAI_CHI;
  if (title.includes("cook")) return IMAGE_COOKING;
  const type = event.type.toLowerCase();
  if (type.includes("education")) return IMAGE_COOKING;
  if (type.includes("exercise")) return IMAGE_TAI_CHI;
  return IMAGE_WALK;
}

function eventTagFor(event: CommunityEventItem): string {
  const title = event.title.toLowerCase();
  if (title.includes("walk")) return "HEALTH FOCUSED";
  if (title.includes("tai chi")) return "MOBILITY";
  if (title.includes("cook")) return "NUTRITION";
  if (event.type.toLowerCase().includes("social")) return "SOCIAL";
  return event.type.toUpperCase();
}

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const common = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...common} />;
  if (tab === "chat") return <MessageSquare {...common} />;
  if (tab === "events") return <CalendarDays {...common} />;
  if (tab === "health") return <Heart {...common} />;
  return <User {...common} />;
}

function formatEventTimeShort(value: string): string {
  return new Date(value)
    .toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(",", "");
}

async function getMyCommunityEventsSafe(userId: string): Promise<CommunityMyEventsResponse> {
  const maybeFn = (api as { getMyCommunityEvents?: (id: string) => Promise<CommunityMyEventsResponse> })
    .getMyCommunityEvents;
  if (typeof maybeFn === "function") {
    return maybeFn(userId);
  }
  return { joined: [], saved: [] };
}

export default function EventsPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();

  const userIdParam = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const userId = decodeURIComponent(userIdParam ?? "");

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<CommunityEventItem[]>([]);
  const [myEvents, setMyEvents] = useState<CommunityMyEventsResponse>({ joined: [], saved: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>("all");

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joinCandidate, setJoinCandidate] = useState<CommunityEventItem | null>(null);

  const joinedEventIds = useMemo(
    () => new Set((myEvents.joined ?? []).map((event) => event.event_id)),
    [myEvents]
  );

  const loadEvents = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    try {
      const [profileRes, allRes, mineRes] = await Promise.all([
        api.getUser(userId),
        api.getAllCommunityEvents(userId),
        getMyCommunityEventsSafe(userId)
      ]);
      setUserProfile(profileRes);
      setEvents(allRes.events ?? []);
      setMyEvents(mineRes);
    } catch (loadError) {
      setUserProfile(null);
      setEvents([]);
      setError(safeMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    let items = [...events];
    const q = query.trim().toLowerCase();

    if (q) {
      items = items.filter((event) =>
        [event.title, event.location, event.description, event.organiser].some((field) =>
          field.toLowerCase().includes(q)
        )
      );
    }

    if (typeFilter !== "all") {
      items = items.filter((event) => event.type === typeFilter);
    }

    if (recommendationFilter === "recommended") {
      items = items.filter((event) => Boolean(event.is_recommended));
    } else if (recommendationFilter === "others") {
      items = items.filter((event) => !event.is_recommended);
    }

    items.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    return items;
  }, [events, query, typeFilter, recommendationFilter]);

  async function handleToggleJoin(event: CommunityEventItem) {
    if (!userId) return;
    setActionError(null);
    setActionLoading(event.event_id);
    try {
      if (joinedEventIds.has(event.event_id)) {
        await api.postCancelCommunityEvent(userId, event.event_id);
      } else {
        await api.postJoinCommunityEvent(userId, event.event_id);
      }
      const mine = await getMyCommunityEventsSafe(userId);
      setMyEvents(mine);
    } catch (e) {
      setActionError(safeMessage(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function confirmJoinCandidate() {
    if (!joinCandidate) return;
    const selected = joinCandidate;
    setJoinCandidate(null);
    await handleToggleJoin(selected);
  }

  function handleBack() {
    router.push(`/dashboard/${encodeURIComponent(userId)}?tab=events`);
  }

  function navigateToTab(tab: Exclude<Tab, "events">) {
    const base = `/dashboard/${encodeURIComponent(userId)}`;
    if (tab === "home") {
      router.push(base);
      return;
    }
    router.push(`${base}?tab=${tab}`);
  }

  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="min-h-screen w-full max-w-md bg-slate-50 pb-24 md:border-x md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
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
            aria-label="Settings"
            onClick={() => void loadEvents()}
            className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
          >
            <Settings size={20} />
          </button>
        </header>

        <section className="border-b border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
            >
              <ArrowLeft size={22} />
            </button>
            <h1 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Jio Events</h1>
          </div>
          <p className="text-[0.77rem] text-slate-600">
            Discover nearby activities to stay healthy and connected.
          </p>
        </section>

        <section className="tc-motion-stack space-y-4 px-4 py-4">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, place, description..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="all">All types</option>
                <option value="exercise">Exercise</option>
                <option value="wellness">Wellness</option>
                <option value="education">Education</option>
                <option value="social">Social</option>
              </select>
              <select
                value={recommendationFilter}
                onChange={(event) => setRecommendationFilter(event.target.value as RecommendationFilter)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="all">All activities</option>
                <option value="recommended">Recommended</option>
                <option value="others">Other activities</option>
              </select>
            </div>
          </section>

          {loading ? <p className="text-xs text-slate-600">Loading activities...</p> : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {actionError ? <p className="text-xs text-red-700">{actionError}</p> : null}

          <section className="space-y-4">
            {filteredEvents.map((event, index) => {
              const isJoined = joinedEventIds.has(event.event_id);
              const isLoading = actionLoading === event.event_id;

              return (
                <article
                  key={event.event_id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    router.push(
                      `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                    )
                  }
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                      keyEvent.preventDefault();
                      router.push(
                        `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                      );
                    }
                  }}
                  className="tc-animated-card tc-fade-item cursor-pointer overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm"
                  style={{ animationDelay: `${100 + index * 60}ms` }}
                >
                  <div className="relative h-32">
                    <Image
                      src={eventImageFor(event)}
                      alt={event.title}
                      fill
                      className="object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute right-3 top-3 rounded-md border border-white/25 bg-white/25 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
                      {eventTagFor(event)}
                    </div>
                    <div className="absolute bottom-3 left-4 text-white">
                      <h4 className="text-[1.35rem] font-bold leading-tight">{event.title}</h4>
                    </div>
                  </div>
                  <div className="p-4">
                    {event.is_recommended && event.reason ? (
                      <p className="mb-3 text-[10px] italic text-slate-500">{event.reason}</p>
                    ) : null}
                    <div className="flex items-center justify-between">
                      <div className="space-y-1 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><Clock3 size={12} /> {formatEventTimeShort(event.datetime)}</div>
                        <div className="flex items-center gap-1"><MapPin size={12} /> {event.location}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="tc-btn tc-btn-secondary tc-btn-event"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            router.push(
                              `/dashboard/${encodeURIComponent(userId)}/events/${encodeURIComponent(event.event_id)}`
                            );
                          }}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className={isJoined ? "tc-btn tc-btn-danger tc-btn-event" : "tc-btn tc-btn-primary tc-btn-event"}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            if (isJoined) {
                              void handleToggleJoin(event);
                              return;
                            }
                            setJoinCandidate(event);
                          }}
                          disabled={isLoading}
                        >
                          {isLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && filteredEvents.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                No activities match your filters.
              </p>
            ) : null}
          </section>
        </section>

        {joinCandidate ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section
              className="medication-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="join-event-confirm-title"
            >
              <p className="modal-kicker">Join event</p>
              <h2 id="join-event-confirm-title">Confirm joining this activity?</h2>
              <p className="muted"><strong>{joinCandidate.title}</strong></p>
              <p className="muted">{formatEventTimeShort(joinCandidate.datetime)} &middot; {joinCandidate.location}</p>
              <div className="medication-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setJoinCandidate(null)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => void confirmJoinCandidate()}
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? "Joining..." : "Join Event"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-0 pb-[max(env(safe-area-inset-bottom),0px)]">
        <nav className="tc-bottom-nav pointer-events-auto flex w-full max-w-md items-center justify-between border-t border-slate-200 bg-white px-2 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.10)]">
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
            onClick={() => navigateToTab("home")}
          >
            <BottomNavIcon tab="home" active={false} />
            <span className="text-[11px] font-normal">Home</span>
          </button>
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
            onClick={() => navigateToTab("chat")}
          >
            <BottomNavIcon tab="chat" active={false} />
            <span className="text-[11px] font-normal">Chat</span>
          </button>
          <button type="button" className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-blue-600">
            <BottomNavIcon tab="events" active />
            <span className="text-[11px] font-semibold">Events</span>
          </button>
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
            onClick={() => navigateToTab("health")}
          >
            <BottomNavIcon tab="health" active={false} />
            <span className="text-[11px] font-normal">Health</span>
          </button>
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
            onClick={() => navigateToTab("profile")}
          >
            <BottomNavIcon tab="profile" active={false} />
            <span className="text-[11px] font-normal">Profile</span>
          </button>
        </nav>
      </div>
    </main>
  );
}
