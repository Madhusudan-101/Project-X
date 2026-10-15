import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type { ResultDetail } from "@/types/company/assessment";
import { fmtDuration } from "./format";

const VERDICT: Record<string, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  runtime_error: "Runtime error",
  compile_error: "Compile error",
  time_limit: "Time limit",
  judge_error: "Judge error",
};

export function CandidateResultSheet({
  jobId,
  driveId,
  applicationId,
  onClose,
}: {
  jobId: string;
  driveId: string;
  applicationId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<ResultDetail>({
    queryKey: ["company-oa", jobId, driveId, "result", applicationId],
    queryFn: () => companyAssessmentService.resultDetail(jobId, driveId, applicationId!),
    enabled: !!applicationId,
    retry: false,
  });

  return (
    <Sheet open={!!applicationId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{data?.candidate.name ?? "Candidate"}</SheetTitle>
        </SheetHeader>
        {isLoading ? (
          <Skeleton className="mt-4 h-64 w-full" />
        ) : isError || !data ? (
          <p className="mt-4 text-sm text-destructive">Couldn&apos;t load this attempt.</p>
        ) : (
          <div className="mt-4 space-y-5 text-sm">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Score"
                value={data.candidate.percent == null ? "—" : `${data.candidate.percent}%`}
              />
              <Stat label="Time taken" value={fmtDuration(data.candidate.timeTakenSeconds)} />
              <Stat
                label="Tab switches"
                value={data.candidate.tabSwitches}
                bad={data.candidate.flagged}
              />
              <Stat
                label="Pastes / fs exits"
                value={`${data.candidate.pasteEvents} / ${data.candidate.fullscreenExits}`}
              />
            </dl>

            {data.questions.map((q, i) => (
              <section key={i} className="space-y-2 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{q.title}</h3>
                  <span className="text-xs text-muted-foreground">
                    {data.sectionTitles[q.section ?? 0] ?? `Section ${q.section}`} · {q.points} pts
                  </span>
                  {q.qtype === "coding" && (
                    <Badge variant="outline" className="ml-auto tabular-nums">
                      Best {q.bestScore ?? 0}/{q.points}
                    </Badge>
                  )}
                </div>

                {q.qtype === "mcq" ? (
                  <ul className="space-y-1">
                    {(q.options ?? []).map((o, k) => (
                      <li
                        key={k}
                        className={
                          "flex items-center gap-2 rounded px-2 py-1 " +
                          (k === q.correctOption
                            ? "bg-success/10"
                            : k === q.chosenOption
                              ? "bg-destructive/10"
                              : "")
                        }
                      >
                        {k === q.correctOption ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : k === q.chosenOption ? (
                          <X className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <span className="w-3.5" />
                        )}
                        {o}
                        {k === q.chosenOption && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            their answer
                          </span>
                        )}
                      </li>
                    ))}
                    {q.chosenOption == null && (
                      <li className="text-xs text-muted-foreground">Not answered.</li>
                    )}
                  </ul>
                ) : (q.submissions ?? []).length === 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Nothing was submitted for grading.
                    </p>
                    {q.draft?.source && (
                      <Code
                        language={q.draft.language}
                        source={q.draft.source}
                        label="Unsubmitted draft"
                      />
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {[...(q.submissions ?? [])].reverse().map((s, k) => (
                      <div key={s.id} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge
                            variant="outline"
                            className={
                              s.verdict === "accepted"
                                ? "border-success/40 bg-success/10 text-success"
                                : "border-destructive/30 bg-destructive/5 text-destructive"
                            }
                          >
                            {VERDICT[s.verdict] ?? s.verdict}
                          </Badge>
                          <span>
                            {s.passed}/{s.total} tests · {s.score} pts · {s.language}
                          </span>
                          <span className="ml-auto text-muted-foreground">
                            {k === 0 ? "latest · " : ""}
                            {new Date(s.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {k === 0 && <Code language={s.language} source={s.source} />}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          "font-display text-lg font-semibold tabular-nums " + (bad ? "text-destructive" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Code({
  source,
  language,
  label,
}: {
  source: string;
  language: string | null;
  label?: string;
}) {
  return (
    <div>
      {label && (
        <p className="mb-1 text-xs text-muted-foreground">
          {label}
          {language ? ` · ${language}` : ""}
        </p>
      )}
      <pre className="max-h-72 overflow-auto rounded-md bg-[#0f1320] p-3 font-mono text-xs leading-5 text-slate-100">
        {source}
      </pre>
    </div>
  );
}
