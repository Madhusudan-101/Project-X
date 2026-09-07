import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import { onboardingPathForRole, dashboardPathForRole } from "@/lib/roles";

const schema = z
  .object({
    password: z.string().min(8, "Minimum 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/auth/set-password")({
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const [submitting, setSubmitting] = useState(false);

  // Only reachable right after Google sign-in with a real session — anyone
  // landing here without one (e.g. a stale bookmark) gets sent back to login.
  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login" });
    }
  }, [session, navigate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!session) return;
    setSubmitting(true);
    try {
      const email = session.user.email;
      const role = session.user.role;
      await authService.setPassword(values.password);

      // Immediately trade the OAuth-derived session for a fresh one via a
      // real login. The Google OAuth token pair has turned out to be
      // unreliable past this point (its refresh token intermittently gets
      // rejected by Supabase within moments of being issued) — a password
      // login is the one path that's proven to reliably issue a good
      // session, so use it rather than continuing to trust the OAuth one.
      const freshSession = await authService.login(email, values.password, role);
      toast.success("Password set!");
      if (!freshSession.user.firstName || !freshSession.user.onboarded) {
        navigate({ to: onboardingPathForRole(freshSession.user.role) });
      } else {
        navigate({ to: dashboardPathForRole(freshSession.user.role) });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not set password");
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) return null;

  return (
    <div>
      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
        <KeyRound className="h-5 w-5" />
      </div>
      <h1 className="mt-4 font-display text-3xl font-bold">Set a password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a password for this account. If you signed up with Google, this is what lets you
        also sign in with your email — separate from your Google password, which we never see.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="••••••••" {...form.register("password")} />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" placeholder="••••••••" {...form.register("confirm")} />
          {form.formState.errors.confirm && (
            <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>
          )}
        </div>
        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-brand text-primary-foreground shadow-soft"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>
    </div>
  );
}
