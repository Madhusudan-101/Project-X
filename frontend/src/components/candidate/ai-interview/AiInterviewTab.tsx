import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/services/api/client";
import { clearPendingInvite, readPendingInvite } from "@/lib/pendingInvite";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type {
  AiInterviewAssignment,
  AiInterviewConfig,
  AiInterviewDomain,
  AiInterviewReport,
  AiInterviewReportDetail,
} from "@/types/candidate/aiInterview";
import { AssignedInterviews } from "./AssignedInterviews";
import { DOMAINS } from "./domains";
import { DeviceCheck } from "./DeviceCheck";
import { InterviewBriefing } from "./InterviewBriefing";
import { detectBrowserSupport } from "./supportCheck";
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
  const [stage, setStage] = useState<"briefing" | "check" | "test">("briefing");
  const support = useMemo(() => detectBrowserSupport(), []);
  // Company interviews: the ones I have been sent, and the one I am about to take (if any).
  const [assignments, setAssignments] = useState<AiInterviewAssignment[]>([]);
  const [assignment, setAssignment] = useState<AiInterviewAssignment | null>(null);
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

  const loadAssignments = useCallback((signal?: AbortSignal) => {
    aiInterviewService
      .listAssignments(signal)
      .then(setAssignments)
      .catch(() => {
        /* the practice flow still works without them */
      });
  }, []);
  useEffect(() => {
    if (!onBriefing || assignment) return;
    const ctrl = new AbortController();
    loadAssignments(ctrl.signal);
    return () => ctrl.abort();
  }, [onBriefing, assignment, loadAssignments]);

  // The invitation email links here with ?ai_interview_invite=<id>: open that interview's briefing.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || assignments.length === 0) return;
    deepLinkDone.current = true;
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("ai_interview_invite") ?? readPendingInvite();
      if (!id) return;
      const match = assignments.find((a) => a.id === id && a.status === "invited");
      if (match) setAssignment(match);
      clearPendingInvite();
      url.searchParams.delete("ai_interview_invite");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* no URL to read (SSR or a sandbox) */
    }
  }, [assignments]);

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
  const live = room.phase === "live" || room.phase === "connecting" || room.phase === "interrupted";
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
    // A company interview's report belongs to the hiring team: there is nothing to wait for.
    if (phase !== "ended" || !roomName || assignment) return;
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
  }, [phase, roomName, assignment, loadHistory]);

  const startAgain = () => {
    setReport(null);
    setReportState("idle");
    setSelected(null);
    setStage("briefing");
    setAssignment(null);
    room.reset();
  };

  const inRoom = room.phase === "connecting" || room.phase === "live";

  return (
    <div className="space-y-6">
      {!inRoom && (
        <div>
          <h1 className="font-display text-2xl font-semibold">AI Voice Interview</h1>
          <p className="text-sm text-muted-foreground">
            Take interviews that companies send you, or practice on your own first. Needs a camera
            and microphone.
          </p>
        </div>
      )}

      {/* Remote audio is attached here; it renders nothing visible. */}
      <div ref={room.audioHostRef} className="hidden" aria-hidden />

      {room.phase === "setup" && stage === "briefing" && !assignment && (
        <AssignedInterviews assignments={assignments} onStart={setAssignment} />
      )}

      {room.phase === "setup" && stage === "briefing" && assignment && (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setAssignment(null)}>
          Back to all interviews
        </Button>
      )}

      {room.phase === "setup" && stage === "briefing" && (
        <InterviewBriefing
          assignment={assignment}
          domain={domain}
          onDomain={setDomain}
          onContinue={() => setStage("check")}
          error={room.error}
          config={config}
          configError={configError}
          onRetryConfig={() => loadConfig()}
          support={support}
          onTestSetup={() => setStage("test")}
          onRequestAccommodation={
            assignment
              ? async (message) => {
                  await aiInterviewService.requestAccommodation(assignment.id, message);
                  setAssignments((all) =>
                    all.map((a) =>
                      a.id === assignment.id ? { ...a, accommodation_requested: true } : a,
                    ),
                  );
                }
              : undefined
          }
        />
      )}

      {room.phase === "setup" && stage === "check" && (assignment || domain) && config && (
        <DeviceCheck
          domain={domain ?? undefined}
          roleTitle={assignment?.role_title}
          onBack={() => setStage("briefing")}
          onJoin={(devices) =>
            assignment
              ? room.startInvite(assignment.id, config.consentVersion, devices)
              : room.start(domain as AiInterviewDomain, config.consentVersion, devices)
          }
        />
      )}

      {room.phase === "setup" && stage === "test" && (
        <DeviceCheck testOnly onBack={() => setStage("briefing")} onJoin={() => undefined} />
      )}

      {room.phase === "connecting" && (assignment || domain) && (
        <WaitingRoom domain={domain ?? undefined} roleTitle={assignment?.role_title} />
      )}

      {room.phase === "live" && (assignment || domain) && (
        <MeetingRoom
          room={room}
          domain={domain ?? undefined}
          roleTitle={assignment?.role_title}
          company={assignment?.company_name}
        />
      )}

      {room.phase === "interrupted" && (
        <Card className="space-y-3 p-8 text-center" role="alert">
          <h2 className="font-display text-xl font-semibold">Connection lost</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Your interview is still open and the clock is still running. Rejoin to carry on where
            you left off, or end it now.
          </p>
          {room.error && <p className="text-sm text-destructive">{room.error}</p>}
          <div className="flex justify-center gap-3">
            <Button onClick={() => void room.rejoin()}>Rejoin interview</Button>
            <Button variant="outline" onClick={() => void room.end()}>
              End interview
            </Button>
          </div>
        </Card>
      )}

      {room.phase === "unavailable" && (
        <Card className="space-y-3 p-8 text-center" role="alert">
          <h2 className="font-display text-xl font-semibold">
            We couldn&apos;t start your interview
          </h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            The AI interviewer did not join, so nothing was recorded.{" "}
            {assignment
              ? "This attempt has not been used. Your invitation is still valid."
              : "This did not count towards your daily limit."}{" "}
            Please try again in a moment.
          </p>
          <Button onClick={startAgain}>Try again</Button>
        </Card>
      )}

      {room.phase === "ended" && assignment && (
        <div className="space-y-4">
          <Card className="space-y-2 p-8 text-center">
            <h2 className="font-display text-xl font-semibold">Interview submitted</h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Thank you. Your responses have been sent to {assignment.company_name}&apos;s hiring
              team for the {assignment.role_title} role. They will contact you about next steps. You
              will not see a report for this interview.
            </p>
          </Card>
          <Button variant="outline" onClick={startAgain}>
            Back to my interviews
          </Button>
        </div>
      )}

      {room.phase === "ended" && !assignment && (
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

      {room.phase === "setup" && !assignment && history && history.length > 0 && (
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
