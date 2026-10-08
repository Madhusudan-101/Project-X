import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type { Results } from "@/types/company/assessment";
import { CandidateResultSheet } from "./CandidateResultSheet";
import { fmtDuration } from "./format";

type SortKey = "score" | "time";

export function ResultsPanel({ jobId, driveId }: { jobId: string; driveId: string }) {
  const { data, isLoading } = useQuery<Results>({
    queryKey: ["company-oa", jobId, driveId, "results"],
    queryFn: () => companyAssessmentService.results(jobId, driveId),
    refetchInterval: 30_000,
  });
  const [filter, setFilter] = useState<
    "all" | "submitted" | "in_progress" | "not_started" | "flagged"
  >("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) =>
      filter === "all" ? true : filter === "flagged" ? r.flagged : r.state === filter,
    );
    return [...list].sort((a, b) =>
      sort === "score"
        ? (b.percent ?? -1) - (a.percent ?? -1)
        : (a.timeTakenSeconds ?? Infinity) - (b.timeTakenSeconds ?? Infinity),
    );
  }, [data, filter, sort]);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data || data.rows.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
        No one has been invited yet. Invite applicants from the Invites tab.
      </p>
    );

  const tile = (label: string, value: string | number) => (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tile("Invited", data.stats.invited)}
        {tile("Started", data.stats.started)}
        {tile("Submitted", data.stats.submitted)}
        {tile(
          "Average score",
          data.stats.averagePercent == null ? "—" : `${data.stats.averagePercent}%`,
        )}
        {tile("Flagged", data.stats.flagged)}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ["all", "All"],
            ["submitted", "Submitted"],
            ["in_progress", "In progress"],
            ["not_started", "Not started"],
            ["flagged", "Flagged"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={
              "rounded-md border px-2.5 py-1 " +
              (filter === k
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted")
            }
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">Sort by</span>
        {(["score", "time"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={
              "rounded-md border px-2.5 py-1 " +
              (sort === k
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted")
            }
          >
            {k === "score" ? "Score" : "Fastest"}
          </button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Time taken</TableHead>
            <TableHead className="text-right">Integrity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.applicationId}
              onClick={() => r.state !== "not_started" && setOpen(r.applicationId)}
              className={r.state !== "not_started" ? "cursor-pointer" : "opacity-70"}
            >
              <TableCell>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.email}</div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    r.state === "submitted"
                      ? "border-success/40 bg-success/10 text-success"
                      : r.state === "in_progress"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : ""
                  }
                >
                  {r.state === "submitted"
                    ? "Submitted"
                    : r.state === "in_progress"
                      ? "In progress"
                      : "Not started"}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.percent == null ? "—" : `${r.percent}% (${r.score}/${r.maxScore})`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtDuration(r.timeTakenSeconds)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {r.state === "not_started" ? (
                  "—"
                ) : (
                  <span
                    className={
                      r.flagged
                        ? "inline-flex items-center gap-1 text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {r.flagged && <AlertTriangle className="h-3.5 w-3.5" />}
                    {r.tabSwitches} tab · {r.fullscreenExits} fs · {r.pasteEvents} paste
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] text-muted-foreground">
        Flagged = more than 3 tab switches. Integrity signals are hints for review, not proof.
        Shortlisting stays your call — nothing here moves a candidate automatically.
      </p>

      <CandidateResultSheet
        jobId={jobId}
        driveId={driveId}
        applicationId={open}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
