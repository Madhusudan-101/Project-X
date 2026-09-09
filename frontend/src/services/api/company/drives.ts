/**
 * Job drives API service — company side.
 * Consumes the /company/jobs/{jobId}/drives + /company/drive-templates +
 * /company/dashboard/funnel routes.
 *
 *   POST   /company/jobs/{jobId}/drives                       create a drive
 *   GET    /company/jobs/{jobId}/drives                       list drives for a job
 *   GET    /company/jobs/{jobId}/drives/{driveId}             one drive
 *   PATCH  /company/jobs/{jobId}/drives/{driveId}             edit dates / eligibility
 *   POST   /company/jobs/{jobId}/drives/{driveId}/publish     draft → live
 *   POST   /company/jobs/{jobId}/drives/{driveId}/close       → closed
 *   POST   /company/jobs/{jobId}/drives/{driveId}/clone       duplicate to another college
 *   POST   /company/jobs/{jobId}/drives/{driveId}/rounds      add a round
 *   PATCH  .../rounds/{roundId}                               edit a round
 *   GET    .../rounds/{roundId}/applicants[?sort_by=]         ranked list for one round
 *   POST   .../rounds/{roundId}/applicants/{appId}/status     manual shortlist / reject
 *   POST   .../apply-template                                 fill rounds from a template
 *   POST   /company/drive-templates                           create a template
 *   GET    /company/drive-templates                           list own templates
 *   GET    /company/dashboard/funnel                          aggregate funnel counts
 */

import { request } from "../client";
import type {
  ApplyTemplatePayload,
  CompanyFunnel,
  DriveClonePayload,
  DrivePayload,
  DriveRound,
  DriveRoundPayload,
  DriveTemplate,
  DriveTemplatePayload,
  DriveUpdatePayload,
  JobDrive,
  JobInterviewMode,
  RoundApplicant,
  RoundMode,
  RoundResultStatus,
  RoundType,
} from "@/types/jobs";

type Raw = Record<string, unknown>;

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

