/**
 * Online Assessment API service — candidate side.
 * Consumes the /candidate/oa router. Timing is server-authoritative: the
 * client only renders a countdown from `deadline`.
 *
 *   GET  /candidate/oa                                  my assessments
 *   GET  /candidate/oa/{applicationId}                  instructions-page payload
 *   POST /candidate/oa/{applicationId}/start            begin the attempt
 *   GET  /candidate/oa/{applicationId}/session          current section + questions
 *   PUT  /candidate/oa/{applicationId}/answers          autosave one answer
 *   POST /candidate/oa/{applicationId}/sections/submit  close the current section
 *   POST /candidate/oa/{applicationId}/events           integrity signal (tab switch / fullscreen exit / paste)
 *   POST /candidate/oa/{applicationId}/questions/{qid}/run     run visible examples (+ custom input)
 *   POST /candidate/oa/{applicationId}/questions/{qid}/submit  grade against all tests
 */

import { request } from "../client";
import type {
  OACaseResult,
  OAEventType,
  OAListItem,
  OAOverview,
  OAQuestion,
  OARunResult,
  OASection,
  OASession,
  OAState,
  OASubmitResult,
  CodeLanguage,
} from "@/types/candidate/assessment";

type Raw = Record<string, unknown>;

function normalizeQuestion(raw: Raw): OAQuestion {
  return {
    id: raw.id as string,
    position: Number(raw.position),
    qtype: raw.qtype as OAQuestion["qtype"],
    title: raw.title as string,
    prompt: raw.prompt as string,
    options: (raw.options as string[] | null) ?? null,
    starterCode: (raw.starter_code as Record<string, string> | null) ?? null,
    points: Number(raw.points),
    promptFormat: (raw.prompt_format as OAQuestion["promptFormat"]) ?? "markdown",
    problem: raw.problem
      ? {
          id: (raw.problem as Raw).id as string,
          functionName: (raw.problem as Raw).function_name as string,
          languages: ((raw.problem as Raw).languages as CodeLanguage[]) ?? [],
          constraintsHtml: ((raw.problem as Raw).constraints_html as string) ?? "",
          examples: (((raw.problem as Raw).examples as Raw[]) ?? []).map((e) => ({
            input: e.input as string,
            expected: e.expected as string,
          })),
        }
      : null,
    answer: (raw.answer as string | null) ?? null,
    language: (raw.language as string | null) ?? null,
  };
}

function normalizeSession(raw: Raw): OASession {
  const s = raw.section as Raw | null;
  return {
    status: raw.status as OASession["status"],
    serverTime: raw.server_time as string,
    codingEnabled: Boolean(raw.coding_enabled),
    section: s
      ? {
          position: Number(s.position),
          totalSections: Number(s.total_sections),
          title: s.title as string,
          kind: s.kind as OASection["kind"],
          durationMinutes: Number(s.duration_minutes),
          deadline: s.deadline as string,
          questions: ((s.questions as Raw[]) ?? []).map(normalizeQuestion),
        }
      : null,
  };
}

function normalizeOverview(raw: Raw): OAOverview {
  const a = raw.attempt as Raw | null;
  return {
    applicationId: raw.application_id as string,
    jobTitle: raw.job_title as string,
    companyName: raw.company_name as string,
    assessmentTitle: raw.assessment_title as string,
    state: raw.state as OAState,
    windowStart: (raw.window_start as string | null) ?? null,
    windowEnd: (raw.window_end as string | null) ?? null,
    serverTime: raw.server_time as string,
    totalDurationMinutes: Number(raw.total_duration_minutes),
    totalQuestions: Number(raw.total_questions),
    codingEnabled: Boolean(raw.coding_enabled),
    sections: ((raw.sections as Raw[]) ?? []).map((s) => ({
      position: Number(s.position),
      title: s.title as string,
      kind: s.kind as OASection["kind"],
      questionCount: Number(s.question_count),
      durationMinutes: Number(s.duration_minutes),
    })),
    attempt: a
      ? {
          status: a.status as "in_progress" | "submitted",
          currentSection: Number(a.current_section),
          startedAt: a.started_at as string,
          submittedAt: (a.submitted_at as string | null) ?? null,
        }
      : null,
  };
}

