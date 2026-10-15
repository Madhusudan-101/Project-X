import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";
import type { OAOverview } from "@/types/candidate/assessment";

export const Route = createFileRoute("/candidate-oa/$applicationId/")({
  head: () => ({ meta: [{ title: "Online Assessment — Mirracle" }] }),
  component: AssessmentInstructionsPage,
});

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

const SECTION_KIND_LABEL = { coding: "Coding", sql: "SQL", mcq: "Multiple choice" } as const;

function AssessmentInstructionsPage() {
  const { applicationId } = Route.useParams();
  const session = useCandidateGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);

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
    mutationFn: () => candidateAssessmentService.start(applicationId),
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

  const windowStart = oa?.windowStart ? new Date(oa.windowStart).getTime() : null;
  const windowEnd = oa?.windowEnd ? new Date(oa.windowEnd).getTime() : null;
  // The server decides; the client only flips `upcoming` → `open` locally so
  // the button enables the second the window opens without a refetch.
  const state =
    oa?.state === "upcoming" && windowStart !== null && serverNow >= windowStart
      ? "open"
      : oa?.state;
  const canStart = state === "open" && agreed;
  const sectionCount = oa?.sections.length ?? 0;
  const hasCoding = oa?.sections.some((x) => x.kind !== "mcq") ?? false;

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 md:px-8">
          <Link
            to="/candidate"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-80" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : isError || !oa ? (
          <Card className="p-10 text-center">
            <p className="text-sm font-medium text-destructive">
              {error instanceof Error ? error.message : "Assessment not available."}
            </p>
            <Link
              to="/candidate"
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Back to your dashboard
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <Badge variant="secondary" className="text-xs">
                Online assessment
              </Badge>
              <h1 className="mt-2 font-display text-2xl font-bold md:text-3xl">
                {oa.assessmentTitle}
              </h1>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4" /> {oa.companyName} · {oa.jobTitle}
              </p>
            </div>

            {/* Window / status banner */}
            <StatusBanner
              state={state ?? oa.state}
              windowStart={oa.windowStart}
              windowEnd={oa.windowEnd}
              msToOpen={windowStart !== null ? windowStart - serverNow : null}
              msToClose={windowEnd !== null ? windowEnd - serverNow : null}
            />

            {state === "submitted" ? (
              <Card className="p-6">
                <h2 className="font-display text-lg font-semibold">What happens next</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your answers have been recorded and can&apos;t be changed. {oa.companyName} will
                  review your assessment and shortlist candidates for the next round. Track your
                  status on the Jobs tab of your dashboard.
                </p>
              </Card>
            ) : (
              <>
                {/* Instructions */}
                <Card className="p-6">
                  <h2 className="font-display text-lg font-semibold">Before you begin</h2>
                  <ul className="mt-3 space-y-2.5 text-sm">
                    <Rule>
                      This test contains <b>{sectionCount}</b> section
                      {sectionCount === 1 ? "" : "s"} and <b>{oa.totalQuestions}</b> question
                      {oa.totalQuestions === 1 ? "" : "s"} —{" "}
                      <b>{oa.totalDurationMinutes} minutes</b> in total.
                    </Rule>
                    <Rule>Each section has its own allotted time.</Rule>
                    <Rule>
                      Once you&apos;ve moved past a section you will <b>NOT</b> be able to revisit
                      it.
                    </Rule>
                    <Rule>
                      When you close a section, any remaining time will <b>NOT</b> roll over to the
                      next one.
                    </Rule>
                    <Rule>
                      The clock is controlled by our server. Refreshing the page, losing connection
                      or closing the tab will <b>not</b> pause it — when time runs out the section
                      is closed automatically with whatever you&apos;ve saved.
                    </Rule>
                    <Rule>
                      Answers are saved automatically as you work. You can change an answer any time
                      before its section closes.
                    </Rule>
                    <Rule>
                      For coding questions, pick a language in the editor. <b>Run</b> tests your
                      code on the examples (and your own input); <b>Submit</b> grades it against all
                      tests, including hidden ones. <b>Only submitted solutions are scored</b>, and
                      your best submission counts.
                    </Rule>
                    {hasCoding && !oa.codingEnabled && (
                      <Rule>
                        <span className="text-amber-700 dark:text-amber-400">
                          Code execution isn&apos;t switched on for this assessment right now, so
                          Run and Submit will be unavailable. Contact the recruiter before you
                          start.
                        </span>
                      </Rule>
                    )}
                  </ul>
                </Card>

                {/* Test format */}
                <div>
                  <h2 className="mb-3 font-display text-lg font-semibold">Test format</h2>
                  <Card className="overflow-hidden p-0">
                    <div className="border-b border-border px-5 py-3 text-sm font-semibold">
                      Section details
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="w-16 px-5 py-3 font-medium">No.</th>
                            <th className="px-5 py-3 font-medium">Section</th>
                            <th className="px-5 py-3 font-medium">Type</th>
                            <th className="px-5 py-3 text-right font-medium">Questions</th>
                            <th className="px-5 py-3 text-right font-medium">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {oa.sections.map((s) => (
                            <tr
                              key={s.position}
                              className={
                                "border-t border-border " +
                                (oa.attempt?.status === "in_progress" &&
                                oa.attempt.currentSection === s.position
                                  ? "bg-primary/5"
                                  : "")
                              }
                            >
                              <td className="px-5 py-3.5 tabular-nums">{s.position}</td>
                              <td className="px-5 py-3.5 font-medium">{s.title}</td>
                              <td className="px-5 py-3.5 text-muted-foreground">
                                {SECTION_KIND_LABEL[s.kind]}
                              </td>
                              <td className="px-5 py-3.5 text-right tabular-nums">
                                {s.questionCount}
                              </td>
                              <td className="px-5 py-3.5 text-right tabular-nums">
                                {s.durationMinutes} minutes
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border bg-muted/30 font-medium">
                            <td className="px-5 py-3" colSpan={3}>
                              Total
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {oa.totalQuestions}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {oa.totalDurationMinutes} minutes
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Card>
                </div>

                {/* Guidelines */}
                <Card className="p-6">
                  <h2 className="font-display text-lg font-semibold">Guidelines &amp; integrity</h2>
                  <ul className="mt-3 space-y-2.5 text-sm">
                    <Rule>Use a laptop or desktop with a stable internet connection.</Rule>
                    <Rule>
                      Attempt the test on your own. Don&apos;t take help from other people, and
                      don&apos;t use AI assistants or copy solutions from the internet.
                    </Rule>
                    <Rule>
                      Stay on this tab. Switching tabs or windows is detected and reported to{" "}
                      {oa.companyName} with your submission.
                    </Rule>
                    <Rule>
                      Close messaging apps and notifications, and keep your charger connected.
                    </Rule>
                    <Rule>
                      Start before the window closes
                      {oa.windowEnd ? ` (${fmtDateTime(oa.windowEnd)})` : ""}. Once you begin, your
                      sections run to their full length even if the window ends.
                    </Rule>
                    <Rule>
                      Pasting, leaving fullscreen and switching tabs are logged and shown to the
                      recruiter. You can attempt the assessment only once.
                    </Rule>
                  </ul>
                </Card>

                {/* Start */}
                <Card className="p-6">
                  {state === "in_progress" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">You have an attempt in progress.</p>
                        <p className="text-xs text-muted-foreground">
                          Your timer kept running while you were away.
                        </p>
                      </div>
                      <Button
                        onClick={() =>
                          navigate({
                            to: "/candidate-oa/$applicationId/test",
                            params: { applicationId },
                          })
                        }
                        className="bg-gradient-brand text-primary-foreground shadow-soft"
                      >
                        Resume assessment
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <label className="flex cursor-pointer items-start gap-3 text-sm">
                        <Checkbox
                          checked={agreed}
                          onCheckedChange={(v) => setAgreed(v === true)}
                          className="mt-0.5"
                        />
                        <span>
                          I have read the instructions and guidelines above, and I agree to complete
                          this assessment on my own, honestly and without outside help.
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          disabled={!canStart || startMutation.isPending}
                          onClick={() => startMutation.mutate()}
                          className="bg-gradient-brand text-primary-foreground shadow-soft"
                        >
                          {startMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Start assessment
                        </Button>
                        {state !== "open" && (
                          <p className="text-xs text-muted-foreground">
                            {state === "upcoming"
                              ? "You can start once the window opens."
                              : state === "closed"
                                ? "The window for this assessment has closed."
                                : "The assessment window hasn't been announced yet."}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function StatusBanner({
  state,
  windowStart,
  windowEnd,
  msToOpen,
  msToClose,
}: {
  state: string;
  windowStart: string | null;
  windowEnd: string | null;
  msToOpen: number | null;
  msToClose: number | null;
}) {
  const window = (
    <p className="text-xs text-muted-foreground">
      Window: {fmtDateTime(windowStart)} → {fmtDateTime(windowEnd)}
    </p>
  );

  if (state === "submitted") {
    return (
      <Card className="flex items-center gap-3 border-success/30 bg-success/5 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium">Assessment submitted</p>
          <p className="text-xs text-muted-foreground">You can&apos;t attempt it again.</p>
        </div>
      </Card>
    );
  }
  if (state === "in_progress") {
    return (
      <Card className="flex items-center gap-3 border-primary/30 bg-primary/5 p-4">
        <Timer className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">Attempt in progress</p>
          {window}
        </div>
      </Card>
    );
  }
  if (state === "open") {
    return (
      <Card className="flex items-center gap-3 border-success/30 bg-success/5 p-4">
        <Clock className="h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium">
            The assessment is open
            {msToClose !== null && msToClose > 0 ? ` — closes in ${fmtCountdown(msToClose)}` : ""}
          </p>
          {window}
        </div>
      </Card>
    );
  }
  if (state === "upcoming") {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">
            Opens in {msToOpen !== null ? fmtCountdown(msToOpen) : "—"}
          </p>
          {window}
        </div>
      </Card>
    );
  }
  if (state === "closed") {
    return (
      <Card className="flex items-center gap-3 border-destructive/30 bg-destructive/5 p-4">
        <Lock className="h-5 w-5 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium text-destructive">The assessment window has closed</p>
          {window}
          <p className="mt-1 text-xs text-muted-foreground">
            Contact your placement cell or the recruiter if you think this is a mistake.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="flex items-center gap-3 border-amber-300/40 bg-amber-50/60 p-4 dark:bg-amber-950/20">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
      <div>
        <p className="text-sm font-medium">Assessment dates to be announced</p>
        <p className="text-xs text-muted-foreground">
          The company hasn&apos;t scheduled the assessment window yet. You&apos;ll be able to start
          here once it opens.
        </p>
      </div>
    </Card>
  );
}
