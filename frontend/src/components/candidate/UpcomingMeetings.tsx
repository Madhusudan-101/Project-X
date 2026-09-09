/**
 * Upcoming Peer Interviews — PUBLIC listing.
 *
 * Shows every scheduled meeting any student on the platform has created,
 * with clear visual states (Upcoming / Waiting / Live) and a Join button
 * that reflects the caller's real authorization:
 *
 *   - Open meetings (no invitee): any authenticated student can Join.
 *   - Invitation meetings: only the creator + invitee can Join; everyone
 *     else sees the card but has an "Invite-only" label and disabled Join.
 *
 * The status badge is server-authoritative — it comes from the row in
 * peer_scheduled_meetings, whose transitions are driven by /join
 * (scheduled -> waiting -> live) and by the /internal/peer-reports
 * webhook (-> completed). No client-side fake status.
 *
 * Refetches every 15 seconds and also when the local
 * `scheduledMeetingsVersion` bumps (own create/cancel).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  LogIn,
  Loader2,
  Radar,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  peerService,
  type PublicScheduledMeeting,
  type ScheduledMeetingStatus,
} from "@/services/api/candidate/peer";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { ApiClientError } from "@/services/api/client";
import { reservePeerMeetTab } from "@/lib/peerMeetTab";

const POLL_INTERVAL_MS = 15_000;
const JOIN_WINDOW_BEFORE_MS = 5 * 60 * 1000;

function statusLabel(s: ScheduledMeetingStatus): string {
  switch (s) {
    case "scheduled":
      return "Upcoming";
    case "waiting":
      return "Waiting for participant";
    case "live":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return s;
  }
}

function statusTone(s: ScheduledMeetingStatus): string {
  switch (s) {
    case "live":
      return "border-success/30 bg-success/10 text-success";
    case "waiting":
      return "border-warning/30 bg-warning/10 text-warning";
    case "scheduled":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border text-muted-foreground";
  }
}

function untilStart(m: PublicScheduledMeeting, now: number): string {
  const diff = new Date(m.scheduled_at).getTime() - now;
  if (diff <= 0) {
    const mins = Math.abs(Math.round(diff / 60_000));
    return mins < 60 ? `Started ${mins}m ago` : "In progress";
  }
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `Starts in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Starts in ${hrs}h`;
  return `Starts in ${Math.round(hrs / 24)}d`;
}

export function UpcomingMeetings() {
  const [meetings, setMeetings] = useState<PublicScheduledMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const setActiveRoom = usePeerInterviewStore((s) => s.setActiveRoom);
  const scheduledMeetingsVersion = usePeerInterviewStore((s) => s.scheduledMeetingsVersion);
  const bumpScheduledMeetings = usePeerInterviewStore((s) => s.bumpScheduledMeetings);

  const load = useCallback(async () => {
    try {
      const rows = await peerService.listUpcomingMeetings();
      setMeetings(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load upcoming meetings.");
      setMeetings((prev) => prev ?? []);
    }
  }, []);

  // Initial load + refetch on any local create/cancel.
  useEffect(() => {
    load();
  }, [load, scheduledMeetingsVersion]);

  // Poll for lifecycle changes driven by other users (someone else joined
  // -> status flips to live) and for time-based transitions. Skips ticks
  // while the tab is hidden so a backgrounded dashboard doesn't hammer the
  // API for updates nobody is looking at; a `visibilitychange` listener
  // triggers an immediate refresh the moment the tab comes back to the
  // front, so the user never sees stale data on return.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load();
    };
    const t = setInterval(tick, POLL_INTERVAL_MS);
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        load();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      cancelled = true;
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(
    () => (meetings ?? []).slice().sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [meetings],
  );

  const handleJoin = useCallback(
    async (m: PublicScheduledMeeting) => {
      const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
      if (!peermeetUrl) {
        toast.error("Peer Interview is not configured. Set VITE_PEERMEET_URL.");
        return;
      }
      if (!m.is_authorized) {
        toast.error("This meeting is invitation-only.");
        return;
      }
      const tab = reservePeerMeetTab({
        title: "Joining Peer Interview",
        message: "Verifying access and preparing your identity token.",
      });
      try {
        const res = await peerService.joinScheduledMeeting(m.id);
        const url = new URL("/", peermeetUrl);
        url.searchParams.set("room", res.room_id);
        url.searchParams.set("init", "1");
        url.searchParams.set("private", res.keep_private ? "1" : "0");
        // Identity token in the fragment — never leaks via Referer / logs
        // / history (see PeerInterviewMatchModal for full rationale).
        url.hash = `token=${encodeURIComponent(res.token)}`;
        setActiveRoom(res.room_id, res.keep_private);
        tab.navigate(url.toString());
        // Bump so both "mine" and public lists re-read and reflect
        // the new server-side status (waiting/live).
        bumpScheduledMeetings();
      } catch (err) {
        tab.abort();
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not open the meeting.";
        toast.error(msg);
      }
    },
    [setActiveRoom, bumpScheduledMeetings],
  );

  if (meetings === null && !error) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading upcoming Peer Interviews…
        </div>
      </Card>
    );
  }

  if (error && (meetings ?? []).length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return null;
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold">Upcoming Peer Interviews</h3>
          <p className="text-xs text-muted-foreground">
            All scheduled Peer Interviews across the platform.
          </p>
        </div>
        <Badge variant="outline">{sorted.length}</Badge>
      </div>
      <ul className="space-y-2">
        {sorted.map((m) => {
          const when = new Date(m.scheduled_at);
          const before = new Date(m.scheduled_at).getTime() - now;
          const notYetJoinable = before > JOIN_WINDOW_BEFORE_MS;
          return (
            <li
              key={m.id}
              className="rounded-lg border border-border/60 bg-card p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="h-3.5 w-3.5 text-primary" />
                    <span className="truncate text-sm font-medium">
                      {m.title || "Peer Interview"}
                    </span>
                    <Badge className={statusTone(m.status)}>
                      {m.status === "live" && <Radar className="mr-1 h-3 w-3 animate-pulse" />}
                      {m.status === "waiting" && <Users className="mr-1 h-3 w-3" />}
                      {m.status === "scheduled" && <CalendarClock className="mr-1 h-3 w-3" />}
                      {m.status === "live" ? "Live" : statusLabel(m.status)}
                    </Badge>
                    {!m.is_open && (
                      <Badge variant="outline" className="text-[10px]">
                        {m.is_authorized ? "Invited" : "Invite-only"}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Hosted by <span className="font-medium">{m.host_display_name}</span>
                    {" · "}
                    {when.toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {m.duration_minutes} min · {untilStart(m, now)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    size="sm"
                    onClick={() => handleJoin(m)}
                    disabled={!m.is_authorized || !m.can_join_now}
                    className={m.can_join_now && m.is_authorized ? "bg-gradient-brand text-primary-foreground" : ""}
                    variant={m.can_join_now && m.is_authorized ? "default" : "outline"}
                    title={
                      !m.is_authorized
                        ? "Invitation only"
                        : notYetJoinable
                          ? `Opens ${untilStart(m, now)}`
                          : undefined
                    }
                  >
                    {m.status === "live" ? (
                      <><Video className="mr-1.5 h-3.5 w-3.5" />Rejoin</>
                    ) : (
                      <><LogIn className="mr-1.5 h-3.5 w-3.5" />Join</>
                    )}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
