import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/services/api/client";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type {
  AiInterviewConfig,
  AiInterviewDomain,
  AiInterviewReport,
  AiInterviewReportDetail,
} from "@/types/candidate/aiInterview";
import { DOMAINS } from "./domains";
import { DeviceCheck } from "./DeviceCheck";
import { InterviewBriefing } from "./InterviewBriefing";
import { MeetingRoom } from "./MeetingRoom";
import { ReportView } from "./ReportView";
import { useInterviewRoom } from "./useInterviewRoom";
import { WaitingRoom } from "./WaitingRoom";

const REPORT_POLL_MS = 3000;
const REPORT_POLL_TIMEOUT_MS = 120_000;

export function AiInterviewTab() {
  const room = useInterviewRoom();
  const [domain, setDomain] = useState<AiInterviewDomain | null>(null);
  const [config, setConfig] = useState<AiInterviewConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [stage, setStage] = useState<"briefing" | "check">("briefing");
  const [history, setHistory] = useState<AiInterviewReport[] | null>(null);
  const [report, setReport] = useState<AiInterviewReportDetail | null>(null);
  const [reportState, setReportState] = useState<"idle" | "waiting" | "timeout">("idle");
  const [selected, setSelected] = useState<AiInterviewReport | null>(null);

  // Real limits and the rules version come from the backend; refresh whenever we are back
  // on the briefing so "interviews left today" is current after each attempt.
  const loadConfig = useCallback((signal?: AbortSignal) => {
    setConfigError(null);
    aiInterviewService
      .getConfig(signal)
      .then(setConfig)
      .catch((err: unknown) => {
        if (signal?.aborted) return;
        setConfigError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load interview details. Check your connection.",
        );
      });
  }, []);
  const onBriefing = room.phase === "setup" && stage === "briefing";
  useEffect(() => {
    if (!onBriefing) return;
    const ctrl = new AbortController();
    loadConfig(ctrl.signal);
    return () => ctrl.abort();
  }, [onBriefing, loadConfig]);

  // A failed join drops back to setup with an error; surface it on the briefing screen.
  const { error: roomError } = room;
  useEffect(() => {
    if (roomError) setStage("briefing");
  }, [roomError]);

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
    setStage("briefing");
    room.reset();
  };

  const inRoom = room.phase === "connecting" || room.phase === "live";

  return (
    <div className="space-y-6">
      {!inRoom && (
        <div>
          <h1 className="font-display text-2xl font-semibold">AI Voice Interview</h1>
          <p className="text-sm text-muted-foreground">
            A structured technical interview with an AI interviewer, followed by a scored report.
            Requires a microphone.
          </p>
        </div>
      )}

      {/* Remote audio is attached here; it renders nothing visible. */}
      <div ref={room.audioHostRef} className="hidden" aria-hidden />

      {room.phase === "setup" && stage === "briefing" && (
        <InterviewBriefing
          domain={domain}
          onDomain={setDomain}
          onContinue={() => setStage("check")}
          error={room.error}
          config={config}
          configError={configError}
          onRetryConfig={() => loadConfig()}
        />
      )}

      {room.phase === "setup" && stage === "check" && domain && config && (
        <DeviceCheck
          domain={domain}
          onBack={() => setStage("briefing")}
          onJoin={(devices) => room.start(domain, config.consentVersion, devices)}
        />
      )}

      {room.phase === "connecting" && domain && <WaitingRoom domain={domain} />}

      {room.phase === "live" && domain && <MeetingRoom room={room} domain={domain} />}

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
