import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { resumeTailorService } from "@/services/api/candidate/resumeTailor";
import type { TailorDecision, TailorHunk, TailorRun } from "@/types/jobs";

export const Route = createFileRoute("/resume-tailor/$applicationId")({
  head: () => ({ meta: [{ title: "Tailor resume — Mirracle" }] }),
  component: ResumeTailorPage,
});

function assembleFinalText(run: TailorRun, decisions: Record<string, TailorDecision>): string {
  const byIndex = new Map(run.hunks.map((h) => [h.hunkIndex, h]));
  const parts: string[] = [];
  for (const seg of run.segments) {
    if (seg.kind === "keep") {
      parts.push(seg.text);
      continue;
    }
    const h = byIndex.get(seg.i);
    if (!h) continue;
    const d = decisions[h.id] ?? h.decision;
    const chosen = d === "accepted" ? h.rewrittenBullet : h.originalBullet;
    if (chosen !== "") parts.push(chosen);
  }
  return parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function HunkDiff({ hunk }: { hunk: TailorHunk }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {hunk.wordDiff.map((t, i) => {
        if (t.op === "equal") return <span key={i}>{t.text}</span>;
        if (t.op === "insert")
          return (
            <span key={i} className="rounded bg-success/15 text-success">
              {t.text}
            </span>
          );
        return (
          <span key={i} className="rounded bg-destructive/10 text-destructive line-through">
            {t.text}
          </span>
        );
      })}
    </p>
  );
}

function ResumeTailorPage() {
  const { applicationId } = Route.useParams();
  const session = useCandidateGuard();
  const queryClient = useQueryClient();

  const {
    data: run,
    isLoading,
    isError,
    error,
  } = useQuery<TailorRun>({
    queryKey: ["tailor-run", applicationId],
    // Cheap by construction: the backend returns the existing run (with its
    // saved decisions) unless ?refresh=true, so a revisit costs no AI call.
    queryFn: () => resumeTailorService.start(applicationId),
    enabled: !!session,
    staleTime: Infinity,
    retry: false,
  });

  const [decisions, setDecisions] = useState<Record<string, TailorDecision>>({});
  const [applied, setApplied] = useState(false);

  // Reset local state whenever a new run object arrives (first load or after
  // an explicit regenerate). Seed each hunk from its stored decision, or
  // "accepted" for a brand-new run where everything is still "pending".
  useEffect(() => {
    if (!run) return;
    setDecisions(
      Object.fromEntries(
        run.hunks.map((h) => [
          h.id,
          (h.decision === "pending" ? "accepted" : h.decision) as TailorDecision,
        ]),
      ),
    );
    setApplied(false);
  }, [run]);

  const finalText = useMemo(() => (run ? assembleFinalText(run, decisions) : ""), [run, decisions]);

  const acceptedCount = run
    ? run.hunks.filter((h) => (decisions[h.id] ?? h.decision) === "accepted").length
    : 0;

  const applyMutation = useMutation({
    mutationFn: () =>
      resumeTailorService.applyDecisions(
        run!.runId,
        run!.hunks.map((h) => ({
          hunkId: h.id,
          decision: (decisions[h.id] ?? "rejected") === "accepted" ? "accepted" : "rejected",
        })),
      ),
    onSuccess: () => {
      setApplied(true);
      toast.success("Changes applied — you can download the PDF now.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not apply your changes."),
  });

  const pdfMutation = useMutation({
    mutationFn: () => resumeTailorService.renderPdf(run!.runId),
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not render the PDF."),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => resumeTailorService.start(applicationId, true),
    onSuccess: (fresh) => {
      // Swap the cached run — the useEffect above re-seeds decisions for it.
      queryClient.setQueryData(["tailor-run", applicationId], fresh);
      toast.success("Regenerated a fresh set of suggestions.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not regenerate."),
  });

  if (!session) return null;

  const setDecision = (id: string, d: TailorDecision) => {
    setDecisions((prev) => ({ ...prev, [id]: d }));
    setApplied(false);
  };

  const setAll = (d: TailorDecision) => {
    if (!run) return;
    setDecisions(Object.fromEntries(run.hunks.map((h) => [h.id, d])));
    setApplied(false);
  };

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-4 py-4 md:px-8">
          <Link
            to="/candidate"
            className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          {run && (
            <div className="flex items-start gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Apply changes
              </Button>
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  onClick={() => pdfMutation.mutate()}
                  disabled={!applied || pdfMutation.isPending}
                  className="bg-gradient-brand text-primary-foreground shadow-soft"
                >
                  {pdfMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download PDF
                </Button>
                {!applied && (
                  <p className="text-xs text-muted-foreground">Apply your changes first</p>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-72" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
            <p className="text-sm text-muted-foreground">
              Rewriting your resume for this role — this can take a few seconds…
            </p>
          </div>
        ) : isError || !run ? (
          <Card className="p-10 text-center">
            <p className="text-sm font-medium text-destructive">
              {error instanceof Error ? error.message : "Could not tailor your resume."}
            </p>
          </Card>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Tailor your resume</h1>

            {/* Status strip */}
            <div className="mb-6 mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3 text-sm">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{run.hunks.length}</span> suggested
                change{run.hunks.length === 1 ? "" : "s"}
                {" · "}
                <span className="font-medium text-foreground">{acceptedCount}</span> accepted
              </span>

              {run.hunks.length > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAll("accepted")}>
                    Accept all
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAll("rejected")}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reject all
                  </Button>
                </div>
              )}

              {/* Regenerate — separate, secondary, destructive-and-infrequent. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    disabled={regenerateMutation.isPending}
                  >
                    {regenerateMutation.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate suggestions?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This runs the rewrite again and produces a new set of suggestions. Every
                      accept/reject choice you&apos;ve made on the current set will be discarded.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => regenerateMutation.mutate()}>
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Suggested changes */}
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Suggested changes</h2>
                {run.hunks.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    No changes suggested — your resume already reads well for this role.
                  </Card>
                ) : (
                  run.hunks.map((h) => {
                    const d = decisions[h.id] ?? h.decision;
                    return (
                      <Card key={h.id} className="p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge variant="outline" className="text-xs uppercase">
                            {h.section ?? "Resume"}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={d === "accepted" ? "default" : "outline"}
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setDecision(h.id, "accepted")}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant={d === "rejected" ? "default" : "outline"}
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setDecision(h.id, "rejected")}
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        </div>
                        <HunkDiff hunk={h} />
                        <p
                          className={cn(
                            "mt-2 text-xs",
                            d === "accepted" ? "text-success" : "text-muted-foreground",
                          )}
                        >
                          {d === "accepted"
                            ? "Using the rewritten version"
                            : "Keeping your original"}
                        </p>
                      </Card>
                    );
                  })
                )}
              </div>

              {/* Live final preview */}
              <div className="lg:sticky lg:top-24 lg:self-start">
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-semibold">Final resume</h2>
                  <pre className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed">
                    {finalText}
                  </pre>
                </Card>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
