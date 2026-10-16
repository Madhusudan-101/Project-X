/**
 * Company AI interviews API. Everything is scoped server-side to the caller's own company.
 *
 *   GET    /company/ai-interviews/presets
 *   GET|POST /company/ai-interviews[?include_archived]
 *   GET|PATCH|DELETE /company/ai-interviews/{id}            (DELETE archives)
 *   GET|POST /company/ai-interviews/{id}/invites            (+ /{invite}/resend, DELETE /{invite})
 *   GET    /company/ai-interviews/{id}/results[/{invite}]
 *   PUT    /company/ai-interviews/{id}/results/{invite}/decision
 */

import { request } from "../client";
import type {
  Decision,
  InterviewTemplate,
  InviteResult,
  InviteRow,
  ResultDetail,
  ResultsPayload,
  RubricPreset,
  TemplateDraft,
  TemplateStatus,
} from "@/types/company/aiInterview";

const base = "/company/ai-interviews";

export const companyAiInterviewService = {
  presets: () => request<RubricPreset[]>(`${base}/presets`),

  list: (includeArchived = false) =>
    request<InterviewTemplate[]>(`${base}${includeArchived ? "?include_archived=true" : ""}`),

  get: (id: string) => request<InterviewTemplate>(`${base}/${id}`),

  create: (draft: TemplateDraft, status: Exclude<TemplateStatus, "archived">) =>
    request<InterviewTemplate>(base, { method: "POST", body: { ...draft, status } }),

  update: (
    id: string,
    patch: Partial<TemplateDraft> & { status?: TemplateStatus; clear_job?: boolean },
  ) => request<InterviewTemplate>(`${base}/${id}`, { method: "PATCH", body: patch }),

  archive: (id: string) => request<void>(`${base}/${id}`, { method: "DELETE" }),

  invite: (
    id: string,
    body: { emails?: string[]; application_ids?: string[]; expires_in_days?: number },
  ) => request<InviteResult>(`${base}/${id}/invites`, { method: "POST", body }),

  listInvites: (id: string) => request<InviteRow[]>(`${base}/${id}/invites`),

  resend: (id: string, inviteId: string) =>
    request<{ email: "sent" | "skipped" | "failed" }>(`${base}/${id}/invites/${inviteId}/resend`, {
      method: "POST",
    }),

  revoke: (id: string, inviteId: string) =>
    request<void>(`${base}/${id}/invites/${inviteId}`, { method: "DELETE" }),

  results: (id: string) => request<ResultsPayload>(`${base}/${id}/results`),

  resultDetail: (id: string, inviteId: string) =>
    request<ResultDetail>(`${base}/${id}/results/${inviteId}`),

  setDecision: (id: string, inviteId: string, decision: Decision | null, note: string) =>
    request<{ decision: Decision | null; note: string }>(
      `${base}/${id}/results/${inviteId}/decision`,
      { method: "PUT", body: { decision, note } },
    ),
};
