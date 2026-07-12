import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Building2, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/auth";
import { useCompanyStore } from "@/store/company";
import { companyService } from "@/services/api/company";
import { INDUSTRIES, COMPANY_SIZES, HIRING_DOMAIN_SUGGESTIONS } from "@/types/company";

// ── Validation schema ──────────────────────────────────────────────────

const schema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name").max(40),
    lastName: z.string().trim().min(1, "Enter your surname").max(40),
    email: z.string().trim().email("Enter a valid work email").max(255),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128)
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirm: z.string(),
    companyName: z.string().trim().min(2, "Company name must be at least 2 characters").max(120),
    industry: z.string().min(1, "Select an industry"),
    size: z.string().min(1, "Select company size"),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof schema>;

// ── Route ──────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth/company-signup")({
  component: CompanySignupPage,
});

// ── Component ──────────────────────────────────────────────────────────

function CompanySignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const setCompany = useCompanyStore((s) => s.setCompany);
  const [submitting, setSubmitting] = useState(false);

  // Tag input state for hiring domains
  const [hiringDomains, setHiringDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [domainsError, setDomainsError] = useState("");
  const domainInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirm: "",
      companyName: "",
      industry: "",
      size: "",
    },
  });

  // ── Domain tag helpers ───────────────────────────────────────────────

  const addDomain = () => {
    const trimmed = domainInput.trim();
    if (!trimmed) return;
    if (hiringDomains.includes(trimmed)) {
      setDomainInput("");
      return;
    }
    if (hiringDomains.length >= 20) {
      setDomainsError("Maximum 20 domains allowed");
      return;
    }
    setHiringDomains((prev) => [...prev, trimmed]);
    setDomainInput("");
    setDomainsError("");
  };

  const removeDomain = (domain: string) => {
    setHiringDomains((prev) => prev.filter((d) => d !== domain));
    setDomainsError("");
  };

  const handleDomainKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDomain();
    }
    if (e.key === "Backspace" && domainInput === "" && hiringDomains.length > 0) {
      setHiringDomains((prev) => prev.slice(0, -1));
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    // Validate hiring domains separately (managed outside react-hook-form)
    if (hiringDomains.length === 0) {
      setDomainsError("Add at least one hiring domain");
      domainInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await companyService.signup({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        companyName: values.companyName,
        industry: values.industry,
        size: values.size,
        hiringDomains,
      });

      // Persist auth session
      setSession({
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name ?? `${values.firstName} ${values.lastName}`.trim(),
          firstName: result.user.firstName ?? values.firstName,
          lastName: result.user.lastName ?? values.lastName,
          role: "company",
          onboarded: result.user.onboarded,
          companyId: result.company?.id,
        },
        token: result.token,
        expiresAt: result.expiresAt,
      });

      // Persist company profile
      if (result.company) {
        setCompany(result.company);
      }

      if (result.token) {
        // Email confirmation is disabled in Supabase → session is live immediately
        toast.success(`Welcome, ${values.firstName}! Let's set up your workspace.`);
        navigate({ to: "/auth/company-onboarding" });
      } else {
        // Email confirmation is enabled → user must verify first
        toast.success("Account created! Check your email to verify and then sign in.");
        navigate({ to: "/portals" });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not create account. Please try again.";

      if (message.includes("already exists") || message.includes("already registered")) {
        form.setError("email", {
          type: "manual",
          message: "An account with this email already exists.",
        });
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
          <Building2 className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <div className="font-display text-sm font-semibold">Company Registration</div>
          <div className="text-xs text-muted-foreground">Create your hiring workspace</div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-border/60 bg-surface p-3 text-xs">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          1
        </span>
        <span className="font-medium text-foreground">HR Account</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          2
        </span>
        <span className="font-medium text-foreground">Company Details</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground">
          3
        </span>
        <span className="text-muted-foreground">Onboarding</span>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-6" noValidate>
        {/* ── Section 1: HR Account ── */}
        <fieldset>
          <legend className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            HR Account
          </legend>
          <div className="space-y-3">
            {/* Name row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  placeholder="Alex"
                  aria-required="true"
                  aria-invalid={!!form.formState.errors.firstName}
                  {...form.register("firstName")}
                />
                {form.formState.errors.firstName && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.firstName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Kumar"
                  aria-required="true"
                  aria-invalid={!!form.formState.errors.lastName}
                  {...form.register("lastName")}
                />
                {form.formState.errors.lastName && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="hr@company.com"
                aria-required="true"
                aria-invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            {/* Password row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  aria-required="true"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="••••••••"
                  aria-required="true"
                  aria-invalid={!!form.formState.errors.confirm}
                  {...form.register("confirm")}
                />
                {form.formState.errors.confirm && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.confirm.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </fieldset>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Company Details
          </span>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* ── Section 2: Company ── */}
        <fieldset>
          <div className="space-y-3">
            {/* Company name */}
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company name</Label>
              <Input
                id="companyName"
                placeholder="Acme Corp"
                aria-required="true"
                aria-invalid={!!form.formState.errors.companyName}
                {...form.register("companyName")}
              />
              {form.formState.errors.companyName && (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.companyName.message}
                </p>
              )}
            </div>

            {/* Industry + Size row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="industry">Industry</Label>
                <Select
                  onValueChange={(v) => form.setValue("industry", v, { shouldValidate: true })}
                >
                  <SelectTrigger
                    id="industry"
                    aria-required="true"
                    aria-invalid={!!form.formState.errors.industry}
                  >
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind} value={ind}>
                        {ind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.industry && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.industry.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="size">Company size</Label>
                <Select
                  onValueChange={(v) => form.setValue("size", v, { shouldValidate: true })}
                >
                  <SelectTrigger
                    id="size"
                    aria-required="true"
                    aria-invalid={!!form.formState.errors.size}
                  >
                    <SelectValue placeholder="Employees" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_SIZES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s} employees
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.size && (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.size.message}
                  </p>
                )}
              </div>
            </div>

            {/* Hiring Domains tag input */}
            <div className="space-y-1.5">
              <Label htmlFor="domainInput">
                Active hiring domains
                <span className="ml-1 text-muted-foreground">(at least one)</span>
              </Label>
              {/* Tags display */}
              {hiringDomains.length > 0 && (
                <div
                  className="flex flex-wrap gap-1.5"
                  role="list"
                  aria-label="Selected hiring domains"
                >
                  {hiringDomains.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      role="listitem"
                      className="gap-1 border-primary/30 bg-primary/5 pr-1 text-primary"
                    >
                      {d}
                      <button
                        type="button"
                        onClick={() => removeDomain(d)}
                        aria-label={`Remove ${d}`}
                        className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {/* Input + Add */}
              <div className="flex gap-2">
                <Input
                  id="domainInput"
                  ref={domainInputRef}
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={handleDomainKeyDown}
                  placeholder='e.g. "Software Engineering" then press Enter'
                  aria-invalid={!!domainsError}
                  aria-describedby={domainsError ? "domains-error" : "domains-hint"}
                  list="domain-suggestions"
                  autoComplete="off"
                />
                <datalist id="domain-suggestions">
                  {HIRING_DOMAIN_SUGGESTIONS.filter((s) => !hiringDomains.includes(s)).map(
                    (s) => (
                      <option key={s} value={s} />
                    ),
                  )}
                </datalist>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addDomain}
                  aria-label="Add domain"
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {domainsError ? (
                <p id="domains-error" role="alert" className="text-xs text-destructive">
                  {domainsError}
                </p>
              ) : (
                <p id="domains-hint" className="text-xs text-muted-foreground">
                  Press Enter or click + to add. Suggestions appear as you type.
                </p>
              )}
            </div>
          </div>
        </fieldset>

        {/* Submit */}
        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-brand text-primary-foreground shadow-soft"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating your workspace…
            </>
          ) : (
            "Create company account"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/auth/login"
          search={{ role: "company" } as never}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
