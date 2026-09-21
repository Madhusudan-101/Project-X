import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import type { Session, UserRole } from "@/types";

/**
 * Route guard shared by every portal: redirects to that role's login (or the
 * portal picker) unless the signed-in session belongs to `role`.
 *
 * Hydration: on a hard load or refresh React hydrates with zustand's *initial*
 * snapshot (`session: null`) and only re-renders with the persisted session a
 * moment later. An effect that acts on the subscribed `session` therefore sees
 * null and bounces a signed-in user to /auth/login. The effect reads the
 * store's real, hydrated state instead; the returned value (used for
 * rendering) still comes from the subscription, so server and first client
 * render keep matching.
 *
 * The guard is a convenience only — every API call is authorised server-side.
 */
export function useRoleGuard(role: UserRole, wrongRoleMessage: string): Session | null {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    const current = useAuthStore.getState().session;
    if (!current) {
      navigate({ to: "/auth/login", search: { role } as never });
      return;
    }
    if (current.user.role !== role) {
      toast.error(wrongRoleMessage);
      navigate({ to: "/portals" });
    }
  }, [session, navigate, role, wrongRoleMessage]);

  return session && session.user.role === role ? session : null;
}
