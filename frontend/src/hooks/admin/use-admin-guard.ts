import { useRoleGuard } from "@/hooks/use-role-guard";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to an "admin" account. Convenience only — every /admin API call is
 * independently authorised by the backend, so hiding the UI is never the gate.
 */
export function useAdminGuard(): Session | null {
  return useRoleGuard("admin", "This dashboard is for Admin accounts only.");
}
