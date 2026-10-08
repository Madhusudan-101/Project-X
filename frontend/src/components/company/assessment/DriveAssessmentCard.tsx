import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ClipboardCheck, Loader2, Lock, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type { Assessment, AssessmentTemplate } from "@/types/company/assessment";
import type { JobDrive } from "@/types/jobs";
import { AssessmentBuilderDialog } from "./AssessmentBuilderDialog";
import { InvitesPanel } from "./InvitesPanel";
import { ResultsPanel } from "./ResultsPanel";

const TEMPLATES: { id: AssessmentTemplate; label: string; hint: string }[] = [
  {
    id: "coding",
    label: "Coding rounds",
    hint: "3 coding sections · 15 / 30 / 45 min · graded problems from the library",
  },
  {
    id: "analytics",
    label: "Data & analytics",
    hint: "SQL (stored for your review) + quant, data interpretation, aptitude (auto-graded)",
  },
  {
    id: "aptitude",
    label: "Aptitude",
    hint: "Quant, data interpretation, logical reasoning (auto-graded)",
  },
];

export function DriveAssessmentCard({ jobId, drive }: { jobId: string; drive: JobDrive }) {
  const qc = useQueryClient();
  const key = ["company-oa", jobId, drive.id];
  const { data, isLoading } = useQuery<Assessment | null>({
    queryKey: key,
    queryFn: () => companyAssessmentService.get(jobId, drive.id),
  });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fromTemplate = useMutation({
    mutationFn: (template: AssessmentTemplate) =>
      companyAssessmentService.save(jobId, drive.id, {
        title: `${TEMPLATES.find((t) => t.id === template)!.label} — Online Assessment`,
        inviteMode: "invited",
        template,
      }),
    onSuccess: () => {
      toast.success("Assessment created. Now invite your applicants.");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't create the assessment."),
  });

  const remove = useMutation({
    mutationFn: () => companyAssessmentService.remove(jobId, drive.id),
    onSuccess: () => {
      toast.success("Assessment deleted.");
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't delete."),
  });

  const noWindow = !drive.oaWindowStart || !drive.oaWindowEnd;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          Online assessment
        </h3>
        {data?.locked && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Lock className="h-3 w-3" /> Locked — candidates have started
          </Badge>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !data ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No assessment for this drive yet. Start from a template or build your own from the
            problem library.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                disabled={fromTemplate.isPending}
                onClick={() => fromTemplate.mutate(t.id)}
                className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {fromTemplate.isPending && fromTemplate.variables === t.id && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setBuilderOpen(true)}>
            Build a custom assessment
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="setup">
          <TabsList>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="invites">Invites ({data.stats.invited})</TabsTrigger>
            <TabsTrigger value="results">Results ({data.stats.submitted})</TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-3 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{data.title}</span>
              <Badge variant="outline" className="text-[10px]">
                {data.inviteMode === "invited"
                  ? "Invited applicants only"
                  : "All eligible applicants"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {data.totalDurationMinutes} min total
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.locked}
                  onClick={() => setBuilderOpen(true)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={data.locked}
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete assessment"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {noWindow && (
              <p className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This drive has no OA window set, so candidates can&apos;t start yet. Set the OA
                start and end on the drive.
              </p>
            )}
            {!data.codingEnabled &&
              data.sections.some((s) => s.questions.some((q) => q.problemId)) && (
                <p className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The code judge isn&apos;t configured on this server (OA_JUDGE_BACKEND), so
                  candidates can&apos;t Run or Submit library problems.
                </p>
              )}

            <ol className="space-y-2">
              {data.sections.map((s) => (
                <li key={s.position} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {s.position}. {s.title}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {s.kind === "mcq" ? "MCQ" : s.kind}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {s.questions.length} question{s.questions.length === 1 ? "" : "s"} ·{" "}
                      {s.durationMinutes} min
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    {s.questions.map((q) => (
                      <li key={q.position} className="flex justify-between gap-2">
                        <span className="truncate">{q.title}</span>
                        <span className="shrink-0 tabular-nums">{q.points} pts</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </TabsContent>

          <TabsContent value="invites" className="pt-3">
            <InvitesPanel jobId={jobId} driveId={drive.id} />
          </TabsContent>
          <TabsContent value="results" className="pt-3">
            <ResultsPanel jobId={jobId} driveId={drive.id} />
          </TabsContent>
        </Tabs>
      )}

      <AssessmentBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        jobId={jobId}
        driveId={drive.id}
        existing={data ?? null}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this assessment?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sections and invites are removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
