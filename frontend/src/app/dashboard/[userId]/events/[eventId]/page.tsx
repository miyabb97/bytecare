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
  User,
  UsersRound
} from "lucide-react";

import {
  api,
  type CommunityEventItem,
  type CommunityMyEventsResponse,
  type UserProfile
} from "../../../../../lib/api";

const PROFILE_IMAGE_URL = "https://lh3.googleusercontent.com/aida-public/AB6AXuDrpjijg5RYen-KEp80Ku17lHJt6RK6oQ8jsW9yOGV8G22INjaHluVxszAVSYh7377YZduJY0z1JadmjpP-_slJeGgQKFmm53tOjbijQFoPrqrf32G8qlRqKcx5fRUjfVjGlREMUBlc9xtjTdcHypDPv6OA4gWbCQ2VxJVehPCypeFLrmiGy3QwVzlKW5gKU4PVT0_SQBD3riOiporPY9unbl6_T7IjdEnwDL7j1yxZItw3L9Fgj9T6Q8f8esWe3APv7JdvBOUrA0M";
const IMAGE_WALK = "https://lh3.googleusercontent.com/aida-public/AB6AXuAVNP892HZuLcbaTsZyc-eOMPlYKDMlqVdP8ybsdVb0P1LZ6ug1VbuJgmaUGiqhMRe5x6J1iiLvm3WoSUQdUZQcnFbsq7ITJTq6mRYdfqHtLPGx-_sxdDCm5L3btLTI7HStACdyt49FXrTIAaaZzYAUxW2brjZZMGXVbX_FzFWxte_JaGXr5wQepX-cc_Lrot54PUiK5B-uSnldnT6OnrQTs_il1EbTxYpYop22BsDCibjOX49JtovQHcfTqTkd7XeeLSJGxgpP_dM";
const IMAGE_TAI_CHI = "https://lh3.googleusercontent.com/aida-public/AB6AXuA3YolzPqhmPsepHcKCNeiXvywh-4SmaMp4_WdWbln4_lyFbklKzB9EOtjAPGYN_rbWybaVuXmZDQmNkonLqc593lRpRfrTbMRluqYuW3tvwHkzyVPO5jp2nUf6TCFC48TX9xDrJu6bw0fob2ND-eXkQhlDQG84otSIfX1lBKh1aPxuh9jnH1yoc7GKSRrCg0QjpvKlLonHjpChtDQOe1M0aIRCB73rjG3uuF3hZMnzP1XxOV7zBlPH4A-ve-5nzyHW1n2Kb27_PKk";
const IMAGE_COOKING = "https://lh3.googleusercontent.com/aida-public/AB6AXuBpTeUp98FkA_ijR4sKh9qL3wEqou6Af_Wd1AG7ALOUOnS6LXcC3KMY9CI0WqHvqbty9JM28p60IhnEq4D_m62M71bVaabYuZeg99AKdjn9Y9guhYmaCVhSoptJDwyUU1B_XFSApLn_Y_j5BV8hu4QzqcKomqmc5Me5zXNXRSo4_RIBkK-RBcjf7Vw1xOA4vbU4WOYMZEvMPiG9OU4FpUWKXh22gbqkCbGRQbH7Nj0MszNOcVbVJlyE83xNHgFE_az2edlt3DCN0kM";

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

function formatEventDateTime(value: string): string {
  return new Date(value).toLocaleString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const common = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...common} />;
  if (tab === "chat") return <MessageSquare {...common} />;
  if (tab === "events") return <CalendarDays {...common} />;
  if (tab === "health") return <Heart {...common} />;
  return <User {...common} />;
}

async function getMyCommunityEventsSafe(userId: string): Promise<CommunityMyEventsResponse> {
  const maybeFn = (api as { getMyCommunityEvents?: (id: string) => Promise<CommunityMyEventsResponse> })
    .getMyCommunityEvents;
  if (typeof maybeFn === "function") {
    return maybeFn(userId);
  }
  return { joined: [], saved: [] };
}

