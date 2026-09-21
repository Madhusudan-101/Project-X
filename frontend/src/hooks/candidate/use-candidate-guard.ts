import { useRoleGuard } from "@/hooks/use-role-guard";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to a "candidate" account. Mirrors useCompanyGuard/useCollegeGuard
 * so the Candidate portal enforces the same rule as the other two.
 */
export function useCandidateGuard(): Session | null {
  return useRoleGuard("candidate", "This dashboard is for Candidate accounts only.");
}
