import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobWeights } from "@/types/jobs";
import { weightsTotal } from "@/types/jobs";

const ROWS: { key: keyof JobWeights; label: string; hint: string }[] = [
  { key: "resumeWeight", label: "Resume", hint: "Experience, projects, relevance" },
  { key: "githubWeight", label: "GitHub", hint: "Verified project depth & activity" },
  { key: "leetcodeWeight", label: "LeetCode", hint: "Verified DSA / CP signal" },
  { key: "interviewWeight", label: "Interview", hint: "AI interview (coming soon)" },
  { key: "assessmentWeight", label: "Assessment", hint: "Skills assessment (coming soon)" },
];

interface WeightSlidersFieldProps {
  value: JobWeights;
  onChange: (next: JobWeights) => void;
  disabled?: boolean;
}

/**
 * Five weight sliders that must sum to exactly 100. The parent gates
 * submit on `weightsTotal(value) === 100`; the backend re-validates and the
 * job_weights table has a CHECK constraint enforcing the same.
 */
export function WeightSlidersField({ value, onChange, disabled }: WeightSlidersFieldProps) {
  const total = weightsTotal(value);
  const valid = total === 100;

  const setOne = (key: keyof JobWeights, next: number) => {
    onChange({ ...value, [key]: Math.max(0, Math.min(100, Math.round(next))) });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Scoring weights</p>
          <p className="text-xs text-muted-foreground">
            How much each signal counts when candidates are scored for this job.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "tabular-nums",
            valid
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
          aria-live="polite"
        >
          {total}% / 100%
        </Badge>
      </div>

      <div className="space-y-4 pt-1">
        {ROWS.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{value[row.key]}%</span>
            </div>
            <Slider
              value={[value[row.key]]}
              min={0}
              max={100}
              step={5}
              disabled={disabled}
              onValueChange={(v) => setOne(row.key, v[0] ?? 0)}
              aria-label={`${row.label} weight`}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </div>

      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          Weights must total exactly 100% ({total > 100 ? "reduce" : "add"} {Math.abs(100 - total)}
          %).
        </p>
      )}
    </div>
  );
}
