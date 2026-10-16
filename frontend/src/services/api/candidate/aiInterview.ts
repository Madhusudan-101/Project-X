import { request } from "@/services/api/client";
import type {
  AiInterviewConfig,
  AiInterviewDomain,
  AiInterviewReport,
  AiInterviewReportDetail,
  AiInterviewSession,
  IntegrityEvent,
} from "@/types/candidate/aiInterview";

export const aiInterviewService = {
  /** Start an interview: creates the LiveKit room server-side and returns join info. */
  startSession(domain: AiInterviewDomain, consentVersion: string): Promise<AiInterviewSession> {
    return request<AiInterviewSession>("/candidate/ai-interview/session", {
      method: "POST",
      body: { domain, consent: true, audioConsent: true, videoConsent: true, consentVersion },
    });
  },

  /** Real duration, daily limit, attempts left and the rules version to accept. */
  getConfig(signal?: AbortSignal): Promise<AiInterviewConfig> {
    return request<AiInterviewConfig>("/candidate/ai-interview/config", { signal });
  },

  /** Save supervision signals (tab left, camera lost...) against the live interview. */
  logIntegrityEvents(
    roomName: string,
    events: { kind: IntegrityEvent["kind"]; offsetSeconds: number }[],
  ): Promise<{ accepted: number }> {
    return request<{ accepted: number }>(
      `/candidate/ai-interview/session/${encodeURIComponent(roomName)}/integrity-events`,
      { method: "POST", body: { events } },
    );
  },

  listReports(): Promise<AiInterviewReport[]> {
    return request<AiInterviewReport[]>("/candidate/ai-interview/reports");
  },

  /** 404 (ApiClientError.status === 404) until the agent has posted the report. */
  getReport(roomId: string, signal?: AbortSignal): Promise<AiInterviewReportDetail> {
    return request<AiInterviewReportDetail>(
      `/candidate/ai-interview/reports/${encodeURIComponent(roomId)}`,
      { signal },
    );
  },
};
