/**
 * Online Assessment API — company side. Everything is scoped server-side to
 * the caller's own company through the job/drive.
 *
 *   GET    /company/oa/problems[?q&difficulty&topic]          validated problem library
 *   GET    /company/oa/problems/{id}                          preview
 *   GET|PUT|DELETE /company/jobs/{job}/drives/{drive}/assessment
 *   GET|POST       .../assessment/invites     (+ /{app}/resend, DELETE /{app})
 *   POST           .../assessment/remind
 *   GET            .../assessment/results[/{application}]
 */

import { request } from "../client";
import type {
  Assessment,
  AssessmentDraft,
  InviteResult,
  InviteRow,
  LibraryProblem,
  ProblemPreview,
  ResultDetail,
  ResultRow,
  Results,
  SectionKind,
} from "@/types/company/assessment";

type Raw = Record<string, unknown>;
const base = (jobId: string, driveId: string) =>
  `/company/jobs/${jobId}/drives/${driveId}/assessment`;

function normalizeAssessment(raw: Raw): Assessment {
  const stats = raw.stats as Raw;
  return {
    id: raw.id as string,
    title: raw.title as string,
    inviteMode: raw.invite_mode as Assessment["inviteMode"],
    locked: Boolean(raw.locked),
    codingEnabled: Boolean(raw.coding_enabled),
    stats: {
      invited: Number(stats.invited),
      started: Number(stats.started),
      submitted: Number(stats.submitted),
    },
    totalDurationMinutes: Number(raw.total_duration_minutes),
    sections: ((raw.sections as Raw[]) ?? []).map((s) => ({
      position: Number(s.position),
      title: s.title as string,
      kind: s.kind as SectionKind,
      durationMinutes: Number(s.duration_minutes),
      questions: ((s.questions as Raw[]) ?? []).map((q) => ({
        position: Number(q.position),
        qtype: q.qtype as "mcq" | "coding",
        title: q.title as string,
        points: Number(q.points),
        problemId: (q.problem_id as string | null) ?? null,
      })),
    })),
  };
}

function normalizeRow(r: Raw): ResultRow {
  return {
    applicationId: r.application_id as string,
    name: r.name as string,
    email: (r.email as string | null) ?? null,
    invited: Boolean(r.invited),
    state: r.state as ResultRow["state"],
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    percent: r.percent == null ? null : Number(r.percent),
    startedAt: (r.started_at as string | null) ?? null,
    submittedAt: (r.submitted_at as string | null) ?? null,
    timeTakenSeconds: r.time_taken_seconds == null ? null : Number(r.time_taken_seconds),
    tabSwitches: Number(r.tab_switches ?? 0),
    fullscreenExits: Number(r.fullscreen_exits ?? 0),
    pasteEvents: Number(r.paste_events ?? 0),
    flagged: Boolean(r.flagged),
  };
}

function toPayload(d: AssessmentDraft): Raw {
  return {
    title: d.title,
    invite_mode: d.inviteMode,
    template: d.template ?? null,
    sections: d.template
      ? null
      : (d.sections ?? []).map((s) => ({
          title: s.title,
          kind: s.kind,
          duration_minutes: s.durationMinutes,
          questions: s.questions.map((q) => {
            if (q.problemId) return { problem_id: q.problemId, points: q.points ?? null };
            const m = q.mcq!;
            // Drop blank options and re-point the "correct" marker at the survivor.
            const kept = m.options
              .map((text, i) => ({ text: text.trim(), i }))
              .filter((o) => o.text);
            return {
              points: q.points ?? m.points,
              mcq: {
                title: m.title,
                prompt: m.prompt,
                options: kept.map((o) => o.text),
                correct_option: Math.max(
                  0,
                  kept.findIndex((o) => o.i === m.correctOption),
                ),
                points: m.points,
              },
            };
          }),
        })),
  };
}

