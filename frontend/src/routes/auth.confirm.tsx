/**
 * /auth/confirm
 *
 * Supabase redirects here after email confirmation with a URL fragment like:
 *   http://localhost:8080/auth/confirm#access_token=...&token_type=bearer&...
 *
 * This page:
 *  1. Parses the fragment from window.location.hash
 *  2. Calls GET /auth/profile with the token to fetch the full user+profile
 *  3. Stores the session in Zustand
 *  4. Redirects to the appropriate portal
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { request } from "@/services/api/client";
import type { User } from "@/types";

export const Route = createFileRoute("/auth/confirm")({
  component: AuthConfirmPage,
});

function parseHash(hash: string): Record<string, string> {
  return Object.fromEntries(
    hash
      .replace(/^#/, "")
      .split("&")
      .map((part) => part.split("=").map(decodeURIComponent)),
  );
}

function AuthConfirmPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // Hash may come from:
    // 1. window.location.hash — when Supabase redirected directly to /auth/confirm
    // 2. The TanStack Router 'hash' param — when root intercepted / and redirected here
    const rawHash =
      window.location.hash || window.location.search;

    // Build a reliable fragment string from the URL
    // TanStack puts the hash value after the # in the actual URL, so window.location.hash works
    const fragment = rawHash.replace(/^[#?]/, "");

    if (!fragment) {
      setStatus("error");
      setErrorMsg("No confirmation token found in the URL.");
      return;
    }

    const params = parseHash(fragment);
    const accessToken = params["access_token"];
    const tokenType = params["token_type"];
    const expiresIn = params["expires_in"];
    const errorCode = params["error"];
    const errorDescription = params["error_description"];

    // Supabase may send an error in the fragment
    if (errorCode) {
      setStatus("error");
      setErrorMsg(errorDescription?.replace(/\+/g, " ") ?? "Email confirmation failed.");
      return;
    }

    if (!accessToken || tokenType?.toLowerCase() !== "bearer") {
      setStatus("error");
      setErrorMsg("Invalid confirmation link. Please request a new one.");
      return;
    }

    // Fetch user profile from backend using the access token
    request<User>("/auth/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((user) => {
        const expiresAt = expiresIn
          ? String(Math.floor(Date.now() / 1000) + Number(expiresIn))
          : "";

        setSession({
          user,
          token: accessToken,
          expiresAt,
        });

        setStatus("success");
        toast.success("Email confirmed! Welcome to Project X.");

        // Redirect to the correct portal based on role
        setTimeout(() => {
          if (user.role === "company") {
            navigate({ to: "/auth/company-onboarding" });
          } else if (user.role === "college") {
            navigate({ to: "/college" });
          } else if (user.role === "admin") {
            navigate({ to: "/admin" });
          } else {
            navigate({ to: "/candidate" });
          }
        }, 1500);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to confirm email. Please try again.";
        setStatus("error");
        setErrorMsg(msg);
        toast.error(msg);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm text-center">
        {status === "loading" && (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold">Confirming your email…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Just a moment while we verify your account.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold">Email confirmed!</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Redirecting you to your dashboard…
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-destructive/10">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold">Confirmation failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            <button
              onClick={() => navigate({ to: "/auth/login" })}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-transform hover:-translate-y-0.5"
            >
              Go to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
