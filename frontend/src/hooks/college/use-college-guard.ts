import { useRoleGuard } from "@/hooks/use-role-guard";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to a "college" account. Mirrors useCompanyGuard so the College
 * (TPO) portal enforces the same rule as the Company portal.
 */
export function useCollegeGuard(): Session | null {
  return useRoleGuard("college", "This dashboard is for College accounts only.");
}
