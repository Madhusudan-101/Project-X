import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { drivesService } from "@/services/api/company/drives";
import { jobsService } from "@/services/api/company/jobs";
import { ApplicantAnalysisPanel } from "./ApplicantAnalysisPanel";
import {
  ROUND_MODE_LABELS,
  ROUND_TYPE_LABELS,
  type DriveRound,
  type JobDrive,
  type RoundApplicant,
} from "@/types/jobs";

function fmt(iso: string | null): string {
  if (!iso) return "TBA";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "TBA"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const ROUND_STATUS_STYLES: Record<string, string> = {
  pending: "border-border text-muted-foreground",
  shortlisted: "border-success/40 bg-success/10 text-success",
  rejected: "border-destructive/30 bg-destructive/5 text-destructive",
};

export function DriveRoundsPanel({ jobId }: { jobId: string }) {
  const { data: drives, isLoading } = useQuery<JobDrive[]>({
    queryKey: ["company-jobs", jobId, "drives"],
    queryFn: () => drivesService.list(jobId),
  });

  const [activeDrive, setActiveDrive] = useState<string | null>(null);
  useEffect(() => {
    if (drives && drives.length > 0 && !activeDrive) setActiveDrive(drives[0].id);
  }, [drives, activeDrive]);

  if (isLoading) {
    return (
      <Card className="space-y-3 p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    );
  }

  if (!drives || drives.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground">
        No college drives yet. Drives are scheduled per college when you create the job.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Users className="h-5 w-5 text-primary" />
          Drives &amp; rounds
        </h2>
      </div>
      <Tabs value={activeDrive ?? undefined} onValueChange={setActiveDrive}>
        <TabsList className="m-4 flex flex-wrap">
          {drives.map((d) => (
            <TabsTrigger key={d.id} value={d.id} className="gap-1.5">
              {d.collegeName ?? "College"}
              <Badge variant="outline" className="text-[10px] capitalize">
                {d.status}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {drives.map((d) => (
          <TabsContent key={d.id} value={d.id} className="px-4 pb-4">
            <DrivePanel jobId={jobId} drive={d} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

function DrivePanel({ jobId, drive }: { jobId: string; drive: JobDrive }) {
  const rounds = drive.rounds;
  const [activeRound, setActiveRound] = useState<string | null>(rounds[0]?.id ?? null);
  useEffect(() => {
    if (rounds.length > 0 && !rounds.some((r) => r.id === activeRound))
      setActiveRound(rounds[0].id);
  }, [rounds, activeRound]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Apply by {fmt(drive.applyDeadline)}
        {drive.oaWindowStart &&
          ` · OA ${fmt(drive.oaWindowStart)} → ${fmt(drive.oaWindowEnd)}`} · {drive.applicantCount}{" "}
        applicant{drive.applicantCount === 1 ? "" : "s"}
      </p>

      {rounds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
          This drive has no rounds configured yet.
        </p>
      ) : (
        <Tabs value={activeRound ?? undefined} onValueChange={setActiveRound}>
          <TabsList className="flex flex-wrap">
            {rounds.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="gap-1.5 text-xs">
                R{r.roundNumber} · {ROUND_TYPE_LABELS[r.roundType]}
                <Badge variant="outline" className="text-[9px] uppercase">
                  {ROUND_MODE_LABELS[r.mode]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {rounds.map((r, i) => (
            <TabsContent key={r.id} value={r.id} className="pt-3">
              <RoundApplicants
                jobId={jobId}
                driveId={drive.id}
                round={r}
                isLastRound={i === rounds.length - 1}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function RoundApplicants({
  jobId,
  driveId,
  round,
  isLastRound,
}: {
  jobId: string;
  driveId: string;
  round: DriveRound;
  isLastRound: boolean;
}) {
  const queryClient = useQueryClient();
  const isAi = round.mode === "ai";
  const sortBy = isAi ? "round_score" : "applied_at";
  const [openApplicant, setOpenApplicant] = useState<RoundApplicant | null>(null);

  const hireMutation = useMutation({
    mutationFn: (applicationId: string) =>
      jobsService.updateApplicantStatus(jobId, applicationId, "hired"),
    onSuccess: () => {
      toast.success("Candidate marked as hired.");
      queryClient.invalidateQueries({ queryKey: ["company-dashboard-funnel"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const { data: rows, isLoading } = useQuery<RoundApplicant[]>({
    queryKey: ["company-jobs", jobId, "drives", driveId, "rounds", round.id, "applicants", sortBy],
    queryFn: () => drivesService.listRoundApplicants(jobId, driveId, round.id, sortBy),
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ["company-jobs", jobId, "analysis", openApplicant?.applicationId],
    queryFn: () => jobsService.getApplicantAnalysis(jobId, openApplicant!.applicationId),
    enabled: !!openApplicant && !!openApplicant.hasAnalysis,
    retry: false,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      applicationId,
      status,
    }: {
      applicationId: string;
      status: "shortlisted" | "rejected";
    }) => drivesService.setRoundStatus(jobId, driveId, round.id, applicationId, status),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.status === "shortlisted" ? "Shortlisted for the next round." : "Rejected.",
      );
      queryClient.invalidateQueries({
        queryKey: ["company-jobs", jobId, "drives", driveId, "rounds"],
      });
      queryClient.invalidateQueries({ queryKey: ["company-dashboard-funnel"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const sorted = useMemo(() => rows ?? [], [rows]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {sorted.length} candidate{sorted.length === 1 ? "" : "s"} in this round
        </span>
        <span>
          {isAi ? "Ranked by AI round score" : "Live round — rank manually (ordered by apply time)"}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
          No candidates have reached this round yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead className="text-right">{isAi ? "Round score" : "Applied"}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Placement %</TableHead>
              <TableHead>Round status</TableHead>
              <TableHead className="text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((a) => (
              <TableRow key={a.applicationId}>
                <TableCell>
                  <button
                    className="text-left font-medium hover:underline disabled:no-underline"
                    disabled={!a.hasAnalysis}
                    onClick={() => setOpenApplicant(a)}
                  >
                    {a.studentName ?? "Candidate"}
                  </button>
                  <div className="text-xs text-muted-foreground">{a.studentEmail}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {isAi
                    ? a.roundScore != null
                      ? a.roundScore.toFixed(1)
                      : "—"
                    : new Date(a.appliedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {a.placementProbability != null ? `${Math.round(a.placementProbability)}%` : "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("capitalize", ROUND_STATUS_STYLES[a.roundStatus])}
                  >
                    {a.roundStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={statusMutation.isPending || a.roundStatus === "shortlisted"}
                      onClick={() =>
                        statusMutation.mutate({
                          applicationId: a.applicationId,
                          status: "shortlisted",
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Shortlist
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                      disabled={statusMutation.isPending || a.roundStatus === "rejected"}
                      onClick={() =>
                        statusMutation.mutate({
                          applicationId: a.applicationId,
                          status: "rejected",
                        })
                      }
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                    {isLastRound && a.roundStatus === "shortlisted" && (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={hireMutation.isPending}
                        onClick={() => hireMutation.mutate(a.applicationId)}
                      >
                        Mark hired
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={!!openApplicant} onOpenChange={(o) => !o && setOpenApplicant(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {openApplicant?.studentName ?? "Candidate"} — job-scoped analysis
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {analysisLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : analysis ? (
              <ApplicantAnalysisPanel analysis={analysis} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Scoring is not complete for this candidate yet.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
