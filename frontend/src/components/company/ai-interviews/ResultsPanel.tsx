import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { DECISION_LABEL, INVITE_STATUS_LABEL } from "./rubric";

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
  const { data, isLoading } = useQuery<ResultsPayload>({
    queryKey: ["company-ai-interviews", templateId, "results"],
    queryFn: () => companyAiInterviewService.results(templateId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const rows = data?.rows ?? [];
  const s = data?.summary;

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

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No one has taken this interview yet. Results appear here as candidates finish.
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

      <CandidateReportSheet templateId={templateId} inviteId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
