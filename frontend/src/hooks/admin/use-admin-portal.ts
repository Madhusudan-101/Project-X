import { createContext, useCallback, useContext } from "react";

/** The two portals share every page component; only the URL prefix and the Super
 * Admin identity differ. Which one a session may see is decided by GET /admin/me
 * (see use-admin-guard.ts), never by this value. */
export type AdminPortal = "admin" | "super-admin";

export const AdminPortalContext = createContext<AdminPortal>("admin");

export const useAdminPortal = () => useContext(AdminPortalContext);

export const toSuperAdminPath = (path: string) => path.replace(/^\/admin(?=\/|$)/, "/super-admin");

/** Rewrites an "/admin/..." link for the portal it is rendered in. Typed as the
 * identity so `<Link to={to("/admin/colleges/$collegeId")} params=...>` keeps its
 * route-param checking; both trees define the same routes. */
export function usePortalTo() {
  const portal = useAdminPortal();
  return useCallback(
    <T extends string>(path: T): T => (portal === "admin" ? path : (toSuperAdminPath(path) as T)),
    [portal],
  );
}
