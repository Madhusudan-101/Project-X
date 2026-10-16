import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import type { ResultsPayload } from "@/types/company/aiInterview";
import { CandidateReportSheet } from "./CandidateReportSheet";
import {
  DECISION_LABEL,
  INVITE_STATUS_LABEL,
  filterRows,
  resultsToCsv,
  sortRows,
  type ResultFilter,
  type ResultSort,
} from "./rubric";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ResultsPanel({ templateId }: { templateId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<ResultSort>("recent");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const { data, isLoading } = useQuery<ResultsPayload>({
    queryKey: ["company-ai-interviews", templateId, "results"],
    queryFn: () => companyAiInterviewService.results(templateId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const all = data?.rows ?? [];
  const rows = sortRows(filterRows(all, filter), sort);
  const s = data?.summary;

  const exportCsv = () => {
    const blob = new Blob([resultsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "interview-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Took the interview" value={String(s?.taken ?? 0)} />
        <Tile label="Reports ready" value={String(s?.reported ?? 0)} />
        <Tile
          label="Average score"
          value={s?.average_score == null ? "—" : String(Math.round(s.average_score))}
        />
        <Tile label="With integrity flags" value={String(s?.flagged ?? 0)} />
      </div>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Sort
            <select
              aria-label="Sort results"
              className="h-9 rounded-md border bg-card px-2"
              value={sort}
              onChange={(e) => setSort(e.target.value as ResultSort)}
            >
              <option value="recent">Most recent</option>
              <option value="score">Highest score</option>
              <option value="flags">Most flags</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Show
            <select
              aria-label="Filter results"
              className="h-9 rounded-md border bg-card px-2"
              value={filter}
              onChange={(e) => setFilter(e.target.value as ResultFilter)}
            >
              <option value="all">Everyone</option>
              <option value="flagged">With integrity flags</option>
              <option value="undecided">No decision yet</option>
              <option value="incomplete">No report (incomplete)</option>
            </select>
          </label>
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      )}

      {all.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No one has taken this interview yet. Results appear here as candidates finish.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No one matches this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>AI recommends</TableHead>
                <TableHead>Integrity</TableHead>
                <TableHead>Your decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-2 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(r.id);
                      }}
                    >
                      {r.name ?? r.email}
                    </button>
                    {r.name && <div className="text-xs text-muted-foreground">{r.email}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "completed" ? "default" : "secondary"}>
                      {INVITE_STATUS_LABEL[r.status]}
                    </Badge>
                    {r.incomplete && (
                      <Badge variant="outline" className="ml-1.5">
                        No report
                      </Badge>
                    )}
                    {r.partial && (
                      <Badge variant="outline" className="ml-1.5">
                        Left early
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {r.overall_score === null ? "—" : Math.round(r.overall_score)}
                  </TableCell>
                  <TableCell className="text-sm">{r.recommendation ?? "—"}</TableCell>
                  <TableCell>
                    {r.integrity.total > 0 ? (
                      <span className="inline-flex items-center gap-1 text-sm text-destructive">
                        <ShieldAlert className="h-4 w-4" aria-hidden />
                        {r.integrity.total} flag{r.integrity.total === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Clear</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.decision ? DECISION_LABEL[r.decision] : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CandidateReportSheet
        templateId={templateId}
        inviteId={open}
        onClose={() => setOpen(null)}
        roleTitle={data?.template.role_title}
      />
    </div>
  );
}
