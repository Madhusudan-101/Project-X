/**
 * Jobs (job posting) API service — company side.
 * Consumes the /company/jobs router. `request()` auto-attaches the Bearer token.
 *
 *   POST   /company/jobs                              create (draft, or live if publish=true)
 *   GET    /company/jobs[?status=]                    list own jobs
 *   GET    /company/jobs/{id}                         one job (with weights)
 *   PATCH  /company/jobs/{id}                         edit
 *   POST   /company/jobs/{id}/publish                 draft → live
 *   POST   /company/jobs/{id}/close                   → closed
 *   POST   /company/jobs/draft-description            Gemini JD draft
 *   GET    /company/jobs/options/colleges             college list for restricted visibility
 *   GET    /company/jobs/{jobId}/applicants[?sort_by=] ranked candidates
 *   GET    /company/jobs/{jobId}/applicants/{appId}   full job-scoped analysis
 *   PATCH  /company/jobs/{jobId}/applicants/{appId}/status
 */

import { request } from "../client";
import type {
  Application,
  ApplicationAnalysis,
  ApplicationAnalysisJson,
  ApplicationStatus,
  CollegeOption,
  Job,
  JobCreatePayload,
  JobDomain,
  JobEmploymentType,
  JobExperienceLevel,
  JobInterviewDuration,
  JobInterviewMode,
  JobStatus,
  JobUpdatePayload,
  JobVisibility,
  JobWeights,
  RankedApplicant,
} from "@/types/jobs";

type Raw = Record<string, unknown>;

// ── snake_case DB → camelCase TS ─────────────────────────────────────

function normalizeWeights(raw: Raw | null | undefined): JobWeights | null {
  if (!raw) return null;
  return {
    resumeWeight: Number(raw.resume_weight ?? 0),
    githubWeight: Number(raw.github_weight ?? 0),
    leetcodeWeight: Number(raw.leetcode_weight ?? 0),
    interviewWeight: Number(raw.interview_weight ?? 0),
    assessmentWeight: Number(raw.assessment_weight ?? 0),
  };
}

function toWeightsPayload(w: JobWeights) {
  return {
    resume_weight: w.resumeWeight,
    github_weight: w.githubWeight,
    leetcode_weight: w.leetcodeWeight,
    interview_weight: w.interviewWeight,
    assessment_weight: w.assessmentWeight,
  };
}

function normalizeJob(raw: Raw): Job {
  return {
    id: raw.id as string,
    companyId: raw.company_id as string,
    title: raw.title as string,
    description: raw.description as string,
    domain: raw.domain as JobDomain,
    experienceLevel: raw.experience_level as JobExperienceLevel,
    location: raw.location as string,
    openingsCount: Number(raw.openings_count ?? 1),
    deadline: raw.deadline as string,
    visibility: raw.visibility as JobVisibility,
    status: raw.status as JobStatus,
    skills: (raw.skills as string[]) ?? [],
    visibleCollegeIds: (raw.visible_college_ids as string[]) ?? [],
    weights: normalizeWeights(raw.weights as Raw | null),
    applicationCount: Number(raw.application_count ?? 0),
    employmentType: (raw.employment_type as JobEmploymentType) ?? "full-time",
    interviewDurationMinutes: Number(raw.interview_duration_minutes ?? 30) as JobInterviewDuration,
    interviewMode: (raw.interview_mode as JobInterviewMode) ?? "ai",
    isOnCampus: raw.is_on_campus === undefined ? true : Boolean(raw.is_on_campus),
    minCgpa: raw.min_cgpa == null ? null : Number(raw.min_cgpa),
    eligibleBranches: (raw.eligible_branches as string[]) ?? [],
    eligibleBatchYears: (raw.eligible_batch_years as number[]) ?? [],
    ctcMin: raw.ctc_min == null ? null : Number(raw.ctc_min),
    ctcMax: raw.ctc_max == null ? null : Number(raw.ctc_max),
    ctcCurrency: (raw.ctc_currency as string | null) ?? "INR",
    stipendMin: raw.stipend_min == null ? null : Number(raw.stipend_min),
    stipendMax: raw.stipend_max == null ? null : Number(raw.stipend_max),
    internshipDurationMonths:
      raw.internship_duration_months == null ? null : Number(raw.internship_duration_months),
    ppoCtcMin: raw.ppo_ctc_min == null ? null : Number(raw.ppo_ctc_min),
    ppoCtcMax: raw.ppo_ctc_max == null ? null : Number(raw.ppo_ctc_max),
    perks: (raw.perks as string[]) ?? [],
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
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
  };
}

function normalizeRanked(raw: Raw): RankedApplicant {
  return {
    applicationId: raw.application_id as string,
    studentId: raw.student_id as string,
    studentName: (raw.student_name as string | null) ?? null,
    studentEmail: (raw.student_email as string | null) ?? null,
    status: raw.status as ApplicationStatus,
    appliedAt: raw.applied_at as string,
    placementProbability: (raw.placement_probability as number | null) ?? null,
    weightedComposite: (raw.weighted_composite as number | null) ?? null,
    hasAnalysis: Boolean(raw.has_analysis),
  };
}

