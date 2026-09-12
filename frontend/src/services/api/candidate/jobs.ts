/**
 * Jobs API service — candidate side.
 * Consumes the /candidate/jobs router. `request()` auto-attaches the Bearer token.
 *
 *   GET  /candidate/jobs                         the job board (domain + college filtered)
 *   GET  /candidate/jobs/{id}                    full JD detail (only if visible)
 *   POST /candidate/jobs/{id}/apply              apply → kicks off job-scoped scoring
 *   GET  /candidate/jobs/applications            the student's own application tracker
 *   GET  /candidate/jobs/applications/{id}       the student's own job-scoped analysis
 */

import { request } from "../client";
import type {
  Application,
  ApplicationAnalysis,
  ApplicationAnalysisJson,
  ApplicationRoundResult,
  ApplicationStatus,
  CollegeOption,
  DriveRound,
  JobBoardCard,
  JobDetail,
  JobDomain,
  JobEmploymentType,
  JobExperienceLevel,
  JobInterviewMode,
  PrepPlan,
  ApplicationDraft,
  ApplySubmission,
  RoundMode,
  RoundResultStatus,
  RoundType,
  ScreeningQuestion,
} from "@/types/jobs";

type Raw = Record<string, unknown>;

function normalizeCard(raw: Raw): JobBoardCard {
  return {
    id: raw.id as string,
    title: raw.title as string,
    companyName: raw.company_name as string,
    location: raw.location as string,
    domain: raw.domain as JobDomain,
    experienceLevel: raw.experience_level as JobExperienceLevel,
    deadline: raw.deadline as string,
    summary: raw.summary as string,
    alreadyApplied: Boolean(raw.already_applied),
    employmentType: (raw.employment_type as JobEmploymentType) ?? "full-time",
    ctcMin: raw.ctc_min == null ? null : Number(raw.ctc_min),
    ctcMax: raw.ctc_max == null ? null : Number(raw.ctc_max),
    ctcCurrency: (raw.ctc_currency as string | null) ?? "INR",
    isOnCampus: raw.is_on_campus === undefined ? true : Boolean(raw.is_on_campus),
    eligible: raw.eligible === undefined ? true : Boolean(raw.eligible),
    hasScreeningQuestions: Boolean(raw.has_screening_questions),
  };
}

function normalizeScreeningQuestion(raw: Raw): ScreeningQuestion {
  return {
    id: raw.id as string,
    questionText: raw.question_text as string,
    required: raw.required === undefined ? true : Boolean(raw.required),
    position: Number(raw.position ?? 0),
  };
}

function normalizeRound(raw: Raw): DriveRound {
  return {
    id: raw.id as string,
    driveId: raw.drive_id as string,
    roundNumber: Number(raw.round_number),
    roundType: raw.round_type as RoundType,
    mode: raw.mode as RoundMode,
    windowStart: (raw.window_start as string | null) ?? null,
    windowEnd: (raw.window_end as string | null) ?? null,
  };
}

function normalizeDetail(raw: Raw): JobDetail {
  return {
    ...normalizeCard(raw),
    description: raw.description as string,
    requiredSkills: (raw.required_skills as string[]) ?? [],
    openingsCount: Number(raw.openings_count ?? 1),
    applicationStatus: (raw.application_status as ApplicationStatus | null) ?? null,
    applicationId: (raw.application_id as string | null) ?? null,
    interviewMode: (raw.interview_mode as JobInterviewMode) ?? "ai",
    driveId: (raw.drive_id as string | null) ?? null,
    applyDeadline: (raw.apply_deadline as string | null) ?? null,
    oaWindowStart: (raw.oa_window_start as string | null) ?? null,
    oaWindowEnd: (raw.oa_window_end as string | null) ?? null,
    rounds: ((raw.rounds as Raw[]) ?? []).map(normalizeRound),
    ineligibleReason: (raw.ineligible_reason as string | null) ?? null,
    stipendMin: raw.stipend_min == null ? null : Number(raw.stipend_min),
    stipendMax: raw.stipend_max == null ? null : Number(raw.stipend_max),
    internshipDurationMonths:
      raw.internship_duration_months == null ? null : Number(raw.internship_duration_months),
    ppoCtcMin: raw.ppo_ctc_min == null ? null : Number(raw.ppo_ctc_min),
    ppoCtcMax: raw.ppo_ctc_max == null ? null : Number(raw.ppo_ctc_max),
    perks: (raw.perks as string[]) ?? [],
    screeningQuestions: ((raw.screening_questions as Raw[]) ?? []).map(normalizeScreeningQuestion),
  };
}

function normalizeApplication(raw: Raw): Application {
  return {
    id: raw.id as string,
    studentId: raw.student_id as string,
    jobId: raw.job_id as string,
    companyId: raw.company_id as string,
    status: raw.status as ApplicationStatus,
    appliedAt: raw.applied_at as string,
    updatedAt: raw.updated_at as string,
    jobTitle: (raw.job_title as string | null) ?? null,
    companyName: (raw.company_name as string | null) ?? null,
    placementProbability: (raw.placement_probability as number | null) ?? null,
    currentRound: (raw.current_round as number | null) ?? null,
    totalRounds: (raw.total_rounds as number | null) ?? null,
  };
}

