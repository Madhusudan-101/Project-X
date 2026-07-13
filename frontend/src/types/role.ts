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

export const ROLE_TYPES = [
  "Full-time",
  "Part-time",
  "Internship",
  "Contract",
  "Freelance",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type RoleStatus = (typeof ROLE_STATUSES)[number];
export type RoleType = (typeof ROLE_TYPES)[number];

export interface Role {
  id: string;
  companyId: string;
  title: string;
  description: string;
  requiredSkills: string[];
  experienceLevel: string;
  roleType: string | null;
  preferredQualifications: string[];
  deadline: string; // ISO date (YYYY-MM-DD)
  minimumEmployabilityScore: number;
  status: RoleStatus;
  jobDescriptionPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleCreatePayload {
  title: string;
  description: string;
  requiredSkills: string[];
  experienceLevel: string;
  roleType?: string;
  preferredQualifications?: string[];
  deadline: string;
  minimumEmployabilityScore: number;
  jobDescriptionPath?: string;
}

export interface RoleUpdatePayload {
  title?: string;
  description?: string;
  requiredSkills?: string[];
  experienceLevel?: string;
  roleType?: string;
  preferredQualifications?: string[];
  deadline?: string;
  minimumEmployabilityScore?: number;
  jobDescriptionPath?: string;
}

/** Response from POST /company/roles/extract-jd — used to pre-fill the
 * role creation form. Not a persisted role. */
export interface JdExtractionResult {
  storagePath: string;
  title: string;
  description: string;
  requiredSkills: string[];
  experienceLevel: string;
  roleType: string;
  preferredQualifications: string[];
  warnings: string[];
}