function normalizeCase(c: Raw): OACaseResult {
  return {
    label: c.label as string,
    status: c.status as OACaseResult["status"],
    input: c.input as string,
    expected: (c.expected as string | null) ?? null,
    actual: (c.actual as string | null) ?? null,
    error: (c.error as string | null) ?? null,
  };
}

function normalizeRun(raw: Raw): OARunResult {
  return {
    verdict: raw.verdict as OARunResult["verdict"],
    compileError: (raw.compile_error as string | null) ?? null,
    crash: (raw.crash as string | null) ?? null,
    stdout: (raw.stdout as string) ?? "",
    cases: ((raw.cases as Raw[]) ?? []).map(normalizeCase),
  };
}

export const candidateAssessmentService = {
  list: (): Promise<OAListItem[]> =>
    request<Raw[]>("/candidate/oa").then((rows) =>
      rows.map((r) => ({
        applicationId: r.application_id as string,
        jobTitle: r.job_title as string,
        companyName: r.company_name as string,
        state: r.state as OAState,
        windowStart: (r.window_start as string | null) ?? null,
        windowEnd: (r.window_end as string | null) ?? null,
      })),
    ),

  getOverview: (applicationId: string): Promise<OAOverview> =>
    request<Raw>(`/candidate/oa/${applicationId}`).then(normalizeOverview),

  start: (applicationId: string): Promise<OASession> =>
    request<Raw>(`/candidate/oa/${applicationId}/start`, { method: "POST" }).then(normalizeSession),

  getSession: (applicationId: string): Promise<OASession> =>
    request<Raw>(`/candidate/oa/${applicationId}/session`).then(normalizeSession),

  saveAnswer: (
    applicationId: string,
    body: { questionId: string; answer: string | null; language?: string | null },
  ): Promise<void> =>
    request<unknown>(`/candidate/oa/${applicationId}/answers`, {
      method: "PUT",
      body: { question_id: body.questionId, answer: body.answer, language: body.language ?? null },
    }).then(() => undefined),

  submitSection: (applicationId: string): Promise<OASession> =>
    request<Raw>(`/candidate/oa/${applicationId}/sections/submit`, { method: "POST" }).then(
      normalizeSession,
    ),

  reportEvent: (applicationId: string, type: OAEventType): Promise<void> =>
    request<unknown>(`/candidate/oa/${applicationId}/events`, {
      method: "POST",
      body: { type },
    }).then(() => undefined),

  runCode: (
    applicationId: string,
    questionId: string,
    body: { language: CodeLanguage; source: string; customArgs?: unknown[] | null },
  ): Promise<OARunResult> =>
    request<Raw>(`/candidate/oa/${applicationId}/questions/${questionId}/run`, {
      method: "POST",
      body: { language: body.language, source: body.source, custom_args: body.customArgs ?? null },
    }).then(normalizeRun),

  submitCode: (
    applicationId: string,
    questionId: string,
    body: { language: CodeLanguage; source: string },
  ): Promise<OASubmitResult> =>
    request<Raw>(`/candidate/oa/${applicationId}/questions/${questionId}/submit`, {
      method: "POST",
      body: { language: body.language, source: body.source },
    }).then((raw) => ({
      ...normalizeRun(raw),
      passed: Number(raw.passed),
      total: Number(raw.total),
      hiddenPassed: Number(raw.hidden_passed),
      hiddenTotal: Number(raw.hidden_total),
      score: Number(raw.score),
      points: Number(raw.points),
      submissionsLeft: Number(raw.submissions_left),
    })),
};
