import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import { dashboardPathForRole } from "@/lib/roles";
import { OAUTH_INTENT_ROLE_KEY } from "@/components/auth/GoogleSignInButton";
import type { UserRole } from "@/types";

export const Route = createFileRoute("/auth/oauth-callback")({
  component: OAuthCallbackPage,
});

function OAuthCallbackPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React 18 StrictMode double-invokes effects in dev
    ran.current = true;

    (async () => {
      const { data, error } = await getSupabase().auth.getSession();
      const role = (sessionStorage.getItem(OAUTH_INTENT_ROLE_KEY) as UserRole | null) ?? "candidate";
      sessionStorage.removeItem(OAUTH_INTENT_ROLE_KEY);

      if (error || !data.session) {
        toast.error("Google sign-in failed. Please try again.");
        navigate({ to: "/portals" });
        return;
      }

      try {
        const session = await authService.completeOAuthSession(
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_at ? String(data.session.expires_at) : "",
          role,
        );
        setSession(session);
        toast.success("Signed in with Google!");
        if (!session.user.firstName || !session.user.onboarded) {
          // First-time Google sign-in — this account has no password at all
          // (Google never shares it with us), so set one before onboarding.
          navigate({ to: "/auth/set-password" });
        } else {
          navigate({ to: dashboardPathForRole(session.user.role) });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not complete sign-in.");
        navigate({ to: "/portals" });
      }
    })();
  }, [navigate, setSession]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Finishing sign-in with Google...</p>
    </div>
  );
}
