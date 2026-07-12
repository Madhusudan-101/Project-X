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

export interface SyncResponse<T> {
  ok: boolean;
  platform: string;
  data: T | null;
  error: string | null;
}
