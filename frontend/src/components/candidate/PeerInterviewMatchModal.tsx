/**
 * Peer Interview matching modal — REAL server-side matchmaking.
 *
 * States (all driven by the FastAPI /candidate/peer-matchmaking/* endpoints,
 * NEVER by client-only timers):
 *
 *   1. mode='choose'  — three CTAs: Find a partner / Join by room ID / Schedule.
 *   2. mode='find'    — actively polling the queue.
 *                       Sub-states:
 *                         searching → waiting for another student.
 *                         matched   → server has paired us; auto-open PeerMeet.
 *   3. mode='join'    — paste a shared room ID.
 *   4. mode='schedule'→ open the schedule modal (delegated to a sibling component).
 *
 * Every room ID that reaches PeerMeet was minted by the server — the client
 * NEVER generates a room ID any more.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  LogIn,
  Radar,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  peerService,
  type MatchmakingStatus,
} from "@/services/api/candidate/peer";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { useAuthStore } from "@/store/auth";
import { ApiClientError } from "@/services/api/client";
import { ScheduleMeetingModal } from "@/components/candidate/ScheduleMeetingModal";
import { reservePeerMeetTab, type PeerMeetTabHandle } from "@/lib/peerMeetTab";

// ─── URL helpers ──────────────────────────────────────────────────────────

/**
 * Build the PeerMeet URL for a room. The identity `token` is placed in the
 * URL fragment (`#token=...`) rather than the query string so it does NOT
 * appear in `document.referrer`, HTTP access logs, browser history entries,
 * or CDN caches — any of which could otherwise leak a 10-minute
 * impersonation token. All other params stay in the query string where the
 * PeerMeet client already reads them.
 */
function buildPeerMeetUrl(
  base: string,
  params: Record<string, string>,
  { token }: { token?: string } = {},
): string | null {
  try {
    const url = new URL("/", base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token) url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  } catch {
    return null;
  }
}

function initialsFrom(name: string | undefined): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

type Mode = "choose" | "find" | "join" | "schedule";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const POLL_INTERVAL_MS = 2000;

