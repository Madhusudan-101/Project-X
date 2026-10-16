import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, Info, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type {
  SimilarityCompare,
  SimilarityCompareSide,
  SimilarityPair,
  SimilarityPerson,
  SimilarityQuestion,
  SimilarityReport,
} from "@/types/company/assessment";

/** Pairs this similar usually share variable names too, which a coincidence rarely explains. */
const SHARES_NAMES = 0.7;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function SimilarityPanel({ jobId, driveId }: { jobId: string; driveId: string }) {
  const { data, isLoading, isError } = useQuery<SimilarityReport>({
    queryKey: ["company-oa", jobId, driveId, "similarity"],
    queryFn: () => companyAssessmentService.similarity(jobId, driveId),
    retry: false,
  });
  const [open, setOpen] = useState<{ q: SimilarityQuestion; pair: SimilarityPair } | null>(null);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Couldn&apos;t run the similarity check.</p>;
  }
  if (data.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This assessment has no coding questions, so there is no code to compare.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{data.note}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant={data.summary.flaggedPairs ? "destructive" : "secondary"}>
          {data.summary.flaggedPairs} flagged pair{data.summary.flaggedPairs === 1 ? "" : "s"}
        </Badge>
        <span className="text-muted-foreground">
          {data.summary.candidatesInvolved} candidate
          {data.summary.candidatesInvolved === 1 ? "" : "s"} involved
        </span>
      </div>

      {data.questions.map((q) => (
        <Card key={q.questionId} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{q.title}</h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {q.compared} solution{q.compared === 1 ? "" : "s"} compared
              {q.skipped > 0 && ` · ${q.skipped} too short or starter-only`}
            </span>
          </div>

          {q.pairs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No pairs above the threshold.</p>
          ) : (
            <ul className="divide-y divide-border">
              {q.pairs.map((p) => (
                <li key={`${p.a.applicationId}-${p.b.applicationId}`}>
                  <button
                    type="button"
                    onClick={() => setOpen({ q, pair: p })}
                    className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{p.a.name}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-medium">{p.b.name}</span>
                    <Badge variant={p.level === "high" ? "destructive" : "outline"}>
                      {p.level === "high" ? "High" : "Medium"} · {pct(p.similarity)}
                    </Badge>
                    {p.rawOverlap >= SHARES_NAMES && (
                      <Badge variant="outline">same variable names</Badge>
                    )}
                    {(p.a.draft || p.b.draft) && (
                      <Badge variant="outline">includes an unsubmitted draft</Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{p.language}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {q.clusters.map((c, i) => (
            <p key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-destructive" />
              <span className="font-medium">Group of {c.size}:</span>
              {c.members.map((m: SimilarityPerson) => m.name).join(", ")}
            </p>
          ))}
        </Card>
      ))}

      <CompareDialog jobId={jobId} driveId={driveId} open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CompareDialog({
  jobId,
  driveId,
  open,
  onClose,
}: {
  jobId: string;
  driveId: string;
  open: { q: SimilarityQuestion; pair: SimilarityPair } | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<SimilarityCompare>({
    queryKey: [
      "company-oa",
      jobId,
      driveId,
      "similarity-compare",
      open?.q.questionId,
      open?.pair.a.applicationId,
      open?.pair.b.applicationId,
    ],
    queryFn: () =>
      companyAssessmentService.similarityCompare(
        jobId,
        driveId,
        open!.q.questionId,
        open!.pair.a.applicationId,
        open!.pair.b.applicationId,
      ),
    enabled: !!open,
    retry: false,
  });

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {open ? `${open.q.title}: ${open.pair.a.name} ↔ ${open.pair.b.name}` : "Compare"}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Couldn&apos;t load the two solutions.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {data.comparable
                ? `${pct(data.similarity)} of the shorter solution is shared, ignoring variable names and comments. Highlighted lines are the shared code. ${pct(data.rawOverlap)} also matches when names are kept.`
                : "These solutions can't be compared directly (different languages, or too little code)."}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <CodeSide side={data.a} />
              <CodeSide side={data.b} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CodeSide({ side }: { side: SimilarityCompareSide }) {
  const marked = new Set(side.matchedLines);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{side.name}</span> · {side.language}
        {side.draft ? " · unsubmitted draft" : ""}
        {side.skipped ? ` · ${side.skipped}` : ""}
      </p>
      <pre className="max-h-[60vh] overflow-auto rounded-md bg-[#0f1320] py-2 font-mono text-xs leading-5 text-slate-100">
        {side.source.split("\n").map((line, i) => (
          <div key={i} className={"flex px-2 " + (marked.has(i + 1) ? "bg-destructive/25" : "")}>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-slate-500">{i + 1}</span>
            <span className="whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
