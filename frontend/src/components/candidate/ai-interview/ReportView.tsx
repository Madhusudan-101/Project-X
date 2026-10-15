import { AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AiInterviewReport, AiInterviewReportDetail } from "@/types/candidate/aiInterview";

const DOMAIN_LABELS: Record<string, string> = {
  ai_ml: "AI/ML",
  web_dev: "Web Development",
  dsa: "Data Structures & Algorithms",
};

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">
          {value === null ? "—" : `${Math.round(value)}/100`}
        </span>
      </div>
      <Progress value={value ?? 0} className="h-1.5" />
    </div>
  );
}

function BulletList({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon} {title}
      </h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

export function ReportView({ report }: { report: AiInterviewReport | AiInterviewReportDetail }) {
  const markdown = "report_markdown" in report ? report.report_markdown : null;
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold">
            {DOMAIN_LABELS[report.domain] ?? report.domain} interview
          </h3>
          <p className="text-xs text-muted-foreground">
            {new Date(report.created_at).toLocaleString()}
            {report.duration_seconds ? ` · ${Math.round(report.duration_seconds / 60)} min` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report.partial && <Badge variant="outline">Partial interview</Badge>}
          {report.final_recommendation && <Badge>{report.final_recommendation}</Badge>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ScoreBar label="Overall" value={report.overall_score} />
        <ScoreBar label="Technical" value={report.technical_score} />
        <ScoreBar label="Communication" value={report.communication_score} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <BulletList
          title="Strengths"
          items={report.strengths}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        />
        <BulletList
          title="Areas to improve"
          items={report.weaknesses}
          icon={<TrendingUp className="h-4 w-4 text-amber-500" />}
        />
      </div>
      <BulletList
        title="Red flags"
        items={report.red_flags}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
      />

      {report.per_question.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Per-question feedback</h4>
          <div className="space-y-2">
            {report.per_question.map((q, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{q.question}</p>
                  <Badge variant="secondary">{q.score}/10</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{q.feedback}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {markdown && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Full written report</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">{markdown}</pre>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        This is automated practice feedback, not a hiring decision.
      </p>
    </Card>
  );
}
