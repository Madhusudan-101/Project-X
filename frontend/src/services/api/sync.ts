/**
 * Sync API service — talks to POST /api/v1/analyze-resume, the sole
 * endpoint behind the resume-first unified analyzer.
 */

import { request } from "./client";
import type { CombinedAnalysisResponse } from "@/types/sync";

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
  /**
   * Upload a resume + target role and get one unified authenticity +
   * employability analysis. GitHub/LeetCode/Codeforces usernames are all
   * optional overrides — whichever aren't passed are auto-detected by the
   * backend from the resume's own embedded hyperlinks.
   */
  analyzeResume: (
    file: File,
    targetRole: string,
    usernames: { github?: string | null; leetcode?: string | null; codeforces?: string | null } = {},
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_role", targetRole);
    if (usernames.github) formData.append("github_username", usernames.github);
    if (usernames.leetcode) formData.append("leetcode_username", usernames.leetcode);
    if (usernames.codeforces) formData.append("codeforces_username", usernames.codeforces);

    return request<CombinedAnalysisResponse>(
      `/api/v1/analyze-resume`,
      {
        method: "POST",
        body: formData,
      },
    );
  },
};
