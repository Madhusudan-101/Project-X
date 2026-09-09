import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ApplicationAnalysis } from "@/types/jobs";

const DIMENSION_LABELS: Record<string, string> = {
  resume: "Resume",
  github: "GitHub",
  leetcode: "LeetCode",
  interview: "Interview",
  assessment: "Assessment",
};

const RECOMMENDATION_STYLES: Record<string, string> = {
  advance: "border-success/40 bg-success/10 text-success",
  consider: "border-primary/40 bg-primary/10 text-primary",
  hold: "border-warning/40 bg-warning/10 text-warning-foreground",
  reject: "border-destructive/40 bg-destructive/10 text-destructive",
};

interface Props {
  analysis: ApplicationAnalysis;
}

export function ApplicantAnalysisPanel({ analysis }: Props) {
  const a = analysis.analysisJson;
  const w = analysis.weightsSnapshot;
  const weightFor: Record<string, number> = {
    resume: w.resume_weight,
    github: w.github_weight,
    leetcode: w.leetcode_weight,
    interview: w.interview_weight,
    assessment: w.assessment_weight,
  };

  return (
    <div className="space-y-5">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/70 bg-surface/50 p-3">
          <div className="text-xs text-muted-foreground">Placement probability</div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums">
            {Math.round(analysis.placementProbability)}%
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/50 p-3">
          <div className="text-xs text-muted-foreground">Weighted composite</div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums">
            {analysis.weightedComposite.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Recruiter verdict */}
      <div className="rounded-lg border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-semibold">{a.recruiter_verdict.label}</span>
          <Badge
            variant="outline"
            className={cn(
              "capitalize",
              RECOMMENDATION_STYLES[a.recruiter_verdict.recommendation] ?? "",
            )}
          >
            {a.recruiter_verdict.recommendation}
          </Badge>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {a.recruiter_verdict.summary}
        </p>
      </div>

      {/* Dimension breakdown */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          5-dimension breakdown · weighted for this job
        </h3>
        {(["resume", "github", "leetcode", "interview", "assessment"] as const).map((dim) => {
          const d = a.dimensions[dim];
          const noData = d.score === null || d.score === undefined;
          return (
            <div key={dim} className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {DIMENSION_LABELS[dim]}
                  <span className="ml-2 text-xs text-muted-foreground">
                    weight {weightFor[dim]}%
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {noData ? "No data" : `${d.score}/100`}
                </span>
              </div>
              {!noData && <Progress value={d.score ?? 0} className="mt-2 h-1.5" />}
              <p className="mt-1.5 text-xs text-muted-foreground">{d.rationale}</p>
              {d.evidence?.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {d.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Skills match */}
      <div className="rounded-lg border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Skills match
          </h3>
          <span className="text-sm tabular-nums text-muted-foreground">
            {a.skills_match.coverage_pct}% coverage
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.skills_match.matched.map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="border-success/40 bg-success/10 text-success"
            >
              {s}
            </Badge>
          ))}
          {a.skills_match.missing.map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="border-destructive/30 bg-destructive/5 text-destructive"
            >
              {s}
            </Badge>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Generated {new Date(analysis.generatedAt).toLocaleString()} · scoped to this application
        only.
      </p>
    </div>
  );
}
