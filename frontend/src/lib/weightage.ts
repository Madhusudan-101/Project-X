// ── Role weightage utilities (Feature 4) ──────────────────────────────
// How much each evaluation factor counts toward a candidate's final score
// for a role. The five weights must always sum to exactly 100.

export type WeightKey =
  "resumeWeight" | "githubWeight" | "leetcodeWeight" | "interviewWeight" | "assessmentWeight";

export type RoleWeights = Record<WeightKey, number>;

export const WEIGHT_KEYS: WeightKey[] = [
  "resumeWeight",
  "githubWeight",
  "leetcodeWeight",
  "interviewWeight",
  "assessmentWeight",
];

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  resumeWeight: "Resume",
  githubWeight: "GitHub",
  leetcodeWeight: "LeetCode",
  interviewWeight: "Interview",
  assessmentWeight: "Assessment",
};

export const DEFAULT_WEIGHTS: RoleWeights = {
  resumeWeight: 20,
  githubWeight: 20,
  leetcodeWeight: 20,
  interviewWeight: 20,
  assessmentWeight: 20,
};

export function totalWeight(weights: RoleWeights): number {
  return WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
}

/**
 * Change one slider's value and proportionally redistribute the remaining
 * percentage across the other four, so the total is always exactly 100 —
 * never 99 or 101, even after integer rounding.
 */
export function redistributeWeights(
  current: RoleWeights,
  changedKey: WeightKey,
  rawNewValue: number,
): RoleWeights {
  const newValue = Math.max(0, Math.min(100, Math.round(rawNewValue)));
  const others = WEIGHT_KEYS.filter((key) => key !== changedKey);
  const remaining = 100 - newValue;
  const otherCurrentSum = others.reduce((sum, key) => sum + current[key], 0);

  const result = { ...current, [changedKey]: newValue } as RoleWeights;

  if (otherCurrentSum === 0) {
    // Nothing to redistribute proportionally — split evenly, giving any
    // remainder to the first few keys so the total lands exactly on 100.
    const base = Math.floor(remaining / others.length);
    let leftover = remaining - base * others.length;
    for (const key of others) {
      result[key] = base + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover--;
    }
  } else {
    for (const key of others) {
      result[key] = Math.round((current[key] / otherCurrentSum) * remaining);
    }
  }

  // Rounding can leave the total a point or two off — nudge the largest
  // "other" values by ±1 until it's exactly 100. changedKey is never touched.
  let diff = 100 - totalWeight(result);
  const adjustable = [...others].sort((a, b) => result[b] - result[a]);
  let i = 0;
  let guard = 0;
  while (diff !== 0 && guard < 1000) {
    const key = adjustable[i % adjustable.length];
    const step = diff > 0 ? 1 : -1;
    if (result[key] + step >= 0) {
      result[key] += step;
      diff -= step;
    }
    i++;
    guard++;
  }

  return result;
}
