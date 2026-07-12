// ── Company-domain TypeScript types ───────────────────────────────────
// Mirrors the backend CompanyOut / CompanySignupIn Pydantic schemas.

export const INDUSTRIES = [
  "Technology",
  "Finance & Banking",
  "Healthcare",
  "Education",
  "E-commerce & Retail",
  "Manufacturing",
  "Consulting",
  "Real Estate",
  "Media & Entertainment",
  "Logistics & Supply Chain",
  "Automotive",
  "Government & Public Sector",
  "Other",
] as const;

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "500+",
] as const;

export const HIRING_DOMAIN_SUGGESTIONS = [
  "Software Engineering",
  "Data Science & ML",
  "Product Management",
  "UI/UX Design",
  "Marketing",
  "Sales",
  "Finance & Accounting",
  "Human Resources",
  "Operations",
  "DevOps & Infrastructure",
  "Cybersecurity",
  "Business Development",
  "Research & Development",
  "Customer Success",
  "Legal & Compliance",
] as const;

export type Industry = (typeof INDUSTRIES)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface Company {
  id: string;
  ownerId: string;
  name: string;
  industry: string;
  size: string;
  hiringDomains: string[];
  website?: string | null;
  logoUrl?: string | null;
  isVerified: boolean;
  createdAt: string;
}

/** Shape returned by POST /auth/company-signup */
export interface CompanySession {
  user: {
    id: string;
    email: string;
    role: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    onboarded: boolean;
  };
  token: string;
  expiresAt: string;
  company: Company | null;
}

export interface CompanySignupPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  industry: string;
  size: string;
  hiringDomains: string[];
}

export interface CompanyUpdatePayload {
  name?: string;
  industry?: string;
  size?: string;
  hiringDomains?: string[];
  website?: string;
  logoUrl?: string;
}
