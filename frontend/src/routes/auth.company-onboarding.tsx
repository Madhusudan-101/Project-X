import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/store/auth";
import { useCompanyStore } from "@/store/company/company";
import { companyService } from "@/services/api/company/company";

// ── Constants ──────────────────────────────────────────────────────────

const DESIGNATIONS = ["HR Manager", "Talent Acquisition", "Founder", "Recruiter", "Other"];
const HIRING_VOLUMES = ["1-5", "5-20", "20+"];
const HIRING_TYPES: { value: string; label: string }[] = [
  { value: "internship", label: "Internship" },
  { value: "full-time", label: "Full-time" },
  { value: "both", label: "Both" },
];

const STEPS = ["Company details", "Point of contact", "Legal & consent"] as const;

// ── Validation ─────────────────────────────────────────────────────────

const schema = z.object({
  website: z
    .string()
    .trim()
    .max(255)
    .optional()
    .refine(
      (v) => !v || v.startsWith("http://") || v.startsWith("https://"),
      "Website must start with http:// or https://",
    ),
  designation: z.string().min(1, "Select a designation"),
  customDesignation: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  domain: z.enum(["tech", "non-tech", "both"], { required_error: "Select what you're hiring for" }),
  hiringVolume: z.string().min(1, "Select expected hiring volume"),
  hiringType: z.string().min(1, "Select hiring type"),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: "Required to continue" }) }),
  dataConsentAccepted: z.literal(true, { errorMap: () => ({ message: "Required to continue" }) }),
  gstin: z.string().trim().max(20).optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Route ──────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth/company-onboarding")({
  component: CompanyOnboardingPage,
});

// ── Component ──────────────────────────────────────────────────────────

function CompanyOnboardingPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const company = useCompanyStore((s) => s.company);
  const setCompany = useCompanyStore((s) => s.setCompany);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);

  // Logo — captured locally as a real file with a preview. NOT yet uploaded
  // anywhere: that needs the company-logos Storage bucket wired (see
  // db/company_onboarding_migration.sql), which hasn't been run/approved yet.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Auth guard ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "company" } as never });
      return;
    }
    if (session.user.role !== "company") {
      navigate({ to: "/portals" });
    }
  }, [session, navigate]);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const handleLogoSelect = (file: File | null) => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoFile(file);
    setLogoPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      website: "",
      designation: "",
      customDesignation: "",
      phone: "",
      hiringVolume: "",
      hiringType: "",
      gstin: "",
    },
  });

  const designation = form.watch("designation");

  // ── Step navigation — validate only the current step's fields ──────
  const STEP_FIELDS: Record<number, (keyof FormValues)[]> = {
    0: ["website"],
    1: ["designation", "phone", "domain", "hiringVolume", "hiringType"],
    2: ["tosAccepted", "dataConsentAccepted", "gstin"],
  };

  const goNext = async () => {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (!valid) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // ── Submit ─────────────────────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      // NOTE: only website is actually persisted right now — it's the only
      // field with real backend support today (PATCH /company/me). Logo file,
      // designation, phone, hiring intent, and consent are captured above for
      // review but intentionally not sent: they need the new company_contacts /
      // company_hiring_intent / company_consents tables and endpoints
      // (db/company_onboarding_migration.sql), which haven't been run or
      // wired yet — see the schema review sent alongside this form.
      const payload = values.website ? { website: values.website } : {};
      if (Object.keys(payload).length > 0) {
        const updated = await companyService.updateMe(payload);
        setCompany(updated);
      }
      toast.success("Workspace ready!");
      navigate({ to: "/company" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save onboarding details.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) return null;

  const firstName = session.user.firstName ?? session.user.name?.split(" ")[0] ?? "there";

  return (
    <div>
      {/* Success header */}
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">You're in, {firstName}!</h1>
          <p className="text-sm text-muted-foreground">A few details before your workspace is ready.</p>
        </div>
      </div>

      {company && (
        <Card className="mt-5 border-primary/20 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display text-base font-semibold">{company.name}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {company.industry} · {company.size} employees
              </div>
            </div>
            <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
              Registered
            </Badge>
          </div>
        </Card>
      )}

      {/* Step indicator */}
      <div className="mt-6 flex items-center gap-2 rounded-xl border border-border/60 bg-surface p-3 text-xs">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                i <= step
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "font-medium text-foreground" : "text-muted-foreground"}>
              {label}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
        {/* ── Step 1: Company details ── */}
        {step === 0 && (
          <fieldset className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="website" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                Company website
              </Label>
              <Input
                id="website"
                type="url"
                placeholder="https://yourcompany.com"
                aria-invalid={!!form.formState.errors.website}
                {...form.register("website")}
              />
              {form.formState.errors.website && (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.website.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Company logo</Label>
              <div className="flex items-center gap-4">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface">
                  {logoPreviewUrl ? (
                    <img src={logoPreviewUrl} alt="Logo preview" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(e) => handleLogoSelect(e.target.files?.[0] ?? null)}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => logoInputRef.current?.click()}>
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    {logoFile ? "Change logo" : "Upload logo"}
                  </Button>
                  <p className="text-xs text-muted-foreground">PNG, JPG, SVG or WEBP · optional, skippable</p>
                </div>
              </div>
            </div>
          </fieldset>
        )}

        {/* ── Step 2: Point of contact + hiring intent ── */}
        {step === 1 && (
          <fieldset className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="designation">Your designation</Label>
                <Select onValueChange={(v) => form.setValue("designation", v, { shouldValidate: true })}>
                  <SelectTrigger id="designation">
                    <SelectValue placeholder="Select designation" />
                  </SelectTrigger>
                  <SelectContent>
                    {DESIGNATIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.designation && (
                  <p className="text-xs text-destructive">{form.formState.errors.designation.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" type="tel" placeholder="+91 98765 43210" {...form.register("phone")} />
              </div>
            </div>

            {designation === "Other" && (
              <div className="space-y-1.5">
                <Label htmlFor="customDesignation">Enter your designation</Label>
                <Input id="customDesignation" placeholder="e.g. VP of People" {...form.register("customDesignation")} />
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Hiring intent
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="domain">What are you hiring for?</Label>
              <Select onValueChange={(v) => form.setValue("domain", v as FormValues["domain"], { shouldValidate: true })}>
                <SelectTrigger id="domain">
                  <SelectValue placeholder="Select domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tech">Tech</SelectItem>
                  <SelectItem value="non-tech">Non-tech</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.domain && (
                <p className="text-xs text-destructive">{form.formState.errors.domain.message}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="hiringVolume">Expected hiring volume</Label>
                <Select onValueChange={(v) => form.setValue("hiringVolume", v, { shouldValidate: true })}>
                  <SelectTrigger id="hiringVolume">
                    <SelectValue placeholder="Select volume" />
                  </SelectTrigger>
                  <SelectContent>
                    {HIRING_VOLUMES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.hiringVolume && (
                  <p className="text-xs text-destructive">{form.formState.errors.hiringVolume.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hiringType">Hiring type</Label>
                <Select onValueChange={(v) => form.setValue("hiringType", v, { shouldValidate: true })}>
                  <SelectTrigger id="hiringType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {HIRING_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.hiringType && (
                  <p className="text-xs text-destructive">{form.formState.errors.hiringType.message}</p>
                )}
              </div>
            </div>
          </fieldset>
        )}

        {/* ── Step 3: Legal & consent ── */}
        {step === 2 && (
          <fieldset className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN / company registration number</Label>
              <Input id="gstin" placeholder="Optional" {...form.register("gstin")} />
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 bg-surface p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="tosAccepted"
                  onCheckedChange={(v) => form.setValue("tosAccepted", (v === true) as true, { shouldValidate: true })}
                />
                <Label htmlFor="tosAccepted" className="text-sm font-normal leading-tight">
                  I agree to the Terms of Service <span className="text-destructive">*</span>
                </Label>
              </div>
              {form.formState.errors.tosAccepted && (
                <p className="text-xs text-destructive">{form.formState.errors.tosAccepted.message}</p>
              )}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="dataConsentAccepted"
                  onCheckedChange={(v) =>
                    form.setValue("dataConsentAccepted", (v === true) as true, { shouldValidate: true })
                  }
                />
                <Label htmlFor="dataConsentAccepted" className="text-sm font-normal leading-tight">
                  We acknowledge that we will be processing candidate personal data through this
                  platform, in line with applicable data protection requirements.{" "}
                  <span className="text-destructive">*</span>
                </Label>
              </div>
              {form.formState.errors.dataConsentAccepted && (
                <p className="text-xs text-destructive">{form.formState.errors.dataConsentAccepted.message}</p>
              )}
            </div>
          </fieldset>
        )}

        {/* ── Navigation ── */}
        <div className="flex gap-3 pt-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={goBack} disabled={submitting}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={goNext}
              className="flex-1 bg-gradient-brand text-primary-foreground shadow-soft"
            >
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-gradient-brand text-primary-foreground shadow-soft"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Enter dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