export function PeerInterviewMatchModal({ open, onOpenChange }: Props) {
  const setActiveRoom = usePeerInterviewStore((s) => s.setActiveRoom);
  const session = useAuthStore((s) => s.session);

  const displayName =
    session?.user?.firstName ??
    session?.user?.name?.split(" ")[0] ??
    session?.user?.email ??
    "You";
  const initials = useMemo(
    () => initialsFrom(session?.user?.name ?? displayName),
    [session, displayName],
  );

  const [mode, setMode] = useState<Mode>("choose");
  const [keepPrivate, setKeepPrivate] = useState(true);
  const [status, setStatus] = useState<MatchmakingStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [waitingSecs, setWaitingSecs] = useState(0);

  // Join-by-id state
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Guards
  const inflightRef = useRef(false);
  const cancelledRef = useRef(false);
  // Reserved-tab handle for the room-opening flow. `reservePeerMeetTab()`
  // pre-opens a blank tab inside the user click so browsers accept the
  // eventual navigation as gesture-initiated; the helper then navigates
  // that same tab once we have the final PeerMeet URL. Guarantees exactly
  // ONE tab per user action — no orphan blank tab.
  const reservedTabRef = useRef<PeerMeetTabHandle | null>(null);

  // Reset when the dialog opens/closes.
  useEffect(() => {
    if (open) {
      cancelledRef.current = false;
      setMode("choose");
      setStatus(null);
      setErrorMsg(null);
      setWaitingSecs(0);
      setJoinInput("");
      setJoinError(null);
      setJoining(false);
    } else {
      cancelledRef.current = true;
      // Close any tab we reserved but never used (e.g. user closed the
      // dialog while still searching).
      reservedTabRef.current?.abort();
      reservedTabRef.current = null;
    }
  }, [open]);

  // ── Elapsed-time counter while searching (UI only) ─────────────────────
  useEffect(() => {
    if (mode !== "find" || status?.status !== "waiting") return;
    const t = setInterval(() => setWaitingSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [mode, status?.status]);

  // ── The one and only matchmaking effect: polls the server. ─────────────
  const poll = useCallback(
    async (isFirst = false) => {
      if (inflightRef.current || cancelledRef.current) return;
      inflightRef.current = true;
      try {
        const res = await peerService.requestMatch(keepPrivate);
        if (cancelledRef.current) return;
        setStatus(res);
        if (isFirst && res.status === "waiting") {
          setWaitingSecs(0);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Matchmaking failed";
        setErrorMsg(msg);
      } finally {
        inflightRef.current = false;
      }
    },
    [keepPrivate],
  );

  useEffect(() => {
    if (mode !== "find") return;
    cancelledRef.current = false;
    poll(true);
    // Skip polls while the tab is hidden — matchmaking is a foreground
    // action and there's no point paying for RPC calls that update nothing
    // the user can see. On return-to-foreground we run one immediately.
    const tick = () => {
      if (status?.status === "matched") return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      poll(false);
    };
    const t = setInterval(tick, POLL_INTERVAL_MS);
    const onVis = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        status?.status !== "matched"
      ) {
        poll(false);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
    // We intentionally re-run when the status flips to matched so the
    // interval can stop; keepPrivate is captured via `poll`.
  }, [mode, poll, status?.status]);

  // ── Auto-open PeerMeet the moment we're matched. ───────────────────────
  useEffect(() => {
    if (!status || status.status !== "matched" || !status.room_id || !status.token) return;
    const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
    if (!peermeetUrl) {
      setErrorMsg("VITE_PEERMEET_URL is not configured.");
      return;
    }
    const target = buildPeerMeetUrl(
      peermeetUrl,
      {
        room: status.room_id,
        // Both matched peers reach this branch; whoever's `join-room` finds
        // the room first joins normally, the other falls back to create.
        // The `init` flag stays on so the fallback still works.
        init: "1",
        private: status.keep_private ? "1" : "0",
      },
      { token: status.token },
    );
    if (!target) {
      setErrorMsg("VITE_PEERMEET_URL is invalid.");
      return;
    }
    setActiveRoom(status.room_id, status.keep_private);
    // small delay lets the "Partner found!" state paint before the tab opens
    const t = setTimeout(() => {
      // Single navigation entry point — either navigates the reserved
      // blank tab or, if the reserved tab was never available / was
      // closed by the user, opens exactly one fresh PeerMeet tab. Never
      // both.
      const reserved = reservedTabRef.current;
      if (reserved) {
        reserved.navigate(target);
      } else {
        window.open(target, "_blank");
      }
      reservedTabRef.current = null;
      onOpenChange(false);
    }, 500);
    return () => clearTimeout(t);
  }, [status, setActiveRoom, onOpenChange]);

  // ── Cancel button: leave the queue and go back to the chooser. ─────────
  const cancelSearch = useCallback(async () => {
    cancelledRef.current = true;
    setMode("choose");
    setStatus(null);
    setWaitingSecs(0);
    reservedTabRef.current?.abort();
    reservedTabRef.current = null;
    try {
      await peerService.cancelMatch();
    } catch {
      // Non-fatal — a stale row will expire on the next matcher sweep.
    }
  }, []);

  // ── Join by room ID (existing shareable-link flow, preserved). ─────────
  const joinExistingInterview = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
      if (!peermeetUrl) {
        toast.error("Peer Interview is not configured. Set VITE_PEERMEET_URL.");
        return;
      }
      const trimmed = joinInput.trim();
      if (trimmed.length < 8) {
        setJoinError("Enter a valid room ID.");
        return;
      }
      setJoinError(null);
      setJoining(true);
      const tab = reservePeerMeetTab({
        title: "Connecting to your Peer Interview",
        message: "Verifying the room ID and preparing your identity token.",
      });
      try {
        const { token } = await peerService.createSessionToken();
        const target = buildPeerMeetUrl(
          peermeetUrl,
          {
            room: trimmed,
            private: keepPrivate ? "1" : "0",
          },
          { token },
        );
        if (!target) throw new Error("VITE_PEERMEET_URL is invalid.");
        setActiveRoom(trimmed, keepPrivate);
        tab.navigate(target);
        onOpenChange(false);
      } catch (err) {
        tab.abort();
        setJoining(false);
        toast.error(
          err instanceof Error ? err.message : "Could not join Peer Interview.",
        );
      }
    },
    [joinInput, keepPrivate, onOpenChange, setActiveRoom],
  );

  const copyRoomId = useCallback(async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID copied");
    } catch {
      toast.error("Could not copy — select the ID and copy manually.");
    }
  }, []);

  // ── Sub-modal: schedule — renders its own Dialog inside this Dialog. ───
  const [scheduleOpen, setScheduleOpen] = useState(false);
  useEffect(() => {
    if (mode === "schedule") setScheduleOpen(true);
  }, [mode]);

  return (
    <>
      <Dialog open={open && mode !== "schedule"} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg overflow-hidden border-border/60 p-0">
          {mode === "choose" && (
            <ChoosePanel
              initials={initials}
              displayName={displayName}
              keepPrivate={keepPrivate}
              setKeepPrivate={setKeepPrivate}
              onFind={() => {
                // Reserve the target tab NOW (inside the user click) so
                // the browser accepts the eventual navigation as
                // gesture-initiated. The reserved tab is populated with
                // a "Finding a partner…" placeholder so the user does
                // not see a raw about:blank tab while matchmaking polls.
                // See src/lib/peerMeetTab.ts for the full rationale on
                // why this must NOT use `noopener`.
                reservedTabRef.current = reservePeerMeetTab({
                  title: "Finding a peer interview partner",
                  message:
                    "You'll be connected as soon as another candidate joins the queue. Keep this tab open — it will switch to your Peer Interview room automatically.",
                });
                setMode("find");
              }}
              onJoin={() => setMode("join")}
              onSchedule={() => setMode("schedule")}
            />
          )}
          {mode === "find" && (
            <FindPanel
              initials={initials}
              displayName={displayName}
              status={status}
              errorMsg={errorMsg}
              waitingSecs={waitingSecs}
              keepPrivate={keepPrivate}
              onCancel={cancelSearch}
              onCopyRoomId={copyRoomId}
            />
          )}
          {mode === "join" && (
            <JoinExistingPanel
              joinInput={joinInput}
              joinError={joinError}
              setJoinInput={(v) => {
                setJoinInput(v);
                if (joinError) setJoinError(null);
              }}
              onSubmit={joinExistingInterview}
              onBack={() => setMode("choose")}
              isSubmitting={joining}
              keepPrivate={keepPrivate}
              setKeepPrivate={setKeepPrivate}
            />
          )}
        </DialogContent>
      </Dialog>

      <ScheduleMeetingModal
        open={scheduleOpen}
        defaultKeepPrivate={keepPrivate}
        onOpenChange={(v) => {
          setScheduleOpen(v);
          if (!v) {
            // Whether user submitted or dismissed, close the parent modal too
            // so we don't leave stale state behind.
            setMode("choose");
            onOpenChange(false);
          }
        }}
      />
    </>
  );
}