function toJobPayload(p: JobCreatePayload | JobUpdatePayload) {
  const body: Record<string, unknown> = {};
  if (p.title !== undefined) body.title = p.title;
  if (p.description !== undefined) body.description = p.description;
  if (p.domain !== undefined) body.domain = p.domain;
  if (p.experienceLevel !== undefined) body.experience_level = p.experienceLevel;
  if (p.location !== undefined) body.location = p.location;
  if (p.openingsCount !== undefined) body.openings_count = p.openingsCount;
  if (p.deadline !== undefined) body.deadline = p.deadline;
  if (p.visibility !== undefined) body.visibility = p.visibility;
  if (p.skills !== undefined) body.skills = p.skills;
  if (p.visibleCollegeIds !== undefined) body.visible_college_ids = p.visibleCollegeIds;
  if (p.weights !== undefined && p.weights) body.weights = toWeightsPayload(p.weights);
  if ("publish" in p && p.publish !== undefined) body.publish = p.publish;
  // Eligibility & offer detail
  if (p.employmentType !== undefined) body.employment_type = p.employmentType;
  if (p.interviewDurationMinutes !== undefined)
    body.interview_duration_minutes = p.interviewDurationMinutes;
  if (p.interviewMode !== undefined) body.interview_mode = p.interviewMode;
  if (p.isOnCampus !== undefined) body.is_on_campus = p.isOnCampus;
  if (p.minCgpa !== undefined) body.min_cgpa = p.minCgpa;
  if (p.eligibleBranches !== undefined) body.eligible_branches = p.eligibleBranches;
  if (p.eligibleBatchYears !== undefined) body.eligible_batch_years = p.eligibleBatchYears;
  if (p.ctcMin !== undefined) body.ctc_min = p.ctcMin;
  if (p.ctcMax !== undefined) body.ctc_max = p.ctcMax;
  if (p.ctcCurrency !== undefined) body.ctc_currency = p.ctcCurrency;
  if (p.stipendMin !== undefined) body.stipend_min = p.stipendMin;
  if (p.stipendMax !== undefined) body.stipend_max = p.stipendMax;
  if (p.internshipDurationMonths !== undefined)
    body.internship_duration_months = p.internshipDurationMonths;
  if (p.ppoCtcMin !== undefined) body.ppo_ctc_min = p.ppoCtcMin;
  if (p.ppoCtcMax !== undefined) body.ppo_ctc_max = p.ppoCtcMax;
  if (p.perks !== undefined) body.perks = p.perks;
  return body;
}

// ── Service ─────────────────────────────────────────────────────────

export const jobsService = {
  create: (payload: JobCreatePayload): Promise<Job> =>
    request<Raw>("/company/jobs", {
      method: "POST",
      body: toJobPayload(payload),
    }).then(normalizeJob),

  list: (status?: JobStatus): Promise<Job[]> =>
    request<Raw[]>(
      status ? `/company/jobs?status=${encodeURIComponent(status)}` : "/company/jobs",
    ).then((rows) => rows.map(normalizeJob)),

  getById: (jobId: string): Promise<Job> =>
    request<Raw>(`/company/jobs/${jobId}`).then(normalizeJob),

  update: (jobId: string, payload: JobUpdatePayload): Promise<Job> =>
    request<Raw>(`/company/jobs/${jobId}`, {
      method: "PATCH",
      body: toJobPayload(payload),
    }).then(normalizeJob),

  publish: (jobId: string): Promise<Job> =>
    request<Raw>(`/company/jobs/${jobId}/publish`, { method: "POST" }).then(normalizeJob),

  close: (jobId: string): Promise<Job> =>
    request<Raw>(`/company/jobs/${jobId}/close`, { method: "POST" }).then(normalizeJob),

  draftDescription: (input: {
    brief: string;
    title?: string;
    domain?: string;
    experienceLevel?: string;
    location?: string;
    skills?: string[];
  }): Promise<string> =>
    request<{ description: string }>("/company/jobs/draft-description", {
      method: "POST",
      body: {
        brief: input.brief,
        title: input.title,
        domain: input.domain,
        experience_level: input.experienceLevel,
        location: input.location,
        skills: input.skills ?? [],
      },
    }).then((r) => r.description),

  listColleges: (): Promise<CollegeOption[]> =>
    request<Raw[]>("/company/jobs/options/colleges").then((rows) =>
      rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        city: (r.city as string | null) ?? null,
        state: (r.state as string | null) ?? null,
      })),
    ),

  listApplicants: (
    jobId: string,
    sortBy: "placement_probability" | "weighted_composite" = "placement_probability",
  ): Promise<RankedApplicant[]> =>
    request<Raw[]>(`/company/jobs/${jobId}/applicants?sort_by=${sortBy}`).then((rows) =>
      rows.map(normalizeRanked),
    ),

  getApplicantAnalysis: (jobId: string, applicationId: string): Promise<ApplicationAnalysis> =>
    request<Raw>(`/company/jobs/${jobId}/applicants/${applicationId}`).then(normalizeAnalysis),

  updateApplicantStatus: (
    jobId: string,
    applicationId: string,
    status: ApplicationStatus,
  ): Promise<Application> =>
    request<Raw>(`/company/jobs/${jobId}/applicants/${applicationId}/status`, {
      method: "PATCH",
      body: { status },
    }).then(normalizeApplication),
};
