import { useRouterState } from "@tanstack/react-router";
import { collegeBasePath, isDemoPath } from "@/lib/demo/college/mode";

/**
 * Where the College Portal pages live for the current location: "/college" for the
 * real portal, "/demo/college" in Demo Mode. Derived from the URL only — so the same
 * page components can link correctly in both, and a stored value can never flip it.
 */
export function useCollegeBase(): { base: string; isDemo: boolean } {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return { base: collegeBasePath(pathname), isDemo: isDemoPath(pathname) };
}
