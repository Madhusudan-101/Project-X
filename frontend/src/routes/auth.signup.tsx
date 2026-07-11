import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import type { UserRole } from "@/types";

const schema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name").max(40),
    lastName: z.string().trim().min(1, "Enter your surname").max(40),
    email: z.string().trim().email("Enter a valid email").max(255),
    password: z.string().min(8, "Minimum 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/auth/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { role } = Route.useSearch() as { role?: UserRole };
  const setSession = useAuthStore((s) => s.setSession);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "", confirm: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const fullName = `${values.firstName} ${values.lastName}`.trim();
      const session = await authService.signup(
        values.email,
        values.password,
        role ?? "candidate",
        fullName,
        values.firstName,
        values.lastName,
      );
      setSession(session);
      toast.success(`Welcome, ${values.firstName}! Verify your email to continue.`);
      navigate({ to: "/auth/otp", search: { role, email: values.email } });
    } catch (err: any) {
      toast.error(err.message || "Could not create account");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Create your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">Start free. No credit card required.</p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" placeholder="Alex" {...form.register("firstName")} />
            {form.formState.errors.firstName && (
              <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Surname</Label>
            <Input id="lastName" placeholder="Kumar" {...form.register("lastName")} />
            {form.formState.errors.lastName && (
              <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" placeholder="you@work.com" {...form.register("email")} />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" {...form.register("password")} />
            {form.formState.errors.password && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm</Label>
            <Input id="confirm" type="password" {...form.register("confirm")} />
            {form.formState.errors.confirm && (
              <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>
            )}
          </div>
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-brand text-primary-foreground shadow-soft"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/auth/login" search={{ role }} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
