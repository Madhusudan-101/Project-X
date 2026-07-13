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
 */

import { request } from "./client";
import type { Role, RoleCreatePayload, RoleStatus, RoleUpdatePayload } from "@/types/role";

// ── Shape helpers (snake_case DB → camelCase TS) ───────────────────────

function normalizeRole(raw: Record<string, unknown>): Role {
  return {
    id: raw.id as string,
    companyId: raw.company_id as string,
    title: raw.title as string,
    description: raw.description as string,
    requiredSkills: (raw.required_skills as string[]) ?? [],
    experienceLevel: raw.experience_level as string,
    deadline: raw.deadline as string,
    minimumEmployabilityScore: Number(raw.minimum_employability_score ?? 0),
    status: raw.status as RoleStatus,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
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
        deadline: payload.deadline,
        minimum_employability_score: payload.minimumEmployabilityScore,
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
        ...(payload.deadline !== undefined && { deadline: payload.deadline }),
        ...(payload.minimumEmployabilityScore !== undefined && {
          minimum_employability_score: payload.minimumEmployabilityScore,
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
};