function normalizeDrive(raw: Raw): JobDrive {
  return {
    id: raw.id as string,
    jobId: raw.job_id as string,
    collegeId: raw.college_id as string,
    collegeName: (raw.college_name as string | null) ?? null,
    status: raw.status as JobDrive["status"],
    isOnCampus: raw.is_on_campus === undefined ? true : Boolean(raw.is_on_campus),
    applyDeadline: raw.apply_deadline as string,
    oaWindowStart: (raw.oa_window_start as string | null) ?? null,
    oaWindowEnd: (raw.oa_window_end as string | null) ?? null,
    minCgpa: raw.min_cgpa == null ? null : Number(raw.min_cgpa),
    eligibleBranches: (raw.eligible_branches as string[]) ?? [],
    eligibleBatchYears: (raw.eligible_batch_years as number[]) ?? [],
    rounds: ((raw.rounds as Raw[]) ?? []).map(normalizeRound),
    applicantCount: Number(raw.applicant_count ?? 0),
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

function normalizeTemplate(raw: Raw): DriveTemplate {
  return {
    id: raw.id as string,
    companyId: raw.company_id as string,
    name: raw.name as string,
    interviewMode: (raw.interview_mode as JobInterviewMode | null) ?? null,
    roundsJson: ((raw.rounds_json as Raw[]) ?? []).map((r) => ({
      roundNumber: Number(r.round_number),
      roundType: r.round_type as RoundType,
      mode: r.mode as RoundMode,
    })),
    defaultMinCgpa: raw.default_min_cgpa == null ? null : Number(raw.default_min_cgpa),
    defaultEligibleBranches: (raw.default_eligible_branches as string[]) ?? [],
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

function normalizeRoundApplicant(raw: Raw): RoundApplicant {
  return {
    applicationId: raw.application_id as string,
    studentId: raw.student_id as string,
    studentName: (raw.student_name as string | null) ?? null,
    studentEmail: (raw.student_email as string | null) ?? null,
    appliedAt: raw.applied_at as string,
    roundStatus: raw.round_status as RoundResultStatus,
    roundScore: raw.round_score == null ? null : Number(raw.round_score),
    placementProbability: (raw.placement_probability as number | null) ?? null,
    weightedComposite: (raw.weighted_composite as number | null) ?? null,
    hasAnalysis: Boolean(raw.has_analysis),
    decidedAt: (raw.decided_at as string | null) ?? null,
  };
}

function drivePayloadBody(p: DrivePayload): Raw {
  return {
    college_id: p.collegeId,
    is_on_campus: p.isOnCampus,
    apply_deadline: p.applyDeadline,
    oa_window_start: p.oaWindowStart ?? null,
    oa_window_end: p.oaWindowEnd ?? null,
    min_cgpa: p.minCgpa ?? null,
    eligible_branches: p.eligibleBranches ?? null,
    eligible_batch_years: p.eligibleBatchYears ?? null,
    rounds: (p.rounds ?? []).map(roundPayloadBody),
  };
}

function driveUpdateBody(p: DriveUpdatePayload): Raw {
  const body: Raw = {};
  if (p.isOnCampus !== undefined) body.is_on_campus = p.isOnCampus;
  if (p.applyDeadline !== undefined) body.apply_deadline = p.applyDeadline;
  if (p.oaWindowStart !== undefined) body.oa_window_start = p.oaWindowStart;
  if (p.oaWindowEnd !== undefined) body.oa_window_end = p.oaWindowEnd;
  if (p.minCgpa !== undefined) body.min_cgpa = p.minCgpa;
  if (p.eligibleBranches !== undefined) body.eligible_branches = p.eligibleBranches;
  if (p.eligibleBatchYears !== undefined) body.eligible_batch_years = p.eligibleBatchYears;
  return body;
}

function roundPayloadBody(r: DriveRoundPayload): Raw {
  return {
    round_number: r.roundNumber,
    round_type: r.roundType,
    mode: r.mode,
    window_start: r.windowStart ?? null,
    window_end: r.windowEnd ?? null,
  };
}

export const drivesService = {
  list: (jobId: string): Promise<JobDrive[]> =>
    request<Raw[]>(`/company/jobs/${jobId}/drives`).then((rows) => rows.map(normalizeDrive)),

  get: (jobId: string, driveId: string): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}`).then(normalizeDrive),

  create: (jobId: string, payload: DrivePayload): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives`, {
      method: "POST",
      body: drivePayloadBody(payload),
    }).then(normalizeDrive),

  update: (jobId: string, driveId: string, payload: DriveUpdatePayload): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}`, {
      method: "PATCH",
      body: driveUpdateBody(payload),
    }).then(normalizeDrive),

  publish: (jobId: string, driveId: string): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/publish`, { method: "POST" }).then(
      normalizeDrive,
    ),

  close: (jobId: string, driveId: string): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/close`, { method: "POST" }).then(
      normalizeDrive,
    ),

  clone: (jobId: string, driveId: string, payload: DriveClonePayload): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/clone`, {
      method: "POST",
      body: {
        target_college_id: payload.targetCollegeId,
        apply_deadline: payload.applyDeadline,
        oa_window_start: payload.oaWindowStart ?? null,
        oa_window_end: payload.oaWindowEnd ?? null,
        round_dates: payload.roundDates,
      },
    }).then(normalizeDrive),

  addRound: (jobId: string, driveId: string, payload: DriveRoundPayload): Promise<DriveRound> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/rounds`, {
      method: "POST",
      body: roundPayloadBody(payload),
    }).then(normalizeRound),

  updateRound: (
    jobId: string,
    driveId: string,
    roundId: string,
    payload: DriveRoundPayload,
  ): Promise<DriveRound> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/rounds/${roundId}`, {
      method: "PATCH",
      body: roundPayloadBody(payload),
    }).then(normalizeRound),

  applyTemplate: (
    jobId: string,
    driveId: string,
    payload: ApplyTemplatePayload,
  ): Promise<JobDrive> =>
    request<Raw>(`/company/jobs/${jobId}/drives/${driveId}/apply-template`, {
      method: "POST",
      body: {
        template_id: payload.templateId,
        apply_deadline: payload.applyDeadline ?? null,
        oa_window_start: payload.oaWindowStart ?? null,
        oa_window_end: payload.oaWindowEnd ?? null,
        round_dates: payload.roundDates,
      },
    }).then(normalizeDrive),

  listRoundApplicants: (
    jobId: string,
    driveId: string,
    roundId: string,
    sortBy: "round_score" | "applied_at" = "round_score",
  ): Promise<RoundApplicant[]> =>
    request<Raw[]>(
      `/company/jobs/${jobId}/drives/${driveId}/rounds/${roundId}/applicants?sort_by=${sortBy}`,
    ).then((rows) => rows.map(normalizeRoundApplicant)),

  setRoundStatus: (
    jobId: string,
    driveId: string,
    roundId: string,
    applicationId: string,
    status: Exclude<RoundResultStatus, "pending">,
  ): Promise<RoundApplicant> =>
    request<Raw>(
      `/company/jobs/${jobId}/drives/${driveId}/rounds/${roundId}/applicants/${applicationId}/status`,
      { method: "POST", body: { status } },
    ).then(normalizeRoundApplicant),
};

export const driveTemplatesService = {
  list: (): Promise<DriveTemplate[]> =>
    request<Raw[]>("/company/drive-templates").then((rows) => rows.map(normalizeTemplate)),

  create: (payload: DriveTemplatePayload): Promise<DriveTemplate> =>
    request<Raw>("/company/drive-templates", {
      method: "POST",
      body: {
        name: payload.name,
        interview_mode: payload.interviewMode ?? null,
        rounds_json: payload.roundsJson.map((r) => ({
          round_number: r.roundNumber,
          round_type: r.roundType,
          mode: r.mode,
        })),
        default_min_cgpa: payload.defaultMinCgpa ?? null,
        default_eligible_branches: payload.defaultEligibleBranches ?? null,
      },
    }).then(normalizeTemplate),
};

export const companyDashboardService = {
  funnel: (): Promise<CompanyFunnel> =>
    request<Raw>("/company/dashboard/funnel").then((raw) => ({
      newApplications: Number(raw.new_applications ?? 0),
      shortlisted: Number(raw.shortlisted ?? 0),
      inInterview: Number(raw.in_interview ?? 0),
      hired: Number(raw.hired ?? 0),
    })),
};