function normalizeRoundResult(raw: Raw): ApplicationRoundResult {
  return {
    id: raw.id as string,
    applicationId: raw.application_id as string,
    roundId: raw.round_id as string,
    roundNumber: Number(raw.round_number),
    roundType: raw.round_type as RoundType,
    mode: raw.mode as RoundMode,
    status: raw.status as RoundResultStatus,
    roundScore: raw.round_score == null ? null : Number(raw.round_score),
    decidedAt: (raw.decided_at as string | null) ?? null,
    windowStart: (raw.window_start as string | null) ?? null,
    windowEnd: (raw.window_end as string | null) ?? null,
  };
}

function normalizeAnalysis(raw: Raw): ApplicationAnalysis {
  return {
    id: raw.id as string,
    applicationId: raw.application_id as string,
    studentId: raw.student_id as string,
    jobId: raw.job_id as string,
    companyId: raw.company_id as string,
    analysisJson: raw.analysis_json as ApplicationAnalysisJson,
    placementProbability: Number(raw.placement_probability),
    weightedComposite: Number(raw.weighted_composite),
    weightsSnapshot: raw.weights_snapshot as ApplicationAnalysis["weightsSnapshot"],
    generatedAt: raw.generated_at as string,
    coverLetter: (raw.cover_letter as string | null) ?? null,
    screeningAnswers: ((raw.screening_answers as Raw[]) ?? []).map((a) => ({
      questionText: a.question_text as string,
      required: Boolean(a.required),
      answer: (a.answer as string | null) ?? null,
    })),
  };
}

export const candidateJobsService = {
  listBoard: (): Promise<JobBoardCard[]> =>
    request<Raw[]>("/candidate/jobs").then((rows) => rows.map(normalizeCard)),

  getJob: (jobId: string): Promise<JobDetail> =>
    request<Raw>(`/candidate/jobs/${jobId}`).then(normalizeDetail),

  apply: (jobId: string, submission?: ApplySubmission): Promise<Application> =>
    request<Raw>(`/candidate/jobs/${jobId}/apply`, {
      method: "POST",
      body: submission
        ? {
            cover_letter: submission.coverLetter ?? null,
            screening_answers: submission.screeningAnswers.map((a) => ({
              question_id: a.questionId,
              answer: a.answer,
            })),
          }
        : undefined,
    }).then(normalizeApplication),

  // Drafts the cover letter + screener answers in one round trip. Only used
  // by the ApplicationFormModal (jobs that HAVE screening questions).
  createApplicationDraft: (jobId: string): Promise<ApplicationDraft> =>
    request<Raw>(`/candidate/jobs/${jobId}/application-drafts`, { method: "POST" }).then((raw) => ({
      coverLetter: (raw.cover_letter as string) ?? "",
      screeningAnswers: ((raw.screening_answers as Raw[]) ?? []).map((a) => ({
        questionId: a.question_id as string,
        questionText: a.question_text as string,
        required: a.required === undefined ? true : Boolean(a.required),
        answer: (a.answer as string) ?? "",
        studentInputRequired: Boolean(a.student_input_required),
      })),
    })),

  listMyApplications: (): Promise<Application[]> =>
    request<Raw[]>("/candidate/jobs/applications").then((rows) => rows.map(normalizeApplication)),

  getMyAnalysis: (applicationId: string): Promise<ApplicationAnalysis> =>
    request<Raw>(`/candidate/jobs/applications/${applicationId}`).then(normalizeAnalysis),

  listMyApplicationRounds: (applicationId: string): Promise<ApplicationRoundResult[]> =>
    request<Raw[]>(`/candidate/jobs/applications/${applicationId}/rounds`).then((rows) =>
      rows.map(normalizeRoundResult),
    ),

  // Same source as the company drive-college picker (public.colleges) so a
  // student's saved college resolves to the row a drive is attached to.
  listColleges: (): Promise<CollegeOption[]> =>
    request<Raw[]>("/candidate/jobs/options/colleges").then((rows) =>
      rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        city: (r.city as string | null) ?? null,
        state: (r.state as string | null) ?? null,
      })),
    ),

  // Personalized prep plan for one application. Cached server-side; pass
  // refresh=true to regenerate.
  getPrepPlan: (applicationId: string, refresh = false): Promise<PrepPlan> =>
    request<Raw>(
      `/candidate/jobs/applications/${applicationId}/prep-plan${refresh ? "?refresh=true" : ""}`,
    ).then((raw) => {
      const pf = (raw.priority_focus as Raw) ?? {};
      return {
        applicationId: raw.application_id as string,
        headline: raw.headline as string,
        standingSummary: raw.standing_summary as string,
        priorityFocus: {
          title: (pf.title as string) ?? "",
          why: (pf.why as string) ?? "",
        },
        phases: ((raw.phases as Raw[]) ?? []).map((p) => ({
          name: p.name as string,
          applies: Boolean(p.applies),
          timeframe: p.timeframe as string,
          actionItems: (p.action_items as string[]) ?? [],
        })),
        estimatedPrepTime: raw.estimated_prep_time as string,
        generatedAt: raw.generated_at as string,
      };
    }),
};
