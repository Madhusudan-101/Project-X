import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  redistributeWeights,
  totalWeight,
  WEIGHT_KEYS,
  WEIGHT_LABELS,
  type RoleWeights,
} from "@/lib/weightage";

interface RoleWeightSlidersProps {
  weights: RoleWeights;
  onChange: (weights: RoleWeights) => void;
  disabled?: boolean;
}

/**
 * Five linked sliders (Resume / GitHub / LeetCode / Interview / Assessment).
 * Dragging one proportionally rebalances the other four so the total is
 * always exactly 100% — the total is displayed live as a safety-net check.
 */
export function RoleWeightSliders({ weights, onChange, disabled }: RoleWeightSlidersProps) {
  const total = totalWeight(weights);

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Evaluation weightage</p>
        <Badge
          variant="outline"
          className={
            total === 100
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }
        >
          Total: {total}%
        </Badge>
      </div>

      {WEIGHT_KEYS.map((key) => (
        <div key={key} className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <Label htmlFor={`weight-${key}`}>{WEIGHT_LABELS[key]}</Label>
            <span className="text-xs font-medium text-muted-foreground">{weights[key]}%</span>
          </div>
          <Slider
            id={`weight-${key}`}
            min={0}
            max={100}
            step={1}
            value={[weights[key]]}
            onValueChange={([value]) => onChange(redistributeWeights(weights, key, value))}
            disabled={disabled}
            aria-label={`${WEIGHT_LABELS[key]} weight`}
            aria-valuetext={`${weights[key]} percent`}
          />
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Adjusting one factor automatically rebalances the others so the total always stays at 100%.
      </p>
    </div>
  );
}
