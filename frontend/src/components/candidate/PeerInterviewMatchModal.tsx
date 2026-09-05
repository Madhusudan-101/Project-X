/**
 * Peer Interview matching modal — a "peer-signal-lock" experience.
 *
 * Visual identity intentionally NOT a dating-app riff. Instead: two candidate
 * identity chips on a live circuit, a directional data-packet beam between
 * them, and the match beat materializes a "PAIRED" session badge in the
 * center. The ready panel folds the chips to a small linked-strip so the
 * room ID becomes the hero of stage 4.
 *
 * States:
 *   1. search      — scanline sweeps; identity chips wide apart, ambient pulse.
 *   2. connecting  — chips ease toward center; beam thickens; data packets flow.
 *   3. match       — beam locks; PAIRED badge materializes; soft halo.
 *   4. ready       — chips fold to a linked strip; room ID + privacy + CTA.
 *
 * Pipeline reuse (unchanged):
 *   - peerService.createSessionToken() for the JWT.
 *   - Room ID generated client-side, PeerMeet handles create-room server-side
 *     via its existing MeetingRoom init flow (?init=true).
 *   - Privacy toggle passed via ?private=1 to PeerMeet; client-side only.
 *   - Never persists the token; never touches the backend contract.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, LogIn, Radar, Shield, User, Zap } from "lucide-react";
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
import { peerService } from "@/services/api/candidate/peer";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { useAuthStore } from "@/store/auth";

// ────────────────────────────────────────────────────────────────────────────

function generateRoomId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return uuid.replace(/-/g, "").slice(0, 12);
}

function buildPeerMeetUrl(base: string, params: Record<string, string>): string | null {
  try {
    const url = new URL("/", base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
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

type Phase = "search" | "connecting" | "match" | "ready" | "joining";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

  const [phase, setPhase] = useState<Phase>("search");
  const [readyRoomId, setReadyRoomId] = useState<string | null>(null);
  const [readyToken, setReadyToken] = useState<string | null>(null);
  const [keepPrivate, setKeepPrivate] = useState(true);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const activeRef = useRef(false);

  useEffect(() => {
    if (open) {
      activeRef.current = true;
      setPhase("search");
      setReadyRoomId(null);
      setReadyToken(null);
      setKeepPrivate(true);
      setJoinInput("");
      setJoinError(null);
      setShowJoin(false);
    } else {
      activeRef.current = false;
    }
  }, [open]);

  // Kick off the beat + mint on open. Advance to `ready` only after BOTH the
  // match beat has landed AND the token mint returned — whichever is later.
  useEffect(() => {
    if (!open || showJoin) return;

    let cancelled = false;
    const roomId = generateRoomId();
    const t1 = setTimeout(() => !cancelled && setPhase("connecting"), 700);
    const t2 = setTimeout(() => !cancelled && setPhase("match"), 1700);

    let matchLanded = false;
    let mintedToken: string | null = null;
    const advanceIfReady = () => {
      if (matchLanded && mintedToken) {
        setReadyRoomId(roomId);
        setPhase("ready");
      }
    };
    const t3 = setTimeout(() => {
      matchLanded = true;
      if (!cancelled) advanceIfReady();
    }, 2600);

    peerService
      .createSessionToken()
      .then(({ token }) => {
        if (cancelled) return;
        mintedToken = token;
        setReadyToken(token);
        advanceIfReady();
      })
      .catch((err) => {
        if (cancelled) return;
        onOpenChange(false);
        toast.error(
          err instanceof Error ? err.message : "Could not start Peer Interview.",
        );
      });

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [open, showJoin, onOpenChange]);

  const enterInterview = useCallback(() => {
    const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
    if (!peermeetUrl) {
      toast.error("Peer Interview is not configured. Set VITE_PEERMEET_URL.");
      return;
    }
    if (!readyToken || !readyRoomId) return;
    const target = buildPeerMeetUrl(peermeetUrl, {
      token: readyToken,
      room: readyRoomId,
      init: "1",
      private: keepPrivate ? "1" : "0",
    });
    if (!target) {
      toast.error("VITE_PEERMEET_URL is invalid.");
      return;
    }
    setActiveRoom(readyRoomId, keepPrivate);
    window.open(target, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  }, [readyRoomId, readyToken, keepPrivate, setActiveRoom, onOpenChange]);

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
      setPhase("joining");
      const win = window.open("about:blank", "_blank", "noopener,noreferrer");
      try {
        const { token } = await peerService.createSessionToken();
        const target = buildPeerMeetUrl(peermeetUrl, {
          token,
          room: trimmed,
          private: keepPrivate ? "1" : "0",
        });
        if (!target) throw new Error("VITE_PEERMEET_URL is invalid.");
        if (win && !win.closed) win.location.replace(target);
        else window.open(target, "_blank", "noopener,noreferrer");
        onOpenChange(false);
      } catch (err) {
        if (win && !win.closed) win.close();
        setPhase("search");
        setShowJoin(true);
        toast.error(
          err instanceof Error ? err.message : "Could not join Peer Interview.",
        );
      }
    },
    [joinInput, keepPrivate, onOpenChange],
  );

  const copyRoomId = useCallback(async () => {
    if (!readyRoomId) return;
    try {
      await navigator.clipboard.writeText(readyRoomId);
      toast.success("Room ID copied");
    } catch {
      toast.error("Could not copy — select the ID and copy manually.");
    }
  }, [readyRoomId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden border-border/60 p-0">
        <PeerMatchKeyframes />
        {showJoin ? (
          <JoinExistingPanel
            joinInput={joinInput}
            joinError={joinError}
            setJoinInput={(v) => {
              setJoinInput(v);
              if (joinError) setJoinError(null);
            }}
            onSubmit={joinExistingInterview}
            onBack={() => setShowJoin(false)}
            isSubmitting={phase === "joining"}
            keepPrivate={keepPrivate}
            setKeepPrivate={setKeepPrivate}
          />
        ) : phase === "ready" && readyRoomId ? (
          <ReadyPanel
            roomId={readyRoomId}
            initials={initials}
            displayName={displayName}
            keepPrivate={keepPrivate}
            setKeepPrivate={setKeepPrivate}
            onCopy={copyRoomId}
            onEnter={enterInterview}
          />
        ) : (
          <MatchStage
            phase={phase}
            initials={initials}
            displayName={displayName}
            onShowJoin={() => setShowJoin(true)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stage 1–3 canvas ─────────────────────────────────────────────────────
function MatchStage({
  phase,
  initials,
  displayName,
  onShowJoin,
}: {
  phase: Phase;
  initials: string;
  displayName: string;
  onShowJoin: () => void;
}) {
  const isConnecting = phase === "connecting" || phase === "match";
  const isMatch = phase === "match";

  const leftChipShift = isMatch ? "-46px" : isConnecting ? "-64px" : "-124px";
  const rightChipShift = isMatch ? "46px" : isConnecting ? "64px" : "124px";

  return (
    <div className="relative flex min-h-[440px] flex-col">
      <SceneBackdrop phase={phase} />

      <DialogHeader className="relative px-6 pt-6">
        <div className="mx-auto mb-1 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isMatch ? "bg-success" : "bg-primary animate-pulse"
            }`}
          />
          Peer Interview
        </div>
        <DialogTitle className="text-center font-display text-lg">
          {phase === "search" && "Scanning peer network…"}
          {phase === "connecting" && "Establishing secure channel…"}
          {isMatch && (
            <span className="bg-gradient-brand bg-clip-text text-transparent">
              You’re paired
            </span>
          )}
        </DialogTitle>
        <DialogDescription className="text-center">
          {phase === "search" && "Locating a candidate to trade a live round with."}
          {phase === "connecting" && "Handshake in progress — verifying your session."}
          {isMatch && "A private practice room has been opened for you two."}
        </DialogDescription>
      </DialogHeader>

      {/* Middle band: flex-1 makes it consume all vertical space between
          header and footer; items-center centers the h-56 stage inside it
          so the animation gets its own dedicated centered zone with no risk
          of colliding with the header or footer above/below. */}
      <div className="relative flex flex-1 items-center justify-center px-4">
        <div className="relative h-56 w-full max-w-[460px]">
        {/* Beam layer */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <ConnectionBeam phase={phase} />
        </div>

        {/* Left identity chip */}
        <div
          className="absolute left-1/2 top-1/2 -translate-y-1/2 will-change-transform"
          style={{
            transform: `translate(calc(-50% + ${leftChipShift}), -50%) ${isMatch ? "scale(1.04)" : "scale(1)"}`,
            transition: "transform 900ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          <IdentityChip
            initials={initials}
            role="You"
            sublabel={displayName}
            active={isConnecting}
            locked={isMatch}
          />
        </div>

        {/* Right identity chip */}
        <div
          className="absolute left-1/2 top-1/2 -translate-y-1/2 will-change-transform"
          style={{
            transform: `translate(calc(-50% + ${rightChipShift}), -50%) ${isMatch ? "scale(1.04)" : "scale(1)"}`,
            transition: "transform 900ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          <IdentityChip
            initials="?"
            role="Peer"
            sublabel={phase === "search" ? "Awaiting signal" : "Handshake…"}
            active={isConnecting}
            locked={isMatch}
            isPeer
          />
        </div>

        {/* Center paired badge — only visible at match */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            opacity: isMatch ? 1 : 0,
            transform: `translate(-50%, -50%) scale(${isMatch ? 1 : 0.6})`,
            transition:
              "opacity 400ms ease-out 120ms, transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms",
          }}
        >
          <PairedBadge />
        </div>

        {/* Subtle drifting orbit dots — become active at match */}
        <OrbitDrift active={isMatch} />
        </div>
      </div>

      <div className="relative flex items-center justify-center border-t border-border/60 px-6 py-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onShowJoin}
          className="rounded px-2 py-1 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Have a room ID? Join instead
        </button>
      </div>
    </div>
  );
}

function IdentityChip({
  initials,
  role,
  sublabel,
  active,
  locked,
  isPeer,
}: {
  initials: string;
  role: string;
  sublabel: string;
  active: boolean;
  locked: boolean;
  isPeer?: boolean;
}) {
  return (
    <div
      className={`relative flex w-[132px] flex-col items-center gap-2 rounded-2xl border p-3 backdrop-blur transition-all duration-500 ${
        locked
          ? "border-transparent bg-card/90 shadow-[0_0_0_1px_hsl(var(--primary)/0.5),0_18px_40px_-16px_hsl(var(--primary)/0.55)]"
          : active
            ? "border-primary/25 bg-card/80 shadow-[0_10px_30px_-16px_hsl(var(--primary)/0.35)]"
            : "border-border/60 bg-card/70 shadow-sm"
      } animate-[peermatch-float_3.6s_ease-in-out_infinite]`}
      style={{ animationDelay: isPeer ? "-1.8s" : "0s" }}
    >
      {/* Avatar */}
      <div className="relative">
        <div
          className={`absolute inset-0 rounded-full transition-all duration-500 ${
            locked
              ? "bg-gradient-brand-soft blur-[8px]"
              : active
                ? "bg-primary/25 blur-[6px]"
                : "bg-primary/10 blur-[4px]"
          }`}
          aria-hidden="true"
        />
        <div
          className={`relative grid h-14 w-14 place-items-center rounded-full font-display text-lg font-bold ${
            locked
              ? "bg-gradient-brand text-primary-foreground"
              : "bg-primary/10 text-primary"
          }`}
        >
          {initials === "?" ? <User className="h-5 w-5" /> : initials}
        </div>
        {/* Status dot */}
        <span
          className={`absolute -bottom-0.5 ${isPeer ? "left-0" : "right-0"} h-3 w-3 rounded-full border-2 border-background ${
            locked ? "bg-success" : active ? "bg-primary animate-pulse" : "bg-muted-foreground/60"
          }`}
        />
      </div>

      <div className="text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {role}
        </div>
        <div className="line-clamp-1 text-[11px] text-foreground/80">{sublabel}</div>
      </div>
    </div>
  );
}

function ConnectionBeam({ phase }: { phase: Phase }) {
  const isConnecting = phase === "connecting" || phase === "match";
  const isMatch = phase === "match";
  return (
    <div className="relative h-[3px] w-[260px]">
      {/* Base track */}
      <div
        className={`absolute inset-0 rounded-full transition-all duration-700 ${
          isMatch
            ? "opacity-100 bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.9),hsl(var(--secondary)/0.9),transparent)]"
            : isConnecting
              ? "opacity-90 bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.7),transparent)]"
              : "opacity-40 bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.35),transparent)]"
        }`}
      />
      {/* Halo glow on match */}
      {isMatch && (
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-2xl" />
      )}

      {/* Search: soft scanning sweep */}
      {phase === "search" && (
        <span
          className="absolute top-1/2 -translate-y-1/2 h-2 w-6 rounded-full bg-primary/80 blur-[6px]"
          style={{ animation: "peermatch-scan 1.6s ease-in-out infinite" }}
        />
      )}

      {/* Connecting: data packets flowing both directions */}
      {isConnecting && (
        <>
          <BeamPacket delay="0ms" />
          <BeamPacket delay="380ms" />
          <BeamPacket delay="760ms" reverse />
        </>
      )}
    </div>
  );
}

function BeamPacket({ delay, reverse }: { delay: string; reverse?: boolean }) {
  return (
    <span
      className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.9)]"
      style={{
        animation: `${reverse ? "peermatch-packet-r" : "peermatch-packet"} 1.4s linear infinite`,
        animationDelay: delay,
      }}
    />
  );
}

