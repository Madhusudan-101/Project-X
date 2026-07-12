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
}

export interface Session {
  user: User;
  token: string;
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
