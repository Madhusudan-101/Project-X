import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/services/api/client";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type {
  AiInterviewDomain,
  AiInterviewReport,
  AiInterviewReportDetail,
} from "@/types/candidate/aiInterview";
import { ReportView } from "./ReportView";
import { useInterviewRoom } from "./useInterviewRoom";

const DOMAINS: { id: AiInterviewDomain; label: string; blurb: string }[] = [
  { id: "ai_ml", label: "AI / ML", blurb: "Fundamentals, overfitting, productionizing models" },
  { id: "web_dev", label: "Web Development", blurb: "HTTP, rendering, APIs, caching, auth" },
  {
    id: "dsa",
    label: "Data Structures & Algorithms",
    blurb: "Complexity, core structures, classic problems",
  },
];

const REPORT_POLL_MS = 3000;
const REPORT_POLL_TIMEOUT_MS = 120_000;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AiInterviewTab() {
  const room = useInterviewRoom();
  const [domain, setDomain] = useState<AiInterviewDomain | null>(null);
  const [history, setHistory] = useState<AiInterviewReport[] | null>(null);
  const [report, setReport] = useState<AiInterviewReportDetail | null>(null);
  const [reportState, setReportState] = useState<"idle" | "waiting" | "timeout">("idle");
  const [selected, setSelected] = useState<AiInterviewReport | null>(null);

  const loadHistory = useCallback(() => {
    aiInterviewService
      .listReports()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // Warn before closing the tab mid-interview.
  const live = room.phase === "live" || room.phase === "connecting";
  useEffect(() => {
    if (!live) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [live]);

  // After the call ends, poll until the agent has posted the report.
  const { phase, roomName } = room;
  const pollAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (phase !== "ended" || !roomName) return;
    const ctrl = new AbortController();
    pollAbort.current = ctrl;
    const startedAt = Date.now();
    setReport(null);
    setReportState("waiting");
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const r = await aiInterviewService.getReport(roomName, ctrl.signal);
        setReport(r);
        setReportState("idle");
        loadHistory();
        return;
      } catch (err) {
        if (ctrl.signal.aborted) return;
        // 404 = not ready yet; anything else is transient, so keep trying until timeout.
        if (!(err instanceof ApiClientError && err.status === 404)) {
          /* fall through to retry */
        }
      }
      if (Date.now() - startedAt > REPORT_POLL_TIMEOUT_MS) {
        setReportState("timeout");
        return;
      }
      timer = setTimeout(tick, REPORT_POLL_MS);
    };
    void tick();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [phase, roomName, loadHistory]);

  const startAgain = () => {
    setReport(null);
    setReportState("idle");
    setSelected(null);
    room.reset();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">AI Voice Interview</h1>
        <p className="text-sm text-muted-foreground">
          Talk through a mock technical interview with an AI interviewer and get a scored report
          afterwards. Requires a microphone.
        </p>
      </div>

      {/* Remote audio is attached here; it renders nothing visible. */}
      <div ref={room.audioHostRef} className="hidden" aria-hidden />

      {room.phase === "setup" && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDomain(d.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  domain === d.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:border-primary/50"
                }`}
              >
                <div className="font-medium">{d.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{d.blurb}</div>
              </button>
            ))}
          </div>
          {room.error && <p className="text-sm text-destructive">{room.error}</p>}
          <Button
            disabled={!domain}
            onClick={() => domain && room.start(domain)}
            className="bg-gradient-brand text-primary-foreground"
          >
            <Mic className="mr-2 h-4 w-4" /> Start interview
          </Button>
        </>
      )}

      {room.phase === "connecting" && (
        <Card className="flex items-center gap-3 p-6 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Connecting to your interviewer…
        </Card>
      )}

      {room.phase === "live" && (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              {room.interviewerJoined ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Interview
                  in progress
                </>
              ) : room.interviewerMissing ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-destructive" /> Interviewer not connected
                </>
              ) : (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for the interviewer to
                  join…
                </>
              )}
            </span>
            {room.secondsLeft !== null && (
              <span className="text-sm tabular-nums text-muted-foreground">
                {fmt(room.secondsLeft)} left
              </span>
            )}
          </div>

          {room.interviewerMissing && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              The AI interviewer didn&apos;t join the call, so nobody can hear you. End the
              interview and try again. If it keeps happening, the voice agent service is probably
              not running.
            </p>
          )}

          <div className="min-h-32 space-y-2 rounded-lg bg-muted/40 p-3 text-sm" aria-live="polite">
            {room.captions.length === 0 ? (
              <p className="text-muted-foreground">Say hello — captions will appear here.</p>
            ) : (
              room.captions.map((c) => (
                <p key={c.id}>
                  <span className="font-medium">{c.who === "you" ? "You" : "Interviewer"}: </span>
                  <span className="text-muted-foreground">{c.text}</span>
                </p>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={room.toggleMute}>
              {room.muted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
              {room.muted ? "Unmute" : "Mute"}
            </Button>
            {room.needsAudioUnlock && (
              <Button variant="outline" onClick={room.unlockAudio}>
                <Volume2 className="mr-2 h-4 w-4" /> Enable audio
              </Button>
            )}
            <Button variant="destructive" onClick={room.end}>
              <PhoneOff className="mr-2 h-4 w-4" /> End interview
            </Button>
          </div>
        </Card>
      )}

      {room.phase === "ended" && (
        <div className="space-y-4">
          {report ? (
            <ReportView report={report} />
          ) : reportState === "timeout" ? (
            <Card className="p-6 text-sm">
              Your report is taking longer than expected. It will appear under “Past interviews”
              below once it is ready.
            </Card>
          ) : (
            <Card className="flex items-center gap-3 p-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Generating your report — this can take a
              few seconds…
            </Card>
          )}
          <Button variant="outline" onClick={startAgain}>
            Start a new interview
          </Button>
        </div>
      )}

      {room.phase === "setup" && history && history.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-base font-semibold">Past interviews</h2>
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelected(selected?.id === h.id ? null : h)}
              className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:border-primary/50"
            >
              <span>
                {DOMAINS.find((d) => d.id === h.domain)?.label ?? h.domain}
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(h.created_at).toLocaleDateString()}
                  {h.partial ? " · partial" : ""}
                </span>
              </span>
              <span className="font-medium">
                {h.overall_score === null ? "—" : `${Math.round(h.overall_score)}/100`}
              </span>
            </button>
          ))}
          {selected && <HistoryDetail summary={selected} />}
        </div>
      )}
    </div>
  );
}

/** Fetches the full report (with markdown) for a past interview on demand. */
function HistoryDetail({ summary }: { summary: AiInterviewReport }) {
  const [detail, setDetail] = useState<AiInterviewReportDetail | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    aiInterviewService
      .getReport(summary.room_id, ctrl.signal)
      .then(setDetail)
      .catch(() => {});
    return () => ctrl.abort();
  }, [summary.room_id]);
  return <ReportView report={detail ?? summary} />;
}
