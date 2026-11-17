import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminGuard } from "@/hooks/admin/use-admin-guard";
import type { AdminPortal } from "@/hooks/admin/use-admin-portal";
import { authService } from "@/services/api/auth";
import { AdminShell } from "./AdminShell";
import { ErrorBlock } from "./StateViews";

/** The layout route of both portals: nothing below it renders until the backend
 * has confirmed this session belongs in `portal`. */
export function AdminPortalLayout({ portal }: { portal: AdminPortal }) {
  const access = useAdminGuard(portal);
  const navigate = useNavigate();

  if (access.status === "ready") {
    return <AdminShell session={access.session} me={access.me} portal={portal} />;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {access.status === "checking" ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" role="status" aria-label="Checking your access" />
      ) : (
        <div className="w-full max-w-lg space-y-3">
          <ErrorBlock error={access.error} onRetry={access.retry} />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              void authService.logout();
              navigate({ to: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
