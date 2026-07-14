// ── Types for the /api/sync/* endpoints ──────────────────────────────

export interface GitHubLanguageStat {
  language: string;
  bytes: number;
  percentage: number;
}

export interface GitHubProfileData {
  username: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
  account_age_days: number;
  top_languages: GitHubLanguageStat[];
}

export interface LeetCodeDifficultyBreakdown {
  all: number;
  easy: number;
  medium: number;
  hard: number;
}

export interface LeetCodeStreakInfo {
  current_streak: number;
  longest_streak: number;
  total_active_days: number;
}

export interface LeetCodeProfileData {
  username: string;
  real_name: string | null;
  ranking: number | null;
  avatar_url: string | null;
  total_solved: number;
  breakdown: LeetCodeDifficultyBreakdown;
  streak: LeetCodeStreakInfo;
}

export interface RepoSummary {
  name: string;
  is_fork: boolean;
  stars: number;
  size_kb: number;
  primary_language: string | null;
  created: string;
  last_push: string;
  days_since_last_push: number;
  commit_dates: string[];
  readme_snippet: string | null;
}

export interface ActivityMetrics {
  total_events: number;
  total_commits: number;
  unique_active_days: number;
  avg_per_active_day: number;
  longest_streak_days: number;
  current_streak_days: number;
  largest_gap_days: number;
  busiest_single_day: {
    date: string;
    count: number;
  };
  days_with_10plus: number;
  day_of_week_distribution: Record<string, number>;
}

export interface GitHubMetrics {
  account_age_days: number;
  total_repos: number;
  original_repos: number;
  forked_repos: number;
  fork_ratio: number;
  total_stars_received: number;
  top_languages: string[];
  repos: RepoSummary[];
  recent_activity: ActivityMetrics;
  commits_per_repo: Record<string, number>;
}

export interface RecentSubmission {
  title: string;
  titleSlug: string;
  timestamp: string;
}

export interface TopicTagEntry {
  tagName: string;
  problemsSolved: number;
}

export interface TopicTagBreakdown {
  advanced: TopicTagEntry[];
  intermediate: TopicTagEntry[];
  fundamental: TopicTagEntry[];
}

export interface LeetCodeMetrics {
  total_solved: number;
  easy: number;
  medium: number;
  hard: number;
  easy_medium_hard_ratio: string;
  submission_activity: ActivityMetrics;
  recent_submissions: RecentSubmission[];
  topic_tags: TopicTagBreakdown | null;
}

export interface FormattedMetrics {
  github: GitHubMetrics | null;
  leetcode: LeetCodeMetrics | null;
}

export interface SyncResponse<T> {
  ok: boolean;
  platform: string;
  data: T | null;
  error: string | null;
}

export interface ConsistencyAnalysis {
  rating: "Sustained" | "Fragmented" | "Spiky";
  evaluation: string;
}

export interface LeetCodeSkills {
  strong_topics: string[];
  growth_areas: string[];
  algorithmic_depth_summary: string;
}

export interface ProjectRigorEntry {
  repo_name: string;
  inferred_complexity: "Low" | "Medium" | "High" | "Advanced";
  skills_developed: string[];
  analysis: string;
}

export interface CareerAlignment {
  recommended_roles: string[];
  green_flags: string[];
  red_flags: string[];
}

export interface AnalysisResult {
  overall_score: number;
  consistency_analysis: ConsistencyAnalysis;
  leetcode_skills: LeetCodeSkills;
  project_rigor: ProjectRigorEntry[];
  career_alignment: CareerAlignment;
  actionable_feedback: string;
}

export interface AnalyzeApiResponse {
  ok: boolean;
  username: string;
  analysis: AnalysisResult | null;
  formatted_metrics?: FormattedMetrics | null;
  warnings: string[];
  error: string | null;
}

export interface Discrepancy {
  resume_claim: string;
  portfolio_reality: string;
}

export interface ResumeAnalysisResult {
  detected_discrepancies: Discrepancy[];
  strengths: string[];
  weaknesses: string[];
  next_week_action_plan: string[];
}


