/**
 * Scheduled Peer Interviews — dashboard panel.
 *
 * Reads /candidate/peer-meetings and shows upcoming meetings the current
 * user is the creator OR invitee of. Each row has three affordances:
 *   - Copy the room ID (so an external invitee can be onboarded manually).
 *   - Join now — enabled only inside the joinable window (server-enforced).
 *   - Cancel — creator-only, one-click.
 *
 * "Joinable" state is computed both client-side (for the button style, so
 * the countdown updates every 30s) and re-checked by the server on
 * /join (410 if the window has passed).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, LogIn, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { peerService, type ScheduledMeeting, type ScheduledMeetingStatus } from "@/services/api/candidate/peer";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { ApiClientError } from "@/services/api/client";
import { reservePeerMeetTab } from "@/lib/peerMeetTab";

const JOIN_WINDOW_BEFORE_MS = 5 * 60 * 1000; // matches backend JOIN_GRACE_MINUTES_BEFORE

function isJoinable(m: ScheduledMeeting, now: number): boolean {
  if (m.status === "cancelled" || m.status === "completed") return false;
  const start = new Date(m.scheduled_at).getTime();
  const end = start + m.duration_minutes * 60_000 + 60 * 60_000; // + backend AFTER grace
  return now >= start - JOIN_WINDOW_BEFORE_MS && now <= end;
}

function statusBadge(s: ScheduledMeetingStatus): { label: string; className: string } {
  switch (s) {
    case "live":
      return { label: "Live", className: "border-success/30 bg-success/10 text-success" };
    case "waiting":
      return { label: "Waiting for participant", className: "border-warning/30 bg-warning/10 text-warning" };
    case "scheduled":
      return { label: "Upcoming", className: "border-primary/30 bg-primary/10 text-primary" };
    case "completed":
      return { label: "Completed", className: "border-border text-muted-foreground" };
    case "cancelled":
      return { label: "Cancelled", className: "border-border text-muted-foreground" };
  }
}

function relativeStart(m: ScheduledMeeting, now: number): string {
  const diffMs = new Date(m.scheduled_at).getTime() - now;
  if (diffMs <= 0) {
    const mins = Math.abs(Math.round(diffMs / 60_000));
    return mins < 60 ? `Started ${mins}m ago` : `In progress`;
  }
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `Starts in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Starts in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `Starts in ${days}d`;
}

export function ScheduledMeetingsList({ refreshKey = 0 }: { refreshKey?: number }) {
  const [meetings, setMeetings] = useState<ScheduledMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const setActiveRoom = usePeerInterviewStore((s) => s.setActiveRoom);
  // Refresh whenever any modal bumps this — e.g. after a new meeting is
  // scheduled or one is cancelled — so the list stays in sync without a
  // manual page reload.
  const scheduledMeetingsVersion = usePeerInterviewStore((s) => s.scheduledMeetingsVersion);
  const bumpScheduledMeetings = usePeerInterviewStore((s) => s.bumpScheduledMeetings);

  const load = useCallback(async () => {
    try {
      const rows = await peerService.listScheduledMeetings();
      setMeetings(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load scheduled meetings.");
      setMeetings([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey, scheduledMeetingsVersion]);

  // Re-render every 30s so "Starts in Xm" and the button-enabled window stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(
    () => (meetings ?? []).slice().sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [meetings],
  );

  const handleJoin = useCallback(
    async (m: ScheduledMeeting) => {
      const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
      if (!peermeetUrl) {
        toast.error("Peer Interview is not configured. Set VITE_PEERMEET_URL.");
        return;
      }
      const tab = reservePeerMeetTab({
        title: "Opening your scheduled Peer Interview",
        message: "Verifying access and preparing your identity token.",
      });
      try {
        const res = await peerService.joinScheduledMeeting(m.id);
        const url = new URL("/", peermeetUrl);
        url.searchParams.set("room", res.room_id);
        url.searchParams.set("init", "1");
        url.searchParams.set("private", res.keep_private ? "1" : "0");
        // Identity token goes in the URL fragment so it never leaks via
        // Referer / access logs / browser history (see PeerInterviewMatchModal
        // for the full rationale).
        url.hash = `token=${encodeURIComponent(res.token)}`;
        setActiveRoom(res.room_id, res.keep_private);
        tab.navigate(url.toString());
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
    [setActiveRoom],
  );

  const handleCancel = useCallback(
    async (m: ScheduledMeeting) => {
      try {
        await peerService.cancelScheduledMeeting(m.id);
        toast.success("Meeting cancelled");
        setMeetings((prev) => (prev ?? []).filter((x) => x.id !== m.id));
        bumpScheduledMeetings();
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "Could not cancel meeting.");
      }
    },
    [],
  );

  const handleCopy = useCallback(async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID copied");
    } catch {
      toast.error("Could not copy — select and copy manually.");
    }
  }, []);

  if (meetings === null && !error) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scheduled meetings…
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
          <h3 className="font-display text-sm font-semibold">Scheduled Peer Interviews</h3>
          <p className="text-xs text-muted-foreground">
            Meetings you created or were invited to.
          </p>
        </div>
        <Badge variant="outline">{sorted.length}</Badge>
      </div>
      <ul className="space-y-2">
        {sorted.map((m) => {
          const joinable = isJoinable(m, now);
          const when = new Date(m.scheduled_at);
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
                    <Badge className={statusBadge(m.status).className}>
                      {statusBadge(m.status).label}
                    </Badge>
                    {m.role === "invitee" && (
                      <Badge variant="outline" className="text-[10px]">
                        Invited
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {when.toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {m.duration_minutes} min · {relativeStart(m, now)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {m.room_id}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleCopy(m.room_id)}
                      aria-label="Copy room ID"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    size="sm"
                    onClick={() => handleJoin(m)}
                    disabled={!joinable}
                    className={joinable ? "bg-gradient-brand text-primary-foreground" : ""}
                    variant={joinable ? "default" : "outline"}
                  >
                    <LogIn className="mr-1.5 h-3.5 w-3.5" />
                    Join
                  </Button>
                  {m.role === "creator" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCancel(m)}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="mr-1 h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
