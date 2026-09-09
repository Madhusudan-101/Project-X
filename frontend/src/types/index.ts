// Types shared across the app. Extend as new modules are built.

export type UserRole = "candidate" | "company" | "college" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  avatarUrl?: string;
  onboarded?: boolean;
  /** Set for company users — the id of their public.companies row */
  companyId?: string;
  /** Candidate onboarding fields (unused for company/college accounts) */
  skills?: string[];
  interestedRoles?: string[];
  collegeName?: string;
  graduationYear?: number;
  /** "tech" | "non-tech" — drives which jobs show on the student board */
  domain?: string;
  /** id of the resolved public.colleges row for this candidate */
  collegeId?: string;
  /** Academic branch (CSE / IT / ECE …) — gates on-campus drive eligibility */
  branch?: string | null;
  degree?: string | null;
  /** Stable candidate identity (job_drives_migration.sql, 1.6).
   *  `gender` is aggregate-only — never shown to recruiters. */
  cgpa?: number | null;
  nationality?: string | null;
  needsSponsorship?: boolean | null;
  sponsorshipCountry?: string | null;
  gender?: string | null;
  preferredLocations?: string[];
  willingToRelocate?: boolean | null;
}

export interface Session {
  user: User;
  token: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
