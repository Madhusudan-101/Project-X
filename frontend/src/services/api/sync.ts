/**
 * Sync API service — talks to:
 *   - POST /api/sync/github/:username
 *   - POST /api/sync/leetcode/:username
 *   - POST /api/sync/codeforces/:handle
 *   - POST /api/v1/analyze/:username
 */

import { request } from "./client";
import type {
  GitHubProfileData,
  LeetCodeProfileData,
  CodeforcesProfileData,
  SyncResponse,
  AnalyzeApiResponse,
  ResumeAnalysisResult,
} from "@/types/sync";

// ── Username extraction helpers ──────────────────────────────────────

/**
 * Extract a GitHub username from a profile URL **or** a bare username.
 *
 * Accepted formats:
 *   https://github.com/torvalds
 *   github.com/torvalds
 *   torvalds
 */
export function extractGitHubUsername(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 1) return parts[0];
    }
  } catch {
    // not a URL — fall through
  }
  // treat as bare username (last non-empty segment after splitting on /)
  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

/**
 * Extract a LeetCode username from a profile URL **or** a bare username.
 *
 * Accepted formats:
 *   https://leetcode.com/u/neal_wu
 *   https://leetcode.com/neal_wu
 *   leetcode.com/neal_wu
 *   neal_wu
 */
export function extractLeetCodeUsername(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    if (url.hostname === "leetcode.com" || url.hostname === "www.leetcode.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      // handle /u/username or /username
      if (parts.length >= 2 && parts[0] === "u") return parts[1];
      if (parts.length >= 1) return parts[parts.length - 1];
    }
  } catch {
    // not a URL — fall through
  }
  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

/**
 * Extract a Codeforces handle from a profile URL **or** a bare handle.
 *
 * Accepted formats:
 *   https://codeforces.com/profile/tourist
 *   codeforces.com/profile/tourist
 *   tourist
 */
export function extractCodeforcesHandle(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    if (url.hostname === "codeforces.com" || url.hostname === "www.codeforces.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      // handle /profile/handle or /handle
      if (parts.length >= 2 && parts[0] === "profile") return parts[1];
      if (parts.length >= 1) return parts[parts.length - 1];
    }
  } catch {
    // not a URL — fall through
  }
  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

// ── API calls ────────────────────────────────────────────────────────

export const syncService = {
  github: (username: string) =>
    request<SyncResponse<GitHubProfileData>>(
      `/api/sync/github/${encodeURIComponent(username)}`,
      { method: "POST" },
    ),

  leetcode: (username: string) =>
    request<SyncResponse<LeetCodeProfileData>>(
      `/api/sync/leetcode/${encodeURIComponent(username)}`,
      { method: "POST" },
    ),

  codeforces: (handle: string) =>
    request<SyncResponse<CodeforcesProfileData>>(
      `/api/sync/codeforces/${encodeURIComponent(handle)}`,
      { method: "POST" },
    ),

  analyze: (
    githubUsername: string | null,
    leetcodeUsername: string | null,
    codeforcesUsername: string | null = null,
  ) => {
    // We can use either as the path parameter or use a dummy/fallback one.
    const pathUsername = githubUsername ?? leetcodeUsername ?? codeforcesUsername ?? "user";
    return request<AnalyzeApiResponse>(
      `/api/v1/analyze/${encodeURIComponent(pathUsername)}`,
      {
        method: "POST",
        body: {
          github_username: githubUsername,
          leetcode_username: leetcodeUsername,
          codeforces_username: codeforcesUsername,
        },
      },
    );
  },

  analyzeResume: (
    file: File,
    githubUsername: string,
    leetcodeUsername: string | null,
    targetRole: string,
    codeforcesUsername: string | null = null,
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_role", targetRole);
    formData.append("github_username", githubUsername);
    if (leetcodeUsername) {
      formData.append("leetcode_username", leetcodeUsername);
    }
    if (codeforcesUsername) {
      formData.append("codeforces_username", codeforcesUsername);
    }

    return request<ResumeAnalysisResult>(
      `/api/v1/analyze-resume`,
      {
        method: "POST",
        body: formData,
      },
    );
  },
};
