import { useEffect } from "react";
import { redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRoleGuard } from "@/hooks/use-role-guard";
import { ApiClientError } from "@/services/api/client";
import { useAuthStore } from "@/store/auth";
import type { AdminMe } from "@/types/admin/admin";
import type { Session } from "@/types";
import { useAdminMe } from "./use-admin-me";
import { toSuperAdminPath, type AdminPortal } from "./use-admin-portal";

export type AdminAccess =
  | { status: "checking" }
  | { status: "error"; error: unknown; retry: () => void }
  | { status: "ready"; session: Session; me: AdminMe };

/** Route `beforeLoad` for both portals. Back and forward after signing out must go
 * through this rather than the guard's effect below: a navigation fired from an
 * effect can be lost to the browser's own in-flight one, stranding the page on its
 * spinner. On the server, and while hydrating, there is no store to read: the
 * effect covers a hard load. */
export function redirectIfSignedOut() {
  if (typeof window !== "undefined" && !useAuthStore.getState().session) {
    throw redirect({ to: "/auth/login", search: { role: "admin" } });
  }
}

/**
 * Decides whether a portal renders, from the backend's answer alone: nothing is
 * shown until GET /admin/me has confirmed the session, so editing the stored
 * session gets a user no further than a redirect. Every /admin API call is
 * independently authorised as well; this only keeps the UI in step with that.
 *
 * Each account has exactly one portal. A Super Admin on an /admin URL is moved to
 * the same page in the Super Admin Portal; anyone else on /super-admin is refused.
 */
export function useAdminGuard(portal: AdminPortal): AdminAccess {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const session = useRoleGuard("admin", "This dashboard is for Admin accounts only.");
  const me = useAdminMe();

  const refused = me.error instanceof ApiClientError && me.error.status === 403;
  const wrongPortal = !!me.data && me.data.is_super_admin !== (portal === "super-admin");

  useEffect(() => {
    if (!refused) return;
    toast.error("This dashboard is for Admin accounts only.");
    navigate({ to: "/portals", replace: true });
  }, [refused, navigate]);

  useEffect(() => {
    if (!wrongPortal || refused) return;
    if (portal === "super-admin") {
      toast.error("The Super Admin Portal is for Super Admin accounts only.");
      navigate({ to: "/admin", replace: true });
    } else {
      navigate({ href: `${toSuperAdminPath(pathname)}${searchStr}`, replace: true });
    }
  }, [wrongPortal, refused, portal, pathname, searchStr, navigate]);

  if (!session || refused || wrongPortal) return { status: "checking" };
  if (me.data) return { status: "ready", session, me: me.data };
  // Couldn't get an answer (network, 5xx, a 503 naming a missing migration): say so
  // rather than render a portal nobody has confirmed. A 401 clears the session
  // in the API client, which sends the user to sign in.
  if (me.isError) return { status: "error", error: me.error, retry: () => void me.refetch() };
  return { status: "checking" };
}