export const companyAssessmentService = {
  listProblems: (
    params: { q?: string; difficulty?: string; topic?: string } = {},
  ): Promise<LibraryProblem[]> => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    return request<Raw[]>(`/company/oa/problems${qs.size ? `?${qs}` : ""}`).then((rows) =>
      rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        difficulty: (r.difficulty as LibraryProblem["difficulty"]) ?? null,
        topics: (r.topics as string[]) ?? [],
        languages: (r.languages as string[]) ?? [],
      })),
    );
  },

  previewProblem: (id: string): Promise<ProblemPreview> =>
    request<Raw>(`/company/oa/problems/${id}`).then((r) => ({
      id: r.id as string,
      title: r.title as string,
      difficulty: (r.difficulty as ProblemPreview["difficulty"]) ?? null,
      topics: (r.topics as string[]) ?? [],
      languages: (r.languages as string[]) ?? [],
      statementHtml: r.statement_html as string,
      constraintsHtml: (r.constraints_html as string) ?? "",
      examples: ((r.examples as Raw[]) ?? []).map((e) => ({
        input: e.input as string,
        expected: e.expected,
      })),
      hiddenTestCount: Number(r.hidden_test_count),
    })),

  get: (jobId: string, driveId: string): Promise<Assessment | null> =>
    request<Raw | null>(base(jobId, driveId)).then((r) => (r ? normalizeAssessment(r) : null)),

  save: (jobId: string, driveId: string, draft: AssessmentDraft): Promise<Assessment> =>
    request<Raw>(base(jobId, driveId), { method: "PUT", body: toPayload(draft) }).then(
      normalizeAssessment,
    ),

  remove: (jobId: string, driveId: string): Promise<void> =>
    request<unknown>(base(jobId, driveId), { method: "DELETE" }).then(() => undefined),

  listInvites: (jobId: string, driveId: string): Promise<InviteRow[]> =>
    request<Raw[]>(`${base(jobId, driveId)}/invites`).then((rows) =>
      rows.map((r) => ({
        applicationId: r.application_id as string,
        name: r.name as string,
        email: (r.email as string | null) ?? null,
        invited: Boolean(r.invited),
        emailStatus: (r.email_status as InviteRow["emailStatus"]) ?? null,
        attempt: (r.attempt as InviteRow["attempt"]) ?? null,
      })),
    ),

  invite: (
    jobId: string,
    driveId: string,
    body: { all?: boolean; applicationIds?: string[] },
  ): Promise<InviteResult> =>
    request<Raw>(`${base(jobId, driveId)}/invites`, {
      method: "POST",
      body: { all: body.all ?? false, application_ids: body.applicationIds ?? null },
    }).then((r) => ({
      invited: Number(r.invited),
      alreadyInvited: Number(r.already_invited),
      notEligible: Number(r.not_eligible),
      email: r.email as InviteResult["email"],
    })),

  resend: (jobId: string, driveId: string, applicationId: string): Promise<{ email: string }> =>
    request<{ email: string }>(`${base(jobId, driveId)}/invites/${applicationId}/resend`, {
      method: "POST",
    }),

  revoke: (jobId: string, driveId: string, applicationId: string): Promise<void> =>
    request<unknown>(`${base(jobId, driveId)}/invites/${applicationId}`, {
      method: "DELETE",
    }).then(() => undefined),

  remind: (
    jobId: string,
    driveId: string,
  ): Promise<{ sent: number; skipped: number; failed: number }> =>
    request(`${base(jobId, driveId)}/remind`, { method: "POST" }),

  results: (jobId: string, driveId: string): Promise<Results> =>
    request<Raw>(`${base(jobId, driveId)}/results`).then((r) => {
      const s = r.stats as Raw;
      return {
        rows: ((r.rows as Raw[]) ?? []).map(normalizeRow),
        stats: {
          invited: Number(s.invited),
          started: Number(s.started),
          submitted: Number(s.submitted),
          averagePercent: s.average_percent == null ? null : Number(s.average_percent),
          flagged: Number(s.flagged),
        },
      };
    }),

  resultDetail: (jobId: string, driveId: string, applicationId: string): Promise<ResultDetail> =>
    request<Raw>(`${base(jobId, driveId)}/results/${applicationId}`).then((r) => ({
      candidate: normalizeRow(r.candidate as Raw),
      assessmentTitle: r.assessment_title as string,
      sectionTitles: (r.section_titles as Record<number, string>) ?? {},
      questions: ((r.questions as Raw[]) ?? []).map((q) => ({
        section: (q.section as number | null) ?? null,
        position: Number(q.position),
        qtype: q.qtype as "mcq" | "coding",
        title: q.title as string,
        points: Number(q.points),
        options: (q.options as string[] | null) ?? null,
        correctOption: (q.correct_option as number | null) ?? null,
        chosenOption: (q.chosen_option as number | null) ?? null,
        bestScore: q.best_score == null ? undefined : Number(q.best_score),
        draft: (q.draft as { language: string | null; source: string | null } | null) ?? null,
        submissions: ((q.submissions as Raw[]) ?? []).map((s) => ({
          id: s.id as string,
          language: s.language as string,
          verdict: s.verdict as string,
          passed: Number(s.passed),
          total: Number(s.total),
          score: Number(s.score),
          createdAt: s.created_at as string,
          source: s.source as string,
        })),
      })),
    })),
};
