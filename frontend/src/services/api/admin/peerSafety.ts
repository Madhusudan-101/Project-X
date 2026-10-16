import { request } from "../client";

export type PeerReportStatus = "open" | "reviewing" | "actioned" | "dismissed";
export type ResolveAction = "dismiss" | "warn" | "suspend" | "lift";

export interface PersonRef {
  id: string;
  name: string | null;
  email: string | null;
}

export interface PeerReportRow {
  id: string;
  reporter_id: string;
  reported_id: string;
  room_id: string;
  reason: string;
  status: PeerReportStatus;
  source: "dashboard" | "meeting";
  created_at: string;
  reporter: PersonRef | null;
  reported: PersonRef | null;
}

export interface PeerReportDetail extends PeerReportRow {
  details: string | null;
  evidence: { transcript?: string[]; captured_at?: string } | null;
  resolution_note: string | null;
  reviewed_at: string | null;
  history: {
    total_reports: number;
    distinct_reporters: number;
    reports: {
      id: string;
      reporter_id: string;
      reason: string;
      status: PeerReportStatus;
      created_at: string;
    }[];
  };
  sanctions: {
    id: string;
    kind: "warning" | "suspension";
    reason: string;
    ends_at: string | null;
    lifted_at: string | null;
    created_at: string;
  }[];
  active_suspension: boolean;
}

/** What the admin can still choose, given what is already true. Suspending needs a length of time. */
export function validateResolution(action: ResolveAction | "", days: number | null): string | null {
  if (!action) return "Choose what to do.";
  if (action === "suspend" && (!days || days < 1 || days > 365))
    return "Suspend for between 1 and 365 days.";
  return null;
}

const base = "/admin/peer-safety";

export const adminPeerSafetyService = {
  list: (status: PeerReportStatus | "all") =>
    request<{ items: PeerReportRow[] }>(`${base}/reports?status=${status}`),
  detail: (id: string) => request<PeerReportDetail>(`${base}/reports/${id}`),
  resolve: (id: string, body: { action: ResolveAction; days?: number; note?: string }) =>
    request<{ ok: boolean; status: PeerReportStatus }>(`${base}/reports/${id}/resolve`, {
      method: "POST",
      body,
    }),
};
