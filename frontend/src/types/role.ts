// ── Role (job posting) TypeScript types ───────────────────────────────
// Mirrors the backend RoleOut / RoleCreateIn / RoleUpdateIn Pydantic schemas.

export const EXPERIENCE_LEVELS = [
  "Entry-Level",
  "Mid-Level",
  "Senior",
  "Lead",
  "Executive",
] as const;

export const ROLE_STATUSES = ["draft", "published", "archived"] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export interface Role {
  id: string;
  companyId: string;
  title: string;
  description: string;
  requiredSkills: string[];
  experienceLevel: string;
  deadline: string; // ISO date (YYYY-MM-DD)
  minimumEmployabilityScore: number;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RoleCreatePayload {
  title: string;
  description: string;
  requiredSkills: string[];
  experienceLevel: string;
  deadline: string;
  minimumEmployabilityScore: number;
}

export interface RoleUpdatePayload {
  title?: string;
  description?: string;
  requiredSkills?: string[];
  experienceLevel?: string;
  deadline?: string;
  minimumEmployabilityScore?: number;
}
