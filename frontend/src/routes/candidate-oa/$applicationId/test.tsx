import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, Circle, Loader2, ShieldAlert, Timer } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeEditor } from "@/components/candidate/oa/CodeEditor";
import { PromptText } from "@/components/candidate/oa/PromptText";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";
import type { OAQuestion, OASession } from "@/types/candidate/assessment";

export const Route = createFileRoute("/candidate-oa/$applicationId/test")({
  head: () => ({ meta: [{ title: "Assessment — Mirracle" }] }),
  component: AssessmentRunnerPage,
});

interface LocalAnswer {
  answer: string;
  language: string | null;
}

const SAVE_DEBOUNCE_MS = 700;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function defaultLanguage(q: OAQuestion): string | null {
  if (q.qtype !== "coding") return null;
  return q.language ?? Object.keys(q.starterCode ?? {})[0] ?? null;
}

function isAnswered(q: OAQuestion, a: LocalAnswer | undefined): boolean {
  if (!a || !a.answer.trim()) return false;
  if (q.qtype === "coding") {
    const starter = (a.language && q.starterCode?.[a.language]) || "";
    return a.answer.trim() !== starter.trim();
  }
  return true;
}

function AssessmentRunnerPage() {
  const { applicationId } = Route.useParams();
  const session = useCandidateGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sessionKey = useMemo(() => ["candidate-oa-session", applicationId], [applicationId]);
  const { data, isLoading, isError, error, refetch } = useQuery<OASession>({
    queryKey: sessionKey,
    queryFn: () => candidateAssessmentService.getSession(applicationId),
    enabled: !!session,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: true, // re-sync with the server clock after being away
  });

  const section = data?.section ?? null;
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);

  // Clock skew: server time at fetch vs this device's clock.
  const skewRef = useRef(0);
  useEffect(() => {
    if (data) skewRef.current = new Date(data.serverTime).getTime() - Date.now();
  }, [data]);

  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const lastExpirySync = useRef(0);

  // ── Reset local state whenever the server moves us to a new section ──
  const sectionKey = section ? `${section.position}` : null;
  useEffect(() => {
    if (!section) return;
    const init: Record<string, LocalAnswer> = {};
    for (const q of section.questions) {
      const lang = defaultLanguage(q);
      init[q.id] = {
        answer: q.answer ?? (lang ? (q.starterCode?.[lang] ?? "") : ""),
        language: lang,
      };
    }
    setAnswers(init);
    setActiveIdx(0);
    setSaveState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey]);

  // ── Countdown (rendered from the server deadline) ──
  useEffect(() => {
    if (!section) return;
    const deadline = new Date(section.deadline).getTime();
    const tick = () => {
      const left = deadline - (Date.now() + skewRef.current);
      setRemainingMs(left);
      // Time's up: ask the server to settle. Throttled in case our clock is
      // slightly ahead and the server still says there's time left.
      if (left <= 0 && Date.now() - lastExpirySync.current > 2500) {
        lastExpirySync.current = Date.now();
        refetch().then((r) => {
          if (r.data?.status === "submitted") {
            toast.info("Time's up — your assessment has been submitted.");
          } else if (r.data?.section && r.data.section.position !== section.position) {
            toast.info(`Time's up for ${section.title}. Moving to the next section.`);
          }
        });
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [section, refetch]);

  // ── Autosave ──
  const timers = useRef<Record<string, number>>({});
  const inFlight = useRef<Set<Promise<unknown>>>(new Set());

  const persist = useCallback(
    (questionId: string, a: LocalAnswer) => {
      setSaveState("saving");
      const p = candidateAssessmentService
        .saveAnswer(applicationId, { questionId, answer: a.answer, language: a.language })
        .then(() => setSaveState("saved"))
        .catch((e: unknown) => {
          setSaveState("error");
          // 409 = the section closed under us; re-sync instead of nagging.
          if (e instanceof Error && /time|ended/i.test(e.message)) refetch();
        })
        .finally(() => inFlight.current.delete(p));
      inFlight.current.add(p);
      return p;
    },
    [applicationId, refetch],
  );

  const update = (q: OAQuestion, next: LocalAnswer) => {
    setAnswers((prev) => ({ ...prev, [q.id]: next }));
    setSaveState("saving");
    window.clearTimeout(timers.current[q.id]);
    timers.current[q.id] = window.setTimeout(() => {
      delete timers.current[q.id];
      persist(q.id, next);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSaves = async (current: Record<string, LocalAnswer>) => {
    const pending = Object.keys(timers.current);
    for (const id of pending) {
      window.clearTimeout(timers.current[id]);
      delete timers.current[id];
      if (current[id]) persist(id, current[id]);
    }
    await Promise.allSettled([...inFlight.current]);
  };

  // Clear timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((id) => window.clearTimeout(id));
  }, []);

  // ── Submit section ──
  const submitMutation = useMutation({
    mutationFn: async () => {
      await flushSaves(answers);
      return candidateAssessmentService.submitSection(applicationId);
    },
    onSuccess: (next) => {
      setConfirmOpen(false);
      queryClient.setQueryData(sessionKey, next);
      queryClient.invalidateQueries({ queryKey: ["candidate-oa"] });
      if (next.status === "submitted") toast.success("Assessment submitted.");
    },
    onError: (e: unknown) => {
      setConfirmOpen(false);
      toast.error(e instanceof Error ? e.message : "Could not submit the section.");
      refetch();
    },
  });

  // ── Integrity: tab switches + accidental navigation ──
  const inProgress = data?.status === "in_progress";
  useEffect(() => {
    if (!inProgress) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      setTabSwitches((n) => n + 1);
      candidateAssessmentService.reportTabSwitch(applicationId).catch(() => undefined);
      toast.warning("You left the assessment tab. This has been recorded.");
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [inProgress, applicationId]);

  // Not started (or no longer ours) → back to the instructions page.
  useEffect(() => {
    if (isError) {
      toast.error(error instanceof Error ? error.message : "Could not load the assessment.");
      navigate({ to: "/candidate-oa/$applicationId", params: { applicationId }, replace: true });
    }
  }, [isError, error, navigate, applicationId]);

  if (!session) return null;

  if (isLoading || isError || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-8">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // ── Finished ──
  if (data.status === "submitted" || !section) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
        <Card className="max-w-md space-y-4 p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h1 className="font-display text-xl font-semibold">Assessment submitted</h1>
          <p className="text-sm text-muted-foreground">
            Your answers are recorded and can&apos;t be changed. The hiring team will review your
            attempt and update your application status.
          </p>
          <Button asChild className="bg-gradient-brand text-primary-foreground">
            <Link to="/candidate">Back to dashboard</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const q = section.questions[Math.min(activeIdx, section.questions.length - 1)];
  const a = answers[q.id];
  const isLast = section.position === section.totalSections;
  const answeredCount = section.questions.filter((x) => isAnswered(x, answers[x.id])).length;
  const lowTime = remainingMs !== null && remainingMs <= 5 * 60 * 1000;
  const critical = remainingMs !== null && remainingMs <= 60 * 1000;

  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Section {section.position} of {section.totalSections}
            </p>
            <h1 className="truncate font-display text-base font-semibold">{section.title}</h1>
          </div>

          <div className="hidden flex-1 items-center gap-1.5 md:flex" aria-hidden>
            {Array.from({ length: section.totalSections }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 flex-1 rounded-full " +
                  (i + 1 < section.position
                    ? "bg-success"
                    : i + 1 === section.position
                      ? "bg-primary"
                      : "bg-border")
                }
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-4">
            <SaveIndicator state={saveState} />
            <div
              role="timer"
              aria-label="Time remaining in this section"
              className={
                "flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-lg font-semibold tabular-nums " +
                (critical
                  ? "animate-pulse border-destructive/40 bg-destructive/10 text-destructive"
                  : lowTime
                    ? "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                    : "border-border bg-surface")
              }
            >
              <Timer className="h-4 w-4" />
              {remainingMs === null ? "--:--" : fmtClock(remainingMs)}
            </div>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={submitMutation.isPending}
              className="bg-gradient-brand text-primary-foreground shadow-soft"
            >
              {isLast ? "Submit assessment" : "Submit section"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 md:px-6">
        {/* Question navigator */}
        {section.questions.length > 1 && (
          <nav className="flex flex-wrap items-center gap-2" aria-label="Questions">
            {section.questions.map((x, i) => {
              const done = isAnswered(x, answers[x.id]);
              return (
                <button
                  key={x.id}
                  onClick={() => setActiveIdx(i)}
                  aria-current={i === activeIdx}
                  className={
                    "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors " +
                    (i === activeIdx
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-surface hover:bg-muted")
                  }
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground" />
                  )}
                  Q{i + 1}
                </button>
              );
            })}
            <span className="ml-1 text-xs text-muted-foreground">
              {answeredCount} of {section.questions.length} answered
            </span>
          </nav>
        )}

        {tabSwitches > 0 && (
          <p className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            {tabSwitches} tab switch{tabSwitches === 1 ? "" : "es"} recorded this session.
          </p>
        )}

        {q.qtype === "coding" ? (
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {q.points} points
              </p>
              <h2 className="mt-1 mb-4 font-display text-lg font-semibold">{q.title}</h2>
              <PromptText text={q.prompt} />
            </Card>
            <CodeEditor
              key={q.id}
              languages={Object.keys(q.starterCode ?? { python: "" })}
              language={a?.language ?? defaultLanguage(q) ?? "python"}
              value={a?.answer ?? ""}
              onChange={(code) => update(q, { answer: code, language: a?.language ?? null })}
              onLanguageChange={(lang) => {
                const oldStarter = (a?.language && q.starterCode?.[a.language]) || "";
                const untouched = !a?.answer.trim() || a.answer === oldStarter;
                update(q, {
                  language: lang,
                  answer: untouched ? (q.starterCode?.[lang] ?? "") : (a?.answer ?? ""),
                });
              }}
            />
          </div>
        ) : (
          <Card className="mx-auto w-full max-w-3xl space-y-5 p-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Question {activeIdx + 1} of {section.questions.length} · {q.points} points
              </p>
              <h2 className="mt-1 mb-3 font-display text-lg font-semibold">{q.title}</h2>
              <PromptText text={q.prompt} />
            </div>
            <RadioGroup
              value={a?.answer ?? ""}
              onValueChange={(v) => update(q, { answer: v, language: null })}
              className="space-y-2"
            >
              {(q.options ?? []).map((opt, i) => (
                <label
                  key={i}
                  htmlFor={`${q.id}-${i}`}
                  className={
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors " +
                    (a?.answer === String(i)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50")
                  }
                >
                  <RadioGroupItem id={`${q.id}-${i}`} value={String(i)} />
                  <span>{opt}</span>
                </label>
              ))}
            </RadioGroup>
            {a?.answer && (
              <button
                onClick={() => update(q, { answer: "", language: null })}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Clear selection
              </button>
            )}
          </Card>
        )}

        {section.questions.length > 1 && (
          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={activeIdx === 0}
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={activeIdx >= section.questions.length - 1}
              onClick={() => setActiveIdx((i) => Math.min(section.questions.length - 1, i + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </main>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !submitMutation.isPending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLast ? "Submit the assessment?" : `Submit ${section.title}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  You&apos;ve answered <b>{answeredCount}</b> of <b>{section.questions.length}</b>{" "}
                  question{section.questions.length === 1 ? "" : "s"} in this section.
                </p>
                <p>
                  {isLast
                    ? "This ends your assessment. You won't be able to change anything afterwards."
                    : "You will NOT be able to come back to this section, and any time you have left will NOT carry over to the next one."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitMutation.isPending}>Keep working</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                submitMutation.mutate();
              }}
            >
              {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLast ? "Submit assessment" : "Submit section"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return (
    <span
      className={
        "hidden items-center gap-1.5 text-xs sm:inline-flex " +
        (state === "error" ? "text-destructive" : "text-muted-foreground")
      }
      aria-live="polite"
    >
      {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
      {state === "saved" && <Check className="h-3 w-3 text-success" />}
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : "Couldn't save — retrying on next edit"}
    </span>
  );
}
