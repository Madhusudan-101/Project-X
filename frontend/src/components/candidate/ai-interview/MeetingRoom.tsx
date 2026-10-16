import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, MicOff, PhoneOff, TriangleAlert, Volume2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";
import { domainInfo } from "./domains";
import { useIntegrityMonitor } from "./useIntegrityMonitor";
import type { useInterviewRoom } from "./useInterviewRoom";

type Room = ReturnType<typeof useInterviewRoom>;

const VIDEO_FLAG_MESSAGES = {
  no_face: "The interviewer cannot see your face. Move into frame and face the camera.",
  multiple_faces:
    "The interviewer can see more than one person. You must take this interview alone.",
  camera_blocked: "Your camera looks blocked or too dark. Uncover it or improve the lighting.",
} as const;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Live interview: one formal "meeting room" with interviewer stage, captions and call controls. */
export function MeetingRoom({
  room,
  domain,
  roleTitle,
  company,
}: {
  room: Room;
  domain?: AiInterviewDomain;
  roleTitle?: string;
  /** Set for a company interview. */
  company?: string;
}) {
  const role = roleTitle ?? (domain ? domainInfo(domain)?.role : undefined);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { tabSwitches, away } = useIntegrityMonitor(true, room.reportIntegrity);

  const { selfVideo } = room;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !selfVideo) return;
    selfVideo.attach(el);
    return () => {
      selfVideo.detach(el);
    };
  }, [selfVideo]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [room.captions]);

  const status = room.interviewerMissing
    ? "Not connected"
    : !room.interviewerJoined
      ? "Joining…"
      : room.interviewerSpeaking
        ? "Speaking"
        : "Listening";
  const lowTime = room.secondsLeft !== null && room.secondsLeft <= 60;

  return (
    <section
      aria-label="Interview room"
      className="overflow-hidden rounded-2xl border border-foreground bg-foreground text-background shadow-lg"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-background/15 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{role} interview</p>
          <p className="text-xs text-background/60">
            {company ? `${company} · AI interview` : "Practice interview"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="flex items-center gap-2 rounded-full border border-background/20 px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden />
            Live · interviewer can see your camera
          </span>
          {room.secondsLeft !== null && (
            <span
              className={`rounded-full border px-3 py-1.5 ${
                lowTime ? "border-destructive text-destructive-foreground" : "border-background/20"
              }`}
              role="timer"
              aria-label="Time remaining"
            >
              {fmt(room.secondsLeft)} left
            </span>
          )}
        </div>
      </header>

      {room.videoFlag && (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-destructive/60 bg-destructive/25 px-5 py-2.5 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span>{VIDEO_FLAG_MESSAGES[room.videoFlag]}</span>
        </div>
      )}

      {room.micLost && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-destructive/60 bg-destructive/25 px-5 py-2.5 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            Your microphone stopped, so the interviewer cannot hear you. Restore it to continue.
            This has been flagged.
          </span>
          <Button size="sm" variant="secondary" onClick={room.retryMic}>
            Restore microphone
          </Button>
        </div>
      )}

      {(away || room.cameraLost) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-destructive/60 bg-destructive/25 px-5 py-2.5 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {room.cameraLost
              ? "Your camera stopped. Restore it to continue. This has been flagged."
              : "You left the interview tab. Return now and stay on this page. This has been flagged."}
          </span>
          {room.cameraLost && (
            <Button size="sm" variant="secondary" onClick={room.retryCamera}>
              Restore camera
            </Button>
          )}
        </div>
      )}

      <div className="grid min-h-[420px] gap-0 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative flex flex-col items-center justify-center gap-4 p-8">
          <div
            className={`flex h-32 w-32 items-center justify-center rounded-full bg-gradient-brand font-display text-4xl font-semibold text-primary-foreground transition-shadow ${
              room.interviewerSpeaking ? "shadow-[0_0_0_8px_rgba(255,255,255,0.12)]" : ""
            }`}
            aria-hidden
          >
            AI
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-semibold">Interviewer</p>
            <p
              className="mt-0.5 flex items-center justify-center gap-2 text-sm text-background/70"
              aria-live="polite"
            >
              {!room.interviewerJoined && !room.interviewerMissing && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              {status}
            </p>
          </div>
          <div className="absolute bottom-4 left-4 w-40 overflow-hidden rounded-lg border border-background/25 bg-background/10 sm:w-48">
            <div className="relative aspect-video">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Your camera"
                className="h-full w-full -scale-x-100 object-cover"
              />
              {!room.selfVideo && (
                <div className="absolute inset-0 flex items-center justify-center text-background/60">
                  <Camera className="h-5 w-5" aria-hidden />
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[11px]">
                You {room.muted ? "· muted" : ""}
              </span>
            </div>
          </div>
          {room.interviewerMissing && (
            <p className="max-w-md rounded-lg border border-destructive/60 bg-destructive/20 p-3 text-center text-sm">
              The AI interviewer didn&apos;t join the call, so nobody can hear you. End the
              interview and try again. If it keeps happening, the voice agent service is probably
              not running.
            </p>
          )}
        </div>

        <aside className="flex min-h-0 flex-col border-t border-background/15 md:border-l md:border-t-0">
          <div className="border-b border-background/15 px-4 py-3 text-xs font-medium uppercase tracking-wider text-background/60">
            Live transcript
          </div>
          <div
            ref={logRef}
            className="max-h-72 flex-1 space-y-3 overflow-y-auto p-4 text-sm md:max-h-none"
            aria-live="polite"
          >
            {room.captions.length === 0 ? (
              <p className="text-background/60">Say hello. The transcript will appear here.</p>
            ) : (
              room.captions.map((c) => (
                <p key={c.id}>
                  <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wider text-background/50">
                    {c.who === "you" ? "You" : "Interviewer"}
                  </span>
                  {c.text}
                </p>
              ))
            )}
          </div>
          <p className="border-t border-background/15 px-4 py-3 text-xs text-background/60">
            Answer in your own words. No AI tools, notes or outside help.
            {tabSwitches > 0 && (
              <span className="mt-1 block text-destructive-foreground">
                Tab switches flagged: {tabSwitches}
              </span>
            )}
          </p>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-background/15 px-4 py-3">
        <Button
          variant="secondary"
          onClick={room.toggleMute}
          aria-pressed={room.muted}
          className="min-w-28"
        >
          {room.muted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
          {room.muted ? "Unmute" : "Mute"}
        </Button>
        {room.needsAudioUnlock && (
          <Button variant="secondary" onClick={room.unlockAudio}>
            <Volume2 className="mr-2 h-4 w-4" /> Enable audio
          </Button>
        )}
        <Button variant="destructive" onClick={() => setConfirmEnd(true)}>
          <PhoneOff className="mr-2 h-4 w-4" /> End interview
        </Button>
      </footer>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the interview?</AlertDialogTitle>
            <AlertDialogDescription>
              You cannot rejoin once you end this session. A report will be generated from the
              answers you have given so far.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={room.end}>End interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