// ─── Panel: choose ────────────────────────────────────────────────────────

function ChoosePanel({
  initials,
  displayName,
  keepPrivate,
  setKeepPrivate,
  onFind,
  onJoin,
  onSchedule,
}: {
  initials: string;
  displayName: string;
  keepPrivate: boolean;
  setKeepPrivate: (v: boolean) => void;
  onFind: () => void;
  onJoin: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="relative">
      <DialogHeader className="px-6 pt-6">
        <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Users className="h-3 w-3" />
          Peer Interview
        </div>
        <DialogTitle className="text-center font-display text-lg">
          Start a Peer Interview
        </DialogTitle>
        <DialogDescription className="text-center">
          Get matched with another candidate — or set up a meeting for later.
        </DialogDescription>
      </DialogHeader>

      <div className="mx-auto mt-4 flex items-center justify-center gap-2">
        <MiniChip initials={initials} label={displayName} />
      </div>

      <div className="space-y-3 px-6 pb-6 pt-4">
        <Button
          className="h-11 w-full bg-gradient-brand text-primary-foreground"
          onClick={onFind}
        >
          <Radar className="mr-2 h-4 w-4" />
          Find a partner now
        </Button>
        <Button variant="outline" className="h-11 w-full" onClick={onJoin}>
          <LogIn className="mr-2 h-4 w-4" />
          Join with a room ID
        </Button>
        <Button variant="outline" className="h-11 w-full" onClick={onSchedule}>
          <CalendarClock className="mr-2 h-4 w-4" />
          Schedule a meeting for later
        </Button>

        <label className="mt-2 flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-3 transition-colors hover:bg-card">
          <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
            <Shield className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Keep my identity private</span>
              <Switch
                checked={keepPrivate}
                onCheckedChange={setKeepPrivate}
                aria-label="Keep identity private"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your peer sees you as “Anonymous Candidate.” Mirracle still uses your profile for your report.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── Panel: find (searching / matched) ────────────────────────────────────

function FindPanel({
  initials,
  displayName,
  status,
  errorMsg,
  waitingSecs,
  keepPrivate,
  onCancel,
  onCopyRoomId,
}: {
  initials: string;
  displayName: string;
  status: MatchmakingStatus | null;
  errorMsg: string | null;
  waitingSecs: number;
  keepPrivate: boolean;
  onCancel: () => void;
  onCopyRoomId: (roomId: string) => void;
}) {
  const isMatched = status?.status === "matched";
  return (
    <div className="relative">
      <DialogHeader className="px-6 pt-6">
        <div
          className={`mx-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            isMatched
              ? "border-success/40 bg-success/10 text-success"
              : "border-border/60 bg-background/70 text-muted-foreground"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isMatched ? "bg-success" : "bg-primary animate-pulse"
            }`}
          />
          {isMatched ? "Partner found" : "Searching"}
        </div>
        <DialogTitle className="text-center font-display text-lg">
          {isMatched
            ? "You're paired — opening the room…"
            : "Finding an interview partner…"}
        </DialogTitle>
        <DialogDescription className="text-center">
          {isMatched
            ? `${status?.partner_name ? `Matched with ${keepPrivate || status.keep_private ? "an anonymous peer" : status.partner_name}. ` : ""}The interview room is opening in a new tab.`
            : "The server matches you with the next waiting candidate. This usually takes seconds."}
        </DialogDescription>
      </DialogHeader>

      <div className="mx-auto mt-6 flex items-center justify-center gap-4">
        <MiniChip initials={initials} label={displayName} />
        <div className="flex items-center gap-1">
          <span className="h-px w-6 bg-gradient-to-r from-transparent to-primary/70" />
          {isMatched ? (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-muted-foreground">
              <Radar className="h-3 w-3 animate-pulse" />
            </span>
          )}
          <span className="h-px w-6 bg-gradient-to-l from-transparent to-secondary/70" />
        </div>
        <MiniChip initials="?" label={isMatched ? "Peer" : "Waiting…"} peer />
      </div>

      {!isMatched && !errorMsg && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Waiting {formatWait(waitingSecs)} · Position in queue: you
        </p>
      )}

      {errorMsg && (
        <p className="mt-6 text-center text-xs text-destructive">{errorMsg}</p>
      )}

      {isMatched && status?.room_id && (
        <div className="mx-6 mt-6 rounded-xl border border-primary/30 bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Room ID
              </div>
              <code className="mt-1 block truncate font-mono text-sm font-semibold tracking-wider">
                {status.room_id}
              </code>
            </div>
            <Button size="sm" variant="outline" onClick={() => onCopyRoomId(status.room_id!)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-center border-t border-border/60 px-6 py-3">
        <Button variant="ghost" onClick={onCancel} disabled={isMatched}>
          <X className="mr-1.5 h-4 w-4" />
          Cancel search
        </Button>
      </div>
    </div>
  );
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// ─── Panel: join by room ID ───────────────────────────────────────────────

function JoinExistingPanel({
  joinInput,
  joinError,
  setJoinInput,
  onSubmit,
  onBack,
  isSubmitting,
  keepPrivate,
  setKeepPrivate,
}: {
  joinInput: string;
  joinError: string | null;
  setJoinInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  isSubmitting: boolean;
  keepPrivate: boolean;
  setKeepPrivate: (v: boolean) => void;
}) {
  return (
    <div>
      <DialogHeader className="px-6 pt-6">
        <div className="mx-auto mb-1 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Radar className="h-3 w-3" />
          Join by room ID
        </div>
        <DialogTitle>Join a Peer Interview</DialogTitle>
        <DialogDescription>Paste the room ID your peer shared with you.</DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
        <div>
          <Label htmlFor="peer-join-room" className="text-xs font-medium text-muted-foreground">
            Room ID
          </Label>
          <Input
            id="peer-join-room"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            placeholder="e.g. a1b2c3d4e5f6"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!joinError}
            className="mt-1 font-mono"
          />
          {joinError && <p className="mt-1 text-xs text-destructive">{joinError}</p>}
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3">
          <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
            <Shield className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Keep my identity private</span>
              <Switch
                checked={keepPrivate}
                onCheckedChange={setKeepPrivate}
                aria-label="Keep identity private"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your peer sees you as “Anonymous Candidate.”
            </p>
          </div>
        </label>

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-gradient-brand text-primary-foreground"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Connecting…" : "Join interview"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Bits shared with schedule modal ──────────────────────────────────────

function MiniChip({
  initials,
  label,
  peer,
}: {
  initials: string;
  label: string;
  peer?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs ${
        peer ? "border-border/60 bg-card" : "border-primary/40 bg-card shadow-sm"
      }`}
    >
      <span
        className={`grid h-6 w-6 place-items-center rounded-full font-display text-[10px] font-bold ${
          peer ? "bg-muted text-muted-foreground" : "bg-gradient-brand text-primary-foreground"
        }`}
      >
        {initials === "?" ? <User className="h-3 w-3" /> : initials}
      </span>
      <span className="max-w-[10ch] truncate font-medium text-foreground/85">{label}</span>
    </div>
  );
}
