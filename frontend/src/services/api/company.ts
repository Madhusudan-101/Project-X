/**
 * Company API service.
 * All calls use the existing `request()` client which auto-attaches the Bearer token.
 *
 * Endpoints consumed:
 *   POST /auth/company-signup  — atomic registration (auth router)
 *   GET  /company/me           — fetch own company profile
 *   PATCH /company/me          — update own company profile
 */

import { request } from "./client";
import type { Company, CompanySession, CompanySignupPayload, CompanyUpdatePayload } from "@/types/company";

// ── Shape helpers (snake_case DB → camelCase TS) ───────────────────────

function normalizeCompany(raw: Record<string, unknown>): Company {
  return {
    id: raw.id as string,
    ownerId: raw.owner_id as string,
    name: raw.name as string,
    industry: raw.industry as string,
    size: raw.size as string,
    hiringDomains: (raw.hiring_domains as string[]) ?? [],
    website: (raw.website as string | null) ?? null,
    logoUrl: (raw.logo_url as string | null) ?? null,
    isVerified: Boolean(raw.is_verified),
    createdAt: raw.created_at as string,
  };
}

// ── Service ────────────────────────────────────────────────────────────

export const companyService = {
  /**
   * Atomic company + HR account creation.
   * Calls POST /auth/company-signup (no auth required — creates the user).
   */
  signup: (payload: CompanySignupPayload): Promise<CompanySession> =>
    request<Record<string, unknown>>(
      "/auth/company-signup",
      {
        method: "POST",
        body: {
          email: payload.email,
          password: payload.password,
          first_name: payload.firstName,
          last_name: payload.lastName,
          company_name: payload.companyName,
          industry: payload.industry,
          size: payload.size,
          hiring_domains: payload.hiringDomains,
        },
      },
    ).then((raw) => ({
      user: raw.user as CompanySession["user"],
      token: raw.token as string,
      expiresAt: raw.expiresAt as string,
      company: raw.company ? normalizeCompany(raw.company as Record<string, unknown>) : null,
    })),

  /**
   * Fetch the authenticated HR user's company profile.
   * Requires a valid Bearer token (company role).
   */
  getMe: (): Promise<Company> =>
    request<Record<string, unknown>>("/company/me").then(normalizeCompany),

  /**
   * Partially update the company profile (website, logo, domains, etc.).
   * Requires a valid Bearer token (company role).
   */
  updateMe: (payload: CompanyUpdatePayload): Promise<Company> =>
    request<Record<string, unknown>>(
      "/company/me",
      {
        method: "PATCH",
        body: {
          ...(payload.name !== undefined && { name: payload.name }),
          ...(payload.industry !== undefined && { industry: payload.industry }),
          ...(payload.size !== undefined && { size: payload.size }),
          ...(payload.hiringDomains !== undefined && { hiring_domains: payload.hiringDomains }),
          ...(payload.website !== undefined && { website: payload.website }),
          ...(payload.logoUrl !== undefined && { logo_url: payload.logoUrl }),
        },
      },
    ).then(normalizeCompany),
};
