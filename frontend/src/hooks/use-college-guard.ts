import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to a "college" account. Mirrors useCompanyGuard so the College
 * (TPO) portal enforces the same rule as the Company portal.
 */
export function useCollegeGuard(): Session | null {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "college" } as never });
      return;
    }
    if (session.user.role !== "college") {
      toast.error("This dashboard is for College accounts only.");
      navigate({ to: "/portals" });
    }
  }, [session, navigate]);

  return session && session.user.role === "college" ? session : null;
}
