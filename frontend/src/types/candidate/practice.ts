// ── Types for the Practice tab's LeetCode weak-topic recommendations ──

export interface LeetCodeQuestionSummary {
  title: string;
  title_slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  is_paid_only: boolean;
  ac_rate: number | null;
  url: string;
}

export type WeakTopicTier = "fundamental" | "intermediate" | "advanced";

export interface WeakTopic {
  tag_name: string;
  tag_slug: string;
  tier: WeakTopicTier;
  problems_solved: number;
  questions: LeetCodeQuestionSummary[];
  fetch_warning: string | null;
}

/** Response of POST /api/practice/:username/recommendations */
export interface PracticeRecommendations {
  username: string;
  weak_topics: WeakTopic[];
  warnings: string[];
}
