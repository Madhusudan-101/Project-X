import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Clock, Loader2, Lock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DetailsStep } from "@/components/candidate/oa/start/DetailsStep";
import { detailsValid } from "@/components/candidate/oa/start/details";
import { InstructionsStep } from "@/components/candidate/oa/start/InstructionsStep";
import { PermissionsStep } from "@/components/candidate/oa/start/PermissionsStep";
import {
  initialPermissions,
  permissionsReady,
  type PermissionState,
} from "@/components/candidate/oa/start/permissions";
import { StartShell } from "@/components/candidate/oa/start/StartShell";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";
import type { OADetailsForm, OAOverview, OAPrecheck } from "@/types/candidate/assessment";

export const Route = createFileRoute("/candidate-oa/$applicationId/")({
  head: () => ({ meta: [{ title: "Online Assessment — Mirracle" }] }),
  component: AssessmentStartPage,
});

const STEPS = 3;

/** Enter browser fullscreen (hides tabs, address bar and, on most systems, the taskbar).
 *  Must be called straight from a click: browsers refuse it otherwise. Fullscreen survives the
 *  in-app navigation to the test page. A refusal is fine: the test page offers a button too. */
function goFullscreen() {
  if (typeof document === "undefined" || !document.fullscreenEnabled || document.fullscreenElement)
    return;
  document.documentElement.requestFullscreen().catch(() => undefined);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const emptyDetails: OADetailsForm = {
  fullName: "",
  email: "",
  phone: "",
  college: "",
  rollNumber: "",
  branch: "",
  graduationYear: "",
  cgpa: "",
};

function AssessmentStartPage() {
  const { applicationId } = Route.useParams();
  const session = useCandidateGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<OADetailsForm>(emptyDetails);
  const [pledge, setPledge] = useState(false);
  const [recording, setRecording] = useState(false);
  const [perms, setPerms] = useState<PermissionState>(initialPermissions);

  const {
    data: oa,
    isLoading,
    isError,
    error,
  } = useQuery<OAOverview>({
    queryKey: ["candidate-oa", applicationId],
    queryFn: () => candidateAssessmentService.getOverview(applicationId),
    enabled: !!session,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // Prefill the details form once, from what the profile already knows.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!oa || prefilled.current) return;
    prefilled.current = true;
    setDetails({
      ...emptyDetails,
      ...oa.prefill,
      fullName: oa.prefill.fullName || session?.user.name || "",
      email: oa.prefill.email || session?.user.email || "",
    });
  }, [oa, session]);

  // Skew between this device's clock and the server's, so the "opens in"
  // countdown agrees with what the server will actually enforce.
  const skew = oa ? new Date(oa.serverTime).getTime() - Date.now() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const serverNow = now + skew;

  const startMutation = useMutation({
    mutationFn: () => {
      const precheck: OAPrecheck = {
        webcam:
          oa!.webcamMode === "off"
            ? "not_required"
            : perms.webcam === "granted" || perms.webcam === "denied"
              ? perms.webcam
              : "skipped",
        monitors: oa!.monitorMode === "off" ? null : perms.monitors,
        fullscreen: perms.fullscreen,
        browser: navigator.userAgent.slice(0, 300),
        screen: `${window.screen.width}x${window.screen.height}`,
      };
      return candidateAssessmentService.start(applicationId, {
        webcamConsent: perms.webcam === "granted",
        agreed: pledge && recording,
        details,
        precheck,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-oa"] });
      navigate({ to: "/candidate-oa/$applicationId/test", params: { applicationId } });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not start the assessment.");
      queryClient.invalidateQueries({ queryKey: ["candidate-oa", applicationId] });
    },
  });

  if (!session) return null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-10">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !oa) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-md rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-destructive">
            {error instanceof Error ? error.message : "Assessment not available."}
          </p>
          <Link to="/candidate" className="mt-3 inline-block text-sm text-primary hover:underline">
            Back to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  const windowStart = oa.windowStart ? new Date(oa.windowStart).getTime() : null;
  const windowEnd = oa.windowEnd ? new Date(oa.windowEnd).getTime() : null;
  // The server decides; the client only flips `upcoming` → `open` locally so
  // the wizard appears the second the window opens without a refetch.
  const state =
    oa.state === "upcoming" && windowStart !== null && serverNow >= windowStart ? "open" : oa.state;

  const facts = (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 font-medium">
        <Clock className="h-4 w-4 text-muted-foreground" /> Test duration: {oa.totalDurationMinutes}{" "}
        minutes
      </p>
      <p className="text-muted-foreground">
        {oa.windowEnd
          ? `You may start any time between ${fmtDateTime(oa.windowStart)} and ${fmtDateTime(oa.windowEnd)}. Once started, every section runs to its full length.`
          : "The assessment window has not been announced yet."}
      </p>
    </div>
  );
  const shell = {
    title: oa.assessmentTitle,
    subtitle: `${oa.companyName} · ${oa.jobTitle}`,
    facts,
  };

  // ── Not in "open": say where things stand instead of showing the wizard ──
  if (state !== "open") {
    return (
      <StartShell {...shell}>
        <StatusPanel
          state={state}
          oa={oa}
          msToOpen={windowStart !== null ? windowStart - serverNow : null}
          msToClose={windowEnd !== null ? windowEnd - serverNow : null}
          onResume={() => {
            goFullscreen();
            navigate({ to: "/candidate-oa/$applicationId/test", params: { applicationId } });
          }}
        />
      </StartShell>
    );
  }

  const detailsOk = detailsValid(details) && pledge && recording;
  const ready = permissionsReady(oa.webcamMode, oa.monitorMode, perms);

  const actions =
    step === 0 ? (
      <Button onClick={() => setStep(1)} className="bg-gradient-brand px-8 text-primary-foreground">
        Continue
      </Button>
    ) : step === 1 ? (
      <>
        <Button variant="outline" onClick={() => setStep(0)}>
          Back
        </Button>
        <Button
          onClick={() => setStep(2)}
          disabled={!detailsOk}
          className="bg-gradient-brand px-8 text-primary-foreground"
        >
          Continue
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" onClick={() => setStep(1)} disabled={startMutation.isPending}>
          Back
        </Button>
        <Button
          onClick={() => {
            goFullscreen(); // the click is the gesture the browser needs
            startMutation.mutate();
          }}
          disabled={!ready || startMutation.isPending}
          className="bg-gradient-brand px-8 text-primary-foreground"
        >
          {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Start test
        </Button>
      </>
    );

  return (
    <StartShell {...shell} step={step} steps={STEPS} actions={actions}>
      {step === 0 && <InstructionsStep oa={oa} />}
      {step === 1 && (
        <DetailsStep
          value={details}
          onChange={setDetails}
          pledge={pledge}
          onPledge={setPledge}
          recording={recording}
          onRecording={setRecording}
          companyName={oa.companyName}
        />
      )}
      {step === 2 && (
        <PermissionsStep
          webcamMode={oa.webcamMode}
          monitorMode={oa.monitorMode}
          snapshotIntervalSeconds={oa.snapshotIntervalSeconds}
          retentionDays={oa.snapshotRetentionDays}
          value={perms}
          onChange={(patch) => setPerms((p) => ({ ...p, ...patch }))}
        />
      )}
    </StartShell>
  );
}

function StatusPanel({
  state,
  oa,
  msToOpen,
  msToClose,
  onResume,
}: {
  state: string;
  oa: OAOverview;
  msToOpen: number | null;
  msToClose: number | null;
  onResume: () => void;
}) {
  const win = (
    <p className="text-sm text-muted-foreground">
      Window: {fmtDateTime(oa.windowStart)} → {fmtDateTime(oa.windowEnd)}
    </p>
  );
  void msToClose;

  if (state === "in_progress") {
    return (
      <Panel
        icon={<Timer className="h-10 w-10 text-primary" />}
        title="You have an attempt in progress"
      >
        <p className="text-sm text-muted-foreground">
          Your timer kept running while you were away.
        </p>
        {win}
        <Button onClick={onResume} className="bg-gradient-brand px-8 text-primary-foreground">
          Resume assessment
        </Button>
      </Panel>
    );
  }
  if (state === "submitted") {
    return (
      <Panel
        icon={<CheckCircle2 className="h-10 w-10 text-success" />}
        title="Assessment submitted"
      >
        <p className="text-sm text-muted-foreground">
          Your answers have been recorded and can&apos;t be changed. {oa.companyName} will review
          your assessment and shortlist candidates for the next round. Track your status on the Jobs
          tab of your dashboard.
        </p>
        <Button asChild variant="outline">
          <Link to="/candidate">Back to dashboard</Link>
        </Button>
      </Panel>
    );
  }
  if (state === "upcoming") {
    return (
      <Panel
        icon={<CalendarClock className="h-10 w-10 text-primary" />}
        title={`Opens in ${msToOpen !== null ? fmtCountdown(msToOpen) : "—"}`}
      >
        <p className="text-sm text-muted-foreground">
          Come back when the window opens. This page starts the test for you.
        </p>
        {win}
      </Panel>
    );
  }
  if (state === "closed") {
    return (
      <Panel
        icon={<Lock className="h-10 w-10 text-destructive" />}
        title="The assessment window has closed"
      >
        {win}
        <p className="text-sm text-muted-foreground">
          Contact your placement cell or the recruiter if you think this is a mistake.
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      icon={<CalendarClock className="h-10 w-10 text-muted-foreground" />}
      title="Not scheduled yet"
    >
      <p className="text-sm text-muted-foreground">
        The company hasn&apos;t scheduled the assessment window yet. You&apos;ll be able to start as
        soon as they do.
      </p>
    </Panel>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-4">
      {icon}
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}
