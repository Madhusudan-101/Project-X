import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";

/**
 * Redirects to login (or the portal picker) unless the current session
 * belongs to a "company" account. Mirrors the guard inlined in
 * routes/company.tsx so every company-scoped page enforces the same rule.
 */
export function useCompanyGuard(): Session | null {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "company" } as never });
      return;
    }
    if (session.user.role !== "company") {
      toast.error("This page is for Company accounts only.");
      navigate({ to: "/portals" });
    }
  }, [session, navigate]);

  return session && session.user.role === "company" ? session : null;
}
