import { useQuery } from "@tanstack/react-query";
import { adminService } from "@/services/api/admin/admin";
import { useAuthStore } from "@/store/auth";
import { adminQueryOptions } from "./query";

/** Who the backend says this session is. Keyed by user so one person's answer can
 * never be read for the next sign-in on the same browser, and re-checked when the
 * tab regains focus so a changed role moves the session to the right portal. */
export function useAdminMe() {
  const userId = useAuthStore((s) => (s.session?.user.role === "admin" ? s.session.user.id : undefined));
  return useQuery({
    queryKey: ["admin", "me", userId],
    queryFn: () => adminService.me(),
    enabled: !!userId,
    ...adminQueryOptions,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