export default function EventDetailsPage() {
  const params = useParams<{ userId: string; eventId: string }>();
  const router = useRouter();

  const userIdParam = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const eventIdParam = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const userId = decodeURIComponent(userIdParam ?? "");
  const eventId = decodeURIComponent(eventIdParam ?? "");

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [event, setEvent] = useState<CommunityEventItem | null>(null);
  const [myEvents, setMyEvents] = useState<CommunityMyEventsResponse>({ joined: [], saved: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showJoinConfirm, setShowJoinConfirm] = useState(false);

  const joinedEventIds = useMemo(
    () => new Set((myEvents.joined ?? []).map((item) => item.event_id)),
    [myEvents]
  );

  const isJoined = Boolean(event && joinedEventIds.has(event.event_id));

  const loadEvent = useCallback(async () => {
    if (!userId || !eventId) return;

    setLoading(true);
    setError(null);
    try {
      const [profileRes, allRes, mineRes] = await Promise.all([
        api.getUser(userId),
        api.getAllCommunityEvents(userId),
        getMyCommunityEventsSafe(userId)
      ]);
      setUserProfile(profileRes);
      const found = (allRes.events ?? []).find((item) => item.event_id === eventId) ?? null;
      setEvent(found);
      setMyEvents(mineRes);
      if (!found) {
        setError("Event not found.");
      }
    } catch (loadError) {
      setUserProfile(null);
      setEvent(null);
      setError(safeMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [eventId, userId]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  async function handleToggleJoin() {
    if (!userId || !event) return;

    setActionError(null);
    setActionLoading(true);
    try {
      if (isJoined) {
        await api.postCancelCommunityEvent(userId, event.event_id);
      } else {
        await api.postJoinCommunityEvent(userId, event.event_id);
      }
      const mine = await getMyCommunityEventsSafe(userId);
      setMyEvents(mine);
    } catch (err) {
      setActionError(safeMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmJoin() {
    setShowJoinConfirm(false);
    await handleToggleJoin();
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
      <div className="flex min-h-screen w-full max-w-md flex-col bg-slate-50 md:border-x md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
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
            onClick={() => void loadEvent()}
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
            <h1 className="text-[1.05rem] font-bold leading-none tracking-tight text-slate-900">Event Details</h1>
          </div>
          <p className="text-[0.77rem] text-slate-600">
            View full activity details and manage your participation.
          </p>
        </section>

        <section className="tc-motion-stack space-y-4 px-4 py-4">
          {loading ? <p className="text-xs text-slate-600">Loading event details...</p> : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {actionError ? <p className="text-xs text-red-700">{actionError}</p> : null}

          {event ? (
            <article className="tc-animated-card overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative h-48">
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
                {isJoined ? (
                  <div className="absolute left-4 top-3 inline-flex items-center rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    Joined
                  </div>
                ) : null}
                <div className="absolute bottom-3 left-4 text-white">
                  <h2 className="text-[1.55rem] font-bold leading-tight">{event.title}</h2>
                </div>
              </div>

              <div className="space-y-4 p-4">
                {event.is_recommended && event.reason ? (
                  <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs italic text-blue-700">
                    {event.reason}
                  </p>
                ) : null}

                <div className="space-y-2 text-sm text-slate-600">
                  <p className="flex items-center gap-2">
                    <Clock3 size={14} className="text-slate-500" />
                    {formatEventDateTime(event.datetime)}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin size={14} className="text-slate-500" />
                    {event.location}
                  </p>
                  <p className="flex items-center gap-2">
                    <UsersRound size={14} className="text-slate-500" />
                    Organiser: {event.organiser}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">About this activity</p>
                  <p className="text-sm leading-relaxed text-slate-700">{event.description}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className={isJoined ? "tc-btn tc-btn-danger tc-btn-event" : "tc-btn tc-btn-primary tc-btn-event"}
                    onClick={() => {
                      if (isJoined) {
                        void handleToggleJoin();
                        return;
                      }
                      setShowJoinConfirm(true);
                    }}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "Updating..." : isJoined ? "Cancel" : "Join Event"}
                  </button>
                  <button
                    type="button"
                    className="tc-btn tc-btn-secondary"
                    onClick={() => router.push(`/dashboard/${encodeURIComponent(userId)}/events`)}
                  >
                    See all events
                  </button>
                </div>
              </div>
            </article>
          ) : null}
        </section>

        {event && showJoinConfirm ? (
          <div className="medication-modal-backdrop" role="presentation">
            <section
              className="medication-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="join-event-confirm-title-details"
            >
              <p className="modal-kicker">Join event</p>
              <h2 id="join-event-confirm-title-details">Confirm joining this activity?</h2>
              <p className="muted"><strong>{event.title}</strong></p>
              <p className="muted">{formatEventDateTime(event.datetime)} &middot; {event.location}</p>
              <div className="medication-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowJoinConfirm(false)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmJoin()}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Joining..." : "Join Event"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <nav className="tc-bottom-nav mt-auto sticky bottom-0 z-40 flex w-full items-center justify-between border-t border-slate-200 bg-white px-5 py-2">
          <button
            type="button"
            className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500 hover:bg-slate-50"
            onClick={() => navigateToTab("home")}
          >
            <BottomNavIcon tab="home" active={false} />
            <span className="text-[11px] font-normal">Home</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500 hover:bg-slate-50"
            onClick={() => navigateToTab("chat")}
          >
            <BottomNavIcon tab="chat" active={false} />
            <span className="text-[11px] font-normal">Chat</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-1 rounded-xl bg-blue-50 px-3 py-1.5 text-blue-600">
            <BottomNavIcon tab="events" active />
            <span className="text-[11px] font-semibold">Events</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500 hover:bg-slate-50"
            onClick={() => navigateToTab("health")}
          >
            <BottomNavIcon tab="health" active={false} />
            <span className="text-[11px] font-normal">Health</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500 hover:bg-slate-50"
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
