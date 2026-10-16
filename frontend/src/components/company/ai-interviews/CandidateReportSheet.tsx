import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { IntegritySection } from "@/components/candidate/ai-interview/ReportView";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import type { Decision, IntegrityReview, ResultDetail } from "@/types/company/aiInterview";
import { DECISION_LABEL, INVITE_STATUS_LABEL, defaultDecisionMessage, mmss } from "./rubric";

const score = (v: number | null) => (v === null ? "Not scored" : `${Math.round(v)}/100`);

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-sm font-semibold">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function DecisionForm({
  templateId,
  inviteId,
  current,
  roleTitle,
}: {
  templateId: string;
  inviteId: string;
  current: ResultDetail["decision"];
  roleTitle: string;
}) {
  const qc = useQueryClient();
  const [notify, setNotify] = useState(false);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<Decision | null>(current.decision);
  const [note, setNote] = useState(current.note);
  useEffect(() => {
    setDecision(current.decision);
    setNote(current.note);
  }, [current.decision, current.note]);

  const save = useMutation({
    mutationFn: () =>
      companyAiInterviewService.setDecision(
        templateId,
        inviteId,
        decision,
        note,
        notify && canNotify ? { message: message.trim() } : undefined,
      ),
    onSuccess: (r) => {
      toast.success(
        decision ? `Marked as ${DECISION_LABEL[decision].toLowerCase()}.` : "Decision cleared.",
      );
      if (r.application_status)
        toast.info(`Their job application is now “${r.application_status}”.`);
      if (r.candidate_email === "sent") toast.success("The candidate was emailed.");
      else if (r.candidate_email === "skipped" || r.candidate_email === "failed")
        toast.warning("The candidate could not be emailed. Tell them yourself.");
      setNotify(false);
      qc.invalidateQueries({ queryKey: ["company-ai-interviews"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });
  const canNotify = decision === "advance" || decision === "reject";
  const dirty = decision !== current.decision || note.trim() !== current.note;

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="decision-h">
      <h3 id="decision-h" className="text-sm font-semibold">
        Your decision
      </h3>
      <p className="text-xs text-muted-foreground">
        The AI report is a recommendation. You make the call. The candidate is only told if you
        choose to email them below.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
        {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            role="radio"
            aria-checked={decision === d}
            variant={decision === d ? "default" : "outline"}
            onClick={() => {
              const next = decision === d ? null : d;
              setDecision(next);
              setMessage(defaultDecisionMessage(next, roleTitle));
              if (next !== "advance" && next !== "reject") setNotify(false);
            }}
          >
            {DECISION_LABEL[d]}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="decision-note">Note (optional)</Label>
        <Textarea
          id="decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      </div>
      {canNotify && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email the candidate this outcome
          </label>
          {notify && (
            <>
              <Label htmlFor="decision-message">Message to the candidate</Label>
              <Textarea
                id="decision-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </>
          )}
        </div>
      )}
      <Button
        size="sm"
        disabled={!dirty || save.isPending || (notify && canNotify && message.trim().length < 5)}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save decision
      </Button>
    </section>
  );
}

function IntegrityReviewForm({
  templateId,
  inviteId,
  current,
}: {
  templateId: string;
  inviteId: string;
  current: NonNullable<ResultDetail["integrity_review"]>;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(current.note);
  useEffect(() => setNote(current.note), [current.note]);
  const save = useMutation({
    mutationFn: (review: IntegrityReview | null) =>
      companyAiInterviewService.setIntegrityReview(templateId, inviteId, review, note),
    onSuccess: () => {
      toast.success("Review saved.");
      qc.invalidateQueries({ queryKey: ["company-ai-interviews"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });
  return (
    <section className="space-y-2 rounded-lg border p-4" aria-labelledby="integrity-review-h">
      <h3 id="integrity-review-h" className="text-sm font-semibold">
        Your review of the flags
      </h3>
      <p className="text-xs text-muted-foreground">
        Flags are signals, not proof. A person decides whether they matter.
      </p>
      <Textarea
        aria-label="Review note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={current.review === "dismissed" ? "default" : "outline"}
          disabled={save.isPending}
          onClick={() => save.mutate("dismissed")}
        >
          Dismiss as false alarm
        </Button>
        <Button
          size="sm"
          variant={current.review === "confirmed" ? "destructive" : "outline"}
          disabled={save.isPending}
          onClick={() => save.mutate("confirmed")}
        >
          Confirm concern
        </Button>
        {current.review && (
          <Button
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Clear review
          </Button>
        )}
        {current.review && (
          <Badge variant="outline">
            {current.review === "dismissed" ? "Dismissed" : "Concern confirmed"}
          </Badge>
        )}
      </div>
    </section>
  );
}

export function CandidateReportSheet({
  templateId,
  inviteId,
  onClose,
  roleTitle = "this",
}: {
  templateId: string;
  inviteId: string | null;
  onClose: () => void;
  roleTitle?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["company-ai-interviews", templateId, "result", inviteId],
    queryFn: () => companyAiInterviewService.resultDetail(templateId, inviteId as string),
    enabled: !!inviteId,
  });

  return (
    <Sheet open={!!inviteId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {data?.candidate.name ?? data?.candidate.email ?? "Candidate report"}
          </SheetTitle>
          <SheetDescription>
            {data
              ? `${data.candidate.email} · ${INVITE_STATUS_LABEL[data.candidate.status]}`
              : "Loading the report"}
          </SheetDescription>
        </SheetHeader>

        {isLoading && <Skeleton className="mt-6 h-64 w-full" />}
        {isError && (
          <p className="mt-6 text-sm text-destructive">Could not load this report. Try again.</p>
        )}
        {data && (
          <div className="mt-6 space-y-6">
            <DecisionForm
              templateId={templateId}
              inviteId={data.candidate.id}
              current={data.decision}
              roleTitle={roleTitle}
            />

            {data.accommodation?.request && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <span className="font-medium">Accommodation requested: </span>
                {data.accommodation.request}
              </p>
            )}

            {data.previous_attempts && data.previous_attempts.length > 0 && (
              <section className="space-y-1 text-sm">
                <h3 className="text-sm font-semibold">Earlier attempts</h3>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {data.previous_attempts.map((a, i) => (
                    <li key={i}>
                      {a.started_at ? new Date(a.started_at).toLocaleString() : "Unknown date"} ·{" "}
                      {a.has_report && a.overall_score !== null
                        ? `scored ${Math.round(a.overall_score)}`
                        : "no report"}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!data.report ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {data.candidate.status === "started"
                  ? "The interview is in progress or the report is still being prepared."
                  : "No report yet."}
              </p>
            ) : (
              <>
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-3xl font-semibold tabular-nums">
                      {data.report.overall_score === null
                        ? "—"
                        : Math.round(data.report.overall_score)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      overall, weighted by your rubric
                    </span>
                    {data.report.recommendation && (
                      <Badge className="ml-auto">AI recommends: {data.report.recommendation}</Badge>
                    )}
                    {data.report.partial && <Badge variant="outline">Left early</Badge>}
                  </div>
                  <ul className="space-y-3">
                    {data.report.competencies.map((c) => {
                      const pct = data.rubric.find((r) => r.name === c.name)?.weight_pct;
                      return (
                        <li key={c.name}>
                          <div className="mb-1 flex justify-between gap-2 text-sm">
                            <span className="font-medium">
                              {c.name}
                              {pct !== undefined && (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  {pct}% of score
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums">{score(c.score)}</span>
                          </div>
                          <Progress value={c.score ?? 0} className="h-1.5" />
                          {c.evidence && (
                            <p className="mt-1 text-sm text-muted-foreground">{c.evidence}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Bullets title="Strengths" items={data.report.strengths} />
                  <Bullets title="Weaknesses" items={data.report.weaknesses} />
                </div>
                <Bullets title="Red flags" items={data.report.red_flags} />
              </>
            )}

            <IntegritySection summary={data.integrity} events={data.integrity_events} />
            {data.integrity.total > 0 && data.integrity_review && (
              <IntegrityReviewForm
                templateId={templateId}
                inviteId={data.candidate.id}
                current={data.integrity_review}
              />
            )}

            <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              {data.consent.accepted_at
                ? `The candidate accepted the rules on ${new Date(data.consent.accepted_at).toLocaleString()} and allowed ${
                    [data.consent.audio && "audio", data.consent.video && "camera"]
                      .filter(Boolean)
                      .join(" and ") || "no recording"
                  } analysis. Scored against the rubric as it was when they started.`
                : "Consent record unavailable."}
            </p>

            {data.report && data.report.per_question.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">Question by question</h3>
                <div className="space-y-2">
                  {data.report.per_question.map((q, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <p className="font-medium">{q.question}</p>
                        {q.score !== null && <Badge variant="secondary">{q.score}/10</Badge>}
                      </div>
                      <p className="mt-1 text-muted-foreground">{q.feedback}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.report?.transcript && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Transcript</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">
                  {data.report.transcript}
                </pre>
              </details>
            )}
            {data.report?.report_markdown && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Full written report</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">
                  {data.report.report_markdown}
                </pre>
              </details>
            )}
            {data.report?.duration_seconds ? (
              <p className="text-xs text-muted-foreground">
                Interview length {mmss(data.report.duration_seconds)}.
              </p>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
