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

/** A user-facing message for a failed admin request. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return "Your account doesn't have Admin access to this data.";
    if (error.status === 401) return "Your session has expired. Please sign in again.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