function PairedBadge() {
  return (
    <div className="relative">
      {/* Outer ripple */}
      <span
        className="absolute inset-0 -m-2 rounded-full bg-primary/20"
        style={{ animation: "peermatch-ripple 1400ms ease-out 200ms both" }}
      />
      <div className="relative flex items-center gap-2 rounded-full border border-primary/40 bg-gradient-brand px-3 py-1.5 text-primary-foreground shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.7)]">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-primary-foreground/20">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
          Paired
        </span>
      </div>
    </div>
  );
}

function OrbitDrift({ active }: { active: boolean }) {
  // Six brand-tinted specks that drift outward from center once paired.
  const flecks = useMemo(
    () =>
      Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 6;
        const radius = 70 + ((i * 11) % 32);
        return {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.55, // squashed vertically to hug the beam
          delay: `${(i * 55) % 260}ms`,
          hueSecondary: i % 2 === 0,
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {flecks.map((f, i) => (
        <span
          key={i}
          className="absolute h-1 w-1 rounded-full opacity-0"
          style={{
            background: f.hueSecondary ? "hsl(var(--secondary))" : "hsl(var(--primary))",
            animation: active ? `peermatch-drift 900ms ease-out ${f.delay} both` : "none",
            ["--dx" as unknown as string]: `${f.x}px`,
            ["--dy" as unknown as string]: `${f.y}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function SceneBackdrop({ phase }: { phase: Phase }) {
  const isMatch = phase === "match";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Base radial wash — brand tint intensifies on match */}
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          isMatch ? "opacity-100" : "opacity-70"
        }`}
        style={{
          background:
            "radial-gradient(120% 80% at 50% 40%, hsl(var(--primary) / 0.10), transparent 60%)",
        }}
      />
      {/* Fine grid — subtle, only during search/connecting */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          isMatch ? "opacity-0" : "opacity-[0.18]"
        }`}
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(120% 80% at 50% 40%, black, transparent 70%)",
        }}
      />
      {/* Soft top scanline during search */}
      {phase === "search" && (
        <div
          className="absolute inset-x-0 h-16 bg-[linear-gradient(180deg,transparent,hsl(var(--primary)/0.14),transparent)]"
          style={{ animation: "peermatch-scanline 2.4s ease-in-out infinite" }}
        />
      )}
      {/* Center bloom on match */}
      {isMatch && (
        <div
          className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, hsl(var(--primary) / 0.28), transparent 65%)",
          }}
        />
      )}
    </div>
  );
}

/** Injected keyframes — kept co-located so the whole animation ships with
 *  the component and no unrelated stylesheet is touched. */
function PeerMatchKeyframes() {
  return (
    <style>{`
      @keyframes peermatch-float {
        0%,100% { transform: translateY(0); }
        50%     { transform: translateY(-4px); }
      }
      @keyframes peermatch-scan {
        0%   { left: 0%;   opacity: 0; }
        20%  {              opacity: 1; }
        80%  {              opacity: 1; }
        100% { left: 100%; opacity: 0; }
      }
      @keyframes peermatch-packet {
        0%   { left: 0%;   opacity: 0; transform: translateY(-50%) scale(0.6); }
        15%  {              opacity: 1; transform: translateY(-50%) scale(1); }
        85%  {              opacity: 1; transform: translateY(-50%) scale(1); }
        100% { left: 100%; opacity: 0; transform: translateY(-50%) scale(0.6); }
      }
      @keyframes peermatch-packet-r {
        0%   { left: 100%; opacity: 0; transform: translateY(-50%) scale(0.6); }
        15%  {              opacity: 1; transform: translateY(-50%) scale(1); }
        85%  {              opacity: 1; transform: translateY(-50%) scale(1); }
        100% { left: 0%;   opacity: 0; transform: translateY(-50%) scale(0.6); }
      }
      @keyframes peermatch-scanline {
        0%   { transform: translateY(-100%); opacity: 0; }
        20%  {                                opacity: 1; }
        100% { transform: translateY(240px); opacity: 0; }
      }
      @keyframes peermatch-ripple {
        0%   { transform: scale(0.6); opacity: 0.9; }
        100% { transform: scale(1.9); opacity: 0;   }
      }
      @keyframes peermatch-drift {
        0%   { transform: translate(0, 0)                       scale(0.5); opacity: 0; }
        20%  {                                                                 opacity: 1; }
        100% { transform: translate(var(--dx, 0), var(--dy, 0)) scale(1);   opacity: 0; }
      }
      @keyframes peermatch-reveal {
        0%   { opacity: 0; transform: translateY(8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes peermatch-shine {
        0%   { transform: translateX(-120%); }
        100% { transform: translateX(120%);  }
      }
    `}</style>
  );
}

// ─── Stage 4: ready ───────────────────────────────────────────────────────
function ReadyPanel({
  roomId,
  initials,
  displayName,
  keepPrivate,
  setKeepPrivate,
  onCopy,
  onEnter,
}: {
  roomId: string;
  initials: string;
  displayName: string;
  keepPrivate: boolean;
  setKeepPrivate: (v: boolean) => void;
  onCopy: () => void;
  onEnter: () => void;
}) {
  return (
    <div className="relative">
      {/* Ambient wash carried over from match so it doesn't feel like a jump */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(90%_60%_at_50%_0%,hsl(var(--primary)/0.16),transparent_65%)]" />

      <DialogHeader className="relative px-6 pt-6">
        <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          Room ready
        </div>
        <DialogTitle className="text-center font-display text-lg">
          Your Peer Interview is live
        </DialogTitle>
        <DialogDescription className="text-center">
          Share the room ID so your peer can join, or enter now.
        </DialogDescription>
      </DialogHeader>

      {/* Linked strip: shrunken chips + inline PAIRED marker */}
      <div className="relative mx-auto mt-4 flex items-center justify-center gap-3">
        <MiniChip initials={initials} label={displayName} />
        <div className="flex items-center gap-1">
          <span className="h-px w-6 bg-gradient-to-r from-transparent to-primary/70" />
          <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className="h-px w-6 bg-gradient-to-l from-transparent to-secondary/70" />
        </div>
        <MiniChip initials="?" label="Peer" peer />
      </div>

      <div
        className="relative space-y-4 px-6 pb-5 pt-5"
        style={{ animation: "peermatch-reveal 500ms cubic-bezier(0.22,0.61,0.36,1) both" }}
      >
        {/* Room ID — hero of the ready panel */}
        <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-card p-4">
          {/* Subtle shine sweep once */}
          <span
            className="pointer-events-none absolute inset-y-0 -inset-x-1 block bg-[linear-gradient(120deg,transparent,hsl(var(--primary)/0.22),transparent)]"
            style={{ animation: "peermatch-shine 900ms ease-out 250ms 1 both" }}
          />
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Room ID
              </div>
              <code className="mt-1 block truncate font-mono text-base font-semibold tracking-wider text-foreground">
                {roomId}
              </code>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onCopy}
              className="shrink-0 transition-transform active:scale-95"
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-3 transition-colors hover:bg-card">
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

        <Button
          className="group h-11 w-full bg-gradient-brand text-primary-foreground transition-transform active:scale-[0.99]"
          onClick={onEnter}
        >
          <LogIn className="mr-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          Enter Interview
          <Zap className="ml-2 h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
        </Button>
      </div>
    </div>
  );
}

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
      <span className="max-w-[7ch] truncate font-medium text-foreground/85">{label}</span>
    </div>
  );
}

// ─── Alternate flow: join with an existing room ID ────────────────────────
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
