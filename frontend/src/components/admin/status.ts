import { ApiClientError } from "@/services/api/client";

export type Tone = "success" | "warning" | "muted" | "primary" | "outline" | "destructive";

export const DRIVE_STATUS: Record<string, { tone: Tone; label: string }> = {
  live: { tone: "success", label: "Live" },
  draft: { tone: "warning", label: "Draft" },
  closed: { tone: "muted", label: "Closed" },
};

export const PLACEMENT_STATUS: Record<string, { tone: Tone; label: string }> = {
  placed: { tone: "success", label: "Placed" },
  in_process: { tone: "primary", label: "In process" },
  applied: { tone: "muted", label: "Applied" },
  rejected: { tone: "destructive", label: "Not selected" },
  not_applied: { tone: "outline", label: "Not applied" },
};

export const USER_ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  college: "College",
  company: "Company",
  candidate: "Candidate",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  user_login: "Signed in",
  account_provisioned: "Account provisioned",
  user_blocked: "User blocked",
  user_unblocked: "User unblocked",
  csv_exported: "CSV exported",
  report_generated: "Report generated",
  permission_granted: "Permission granted",
  permission_revoked: "Permission revoked",
  candidate_registered: "Candidate registered",
  company_registered: "Company registered",
  college_registered: "College registered",
  drive_created: "Drive created",
  application_submitted: "Application submitted",
  candidate_selected: "Candidate selected",
};

export const ALERT_SEVERITY: Record<string, { tone: Tone; label: string }> = {
  critical: { tone: "destructive", label: "Critical" },
  warning: { tone: "warning", label: "Warning" },
  info: { tone: "primary", label: "Info" },
};

export const RESULT_TONE: Record<string, Tone> = { success: "success", failure: "destructive" };

/** A user-facing message for a failed admin request. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return "Your account doesn't have Admin access to this data.";
    if (error.status === 401) return "Your session has expired. Please sign in again.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
