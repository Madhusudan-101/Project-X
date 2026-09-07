import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/api/auth";
import type { UserRole } from "@/types";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});
type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { role } = Route.useSearch() as { role?: UserRole };
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await authService.forgotPassword(values.email);
      // Supabase's recovery email is a LINK (it lands on /auth/confirm with
      // type=recovery), not a 6-digit code — so there's nothing to type here.
      // The user continues by clicking the link in their inbox.
      setSentTo(values.email);
    } catch {
      toast.error("Could not send reset email");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Link
        to="/auth/login"
        search={{ role }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold">Forgot password?</h1>

      {sentTo ? (
        <div className="mt-8 space-y-3 rounded-lg border border-primary/20 bg-primary-soft p-4">
          <div className="flex items-center gap-2 text-primary">
            <MailCheck className="h-5 w-5" />
            <span className="font-medium">Check your email</span>
          </div>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
            we've sent a link to reset your password. Open it on this device to continue.
          </p>
          <button
            type="button"
            onClick={() => onSubmit({ email: sentTo })}
            disabled={submitting}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-60"
          >
            {submitting ? "Resending…" : "Resend link"}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email and we'll send you a link to reset your password.
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@work.com"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-brand text-primary-foreground shadow-soft"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
