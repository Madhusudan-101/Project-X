import { request } from "@/services/api/client";

export const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or abuse" },
  { id: "inappropriate_content", label: "Inappropriate content or behaviour" },
  { id: "impersonation", label: "Pretending to be someone else" },
  { id: "cheating_or_sharing_questions", label: "Cheating or sharing interview questions" },
  { id: "spam", label: "Spam or off-topic" },
  { id: "no_show", label: "Did not take part properly" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];
export const MAX_REPORT_DETAILS = 1000;

export interface MyReport {
  id: string;
  room_id: string;
  reason: ReportReason;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  created_at: string;
}
export interface BlockedPerson {
  id: string;
  /** The person's name only if they were not anonymous; otherwise "Anonymous Candidate". */
  label: string;
  created_at: string;
}
export interface GuidelinesState {
  version: string;
  accepted: boolean;
  accepted_at: string | null;
}

export const FEEDBACK_TAGS = [
  { id: "helpful", label: "Helpful" },
  { id: "well_prepared", label: "Well prepared" },
  { id: "respectful", label: "Respectful" },
  { id: "good_questions", label: "Good questions" },
  { id: "clear_feedback", label: "Clear feedback" },
  { id: "late", label: "Arrived late" },
  { id: "unprepared", label: "Unprepared" },
  { id: "off_topic", label: "Went off topic" },
  { id: "technical_problems", label: "Technical problems" },
] as const;
export const MAX_FEEDBACK_COMMENT = 500;

export interface SafetyStatus {
  suspended: boolean;
  suspended_until: string | null;
}

/** Plain-words problems with a report, or null when it can be sent. */
export function validateReport(reason: string, details: string): string | null {
  if (!REPORT_REASONS.some((r) => r.id === reason)) return "Choose a reason.";
  if (details.length > MAX_REPORT_DETAILS)
    return `Keep the details under ${MAX_REPORT_DETAILS} characters.`;
  return null;
}

const base = "/candidate/peer-safety";

export const peerSafetyService = {
  /** Report the other person in a meeting I was in. I name the room; the server finds the person. */
  report(body: { room_id: string; reason: ReportReason; details?: string; block?: boolean }) {
    return request<{ id: string; status: string; created: boolean; blocked: boolean }>(
      `${base}/reports`,
      {
        method: "POST",
        body: { details: "", block: false, ...body },
      },
    );
  },
  myReports: () => request<MyReport[]>(`${base}/reports`),
  blocks: () => request<BlockedPerson[]>(`${base}/blocks`),
  blockFromRoom: (room_id: string) =>
    request<{ ok: boolean }>(`${base}/blocks`, { method: "POST", body: { room_id } }),
  unblock: (id: string) => request<void>(`${base}/blocks/${id}`, { method: "DELETE" }),
  status: () => request<SafetyStatus>(`${base}/status`),
  guidelines: () => request<GuidelinesState>(`${base}/guidelines`),
  acceptGuidelines: (version: string) =>
    request<GuidelinesState>(`${base}/guidelines/accept`, {
      method: "POST",
      body: { version, rules: true, media: true, ai: true },
    }),
  saveFeedback: (body: { room_id: string; rating: number; tags: string[]; comment?: string }) =>
    request<{ ok: boolean }>(`${base}/feedback`, {
      method: "POST",
      body: { comment: "", ...body },
    }),
  myFeedback: () => request<{ room_id: string; rating: number }[]>(`${base}/feedback`),
};
