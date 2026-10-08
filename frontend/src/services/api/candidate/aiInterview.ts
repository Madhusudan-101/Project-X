import { request } from "@/services/api/client";
import type {
  AiInterviewDomain,
  AiInterviewReport,
  AiInterviewReportDetail,
  AiInterviewSession,
} from "@/types/candidate/aiInterview";

export const aiInterviewService = {
  /** Start an interview: creates the LiveKit room server-side and returns join info. */
  startSession(domain: AiInterviewDomain): Promise<AiInterviewSession> {
    return request<AiInterviewSession>("/candidate/ai-interview/session", {
      method: "POST",
      body: { domain },
    });
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
