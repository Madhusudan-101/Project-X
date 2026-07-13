/**
 * Roles (job posting) API service.
 * All calls use the existing `request()` client which auto-attaches the Bearer token.
 *
 * Endpoints consumed (roles router, /company/roles — company role required):
 *   POST   /company/roles                — create a role (starts in 'draft')
 *   GET    /company/roles                — list the company's roles
 *   GET    /company/roles/{id}           — fetch a single role
 *   PATCH  /company/roles/{id}           — edit a role
 *   DELETE /company/roles/{id}           — delete a role
 *   POST   /company/roles/{id}/publish   — publish a role
 *   POST   /company/roles/{id}/archive   — archive a role
 *   POST   /company/roles/extract-jd     — upload a JD PDF, get AI-extracted fields
 */

import { request } from "./client";
import type {
  JdExtractionResult,
  Role,
  RoleCreatePayload,
  RoleStatus,
  RoleUpdatePayload,
} from "@/types/role";

// ── Shape helpers (snake_case DB → camelCase TS) ───────────────────────

function normalizeRole(raw: Record<string, unknown>): Role {
  return {
    id: raw.id as string,
    companyId: raw.company_id as string,
    title: raw.title as string,
    description: raw.description as string,
    requiredSkills: (raw.required_skills as string[]) ?? [],
    experienceLevel: raw.experience_level as string,
    roleType: (raw.role_type as string | null) ?? null,
    preferredQualifications: (raw.preferred_qualifications as string[]) ?? [],
    deadline: raw.deadline as string,
    minimumEmployabilityScore: Number(raw.minimum_employability_score ?? 0),
    status: raw.status as RoleStatus,
    jobDescriptionPath: (raw.job_description_path as string | null) ?? null,
    resumeWeight: Number(raw.resume_weight ?? 20),
    githubWeight: Number(raw.github_weight ?? 20),
    leetcodeWeight: Number(raw.leetcode_weight ?? 20),
    interviewWeight: Number(raw.interview_weight ?? 20),
    assessmentWeight: Number(raw.assessment_weight ?? 20),
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

function normalizeJdExtraction(raw: Record<string, unknown>): JdExtractionResult {
  return {
    storagePath: raw.storage_path as string,
    title: (raw.title as string) ?? "",
    description: (raw.description as string) ?? "",
    requiredSkills: (raw.required_skills as string[]) ?? [],
    experienceLevel: (raw.experience_level as string) ?? "",
    roleType: (raw.role_type as string) ?? "",
    preferredQualifications: (raw.preferred_qualifications as string[]) ?? [],
    warnings: (raw.warnings as string[]) ?? [],
  };
}

// ── Service ────────────────────────────────────────────────────────────

export const rolesService = {
  /** Create a new role for the authenticated company (starts in 'draft'). */
  create: (payload: RoleCreatePayload): Promise<Role> =>
    request<Record<string, unknown>>("/company/roles", {
      method: "POST",
      body: {
        title: payload.title,
        description: payload.description,
        required_skills: payload.requiredSkills,
        experience_level: payload.experienceLevel,
        ...(payload.roleType !== undefined && { role_type: payload.roleType }),
        ...(payload.preferredQualifications !== undefined && {
          preferred_qualifications: payload.preferredQualifications,
        }),
        deadline: payload.deadline,
        minimum_employability_score: payload.minimumEmployabilityScore,
        ...(payload.jobDescriptionPath !== undefined && {
          job_description_path: payload.jobDescriptionPath,
        }),
        resume_weight: payload.resumeWeight,
        github_weight: payload.githubWeight,
        leetcode_weight: payload.leetcodeWeight,
        interview_weight: payload.interviewWeight,
        assessment_weight: payload.assessmentWeight,
      },
    }).then(normalizeRole),

  /** List all roles for the authenticated company, optionally filtered by status. */
  list: (status?: RoleStatus): Promise<Role[]> =>
    request<Record<string, unknown>[]>(
      status ? `/company/roles?status=${encodeURIComponent(status)}` : "/company/roles",
    ).then((rows) => rows.map(normalizeRole)),

  /** Fetch a single role owned by the authenticated company. */
  getById: (roleId: string): Promise<Role> =>
    request<Record<string, unknown>>(`/company/roles/${roleId}`).then(normalizeRole),

  /** Partially update a role owned by the authenticated company. */
  update: (roleId: string, payload: RoleUpdatePayload): Promise<Role> =>
    request<Record<string, unknown>>(`/company/roles/${roleId}`, {
      method: "PATCH",
      body: {
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.description !== undefined && { description: payload.description }),
        ...(payload.requiredSkills !== undefined && { required_skills: payload.requiredSkills }),
        ...(payload.experienceLevel !== undefined && { experience_level: payload.experienceLevel }),
        ...(payload.roleType !== undefined && { role_type: payload.roleType }),
        ...(payload.preferredQualifications !== undefined && {
          preferred_qualifications: payload.preferredQualifications,
        }),
        ...(payload.deadline !== undefined && { deadline: payload.deadline }),
        ...(payload.minimumEmployabilityScore !== undefined && {
          minimum_employability_score: payload.minimumEmployabilityScore,
        }),
        ...(payload.jobDescriptionPath !== undefined && {
          job_description_path: payload.jobDescriptionPath,
        }),
        ...(payload.resumeWeight !== undefined && { resume_weight: payload.resumeWeight }),
        ...(payload.githubWeight !== undefined && { github_weight: payload.githubWeight }),
        ...(payload.leetcodeWeight !== undefined && { leetcode_weight: payload.leetcodeWeight }),
        ...(payload.interviewWeight !== undefined && { interview_weight: payload.interviewWeight }),
        ...(payload.assessmentWeight !== undefined && {
          assessment_weight: payload.assessmentWeight,
        }),
      },
    }).then(normalizeRole),

  /** Delete a role owned by the authenticated company. */
  remove: (roleId: string): Promise<void> =>
    request<void>(`/company/roles/${roleId}`, { method: "DELETE" }),

  /** Transition a role to 'published'. Rejects if the deadline has already passed. */
  publish: (roleId: string): Promise<Role> =>
    request<Record<string, unknown>>(`/company/roles/${roleId}/publish`, {
      method: "POST",
    }).then(normalizeRole),

  /** Transition a role to 'archived'. */
  archive: (roleId: string): Promise<Role> =>
    request<Record<string, unknown>>(`/company/roles/${roleId}/archive`, {
      method: "POST",
    }).then(normalizeRole),

  /**
   * Upload a job-description PDF and get back AI-extracted hiring data
   * (skills, experience level, role type, preferred qualifications) to
   * pre-fill the role creation form. Does not create a role.
   */
  extractJobDescription: (file: File): Promise<JdExtractionResult> => {
    const formData = new FormData();
    formData.append("file", file);
    return request<Record<string, unknown>>("/company/roles/extract-jd", {
      method: "POST",
      body: formData,
    }).then(normalizeJdExtraction);
  },
};
