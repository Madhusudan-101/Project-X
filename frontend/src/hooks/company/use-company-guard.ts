import { useRoleGuard } from "@/hooks/use-role-guard";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to a "company" account. Mirrors the guard inlined in
 * routes/company.tsx so every company-scoped page enforces the same rule.
 */
export function useCompanyGuard(): Session | null {
  return useRoleGuard("company", "This page is for Company accounts only.");
}
