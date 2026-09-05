import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/store/auth";

// ── Constants ──────────────────────────────────────────────────────────

const COLLEGE_TYPES = [
  "IIT",
  "NIT",
  "IIIT",
  "State University",
  "Private University",
  "Deemed University",
  "Other",
];

const DESIGNATIONS = ["TPO", "Placement Coordinator", "Faculty Coordinator", "Other"];

const STUDENT_STRENGTH_RANGES = ["Under 500", "500-2,000", "2,000-5,000", "5,000-10,000", "10,000+"];

const CYCLE_STATUSES: { value: string; label: string }[] = [
  { value: "mid_cycle", label: "Mid-cycle" },
  { value: "about_to_start", label: "About to start" },
  { value: "off_season", label: "Off-season" },
];

const PLATFORM_INTENTS: { value: string; label: string }[] = [
  { value: "placement_mgmt", label: "Placement drive management" },
  { value: "readiness_tracking", label: "Student readiness tracking" },
  { value: "jd_matching", label: "Company-JD matching" },
  { value: "weakness_analysis", label: "Batch weakness analysis" },
];

const STEPS = ["Institute identity", "Point of contact", "Scale & context", "Platform intent", "Legal & consent"] as const;

// ── Validation ─────────────────────────────────────────────────────────

const schema = z.object({
  collegeName: z.string().trim().min(1, "Enter your college name").max(120),
  website: z
    .string()
    .trim()
    .max(255)
    .optional()
    .refine(
      (v) => !v || v.startsWith("http://") || v.startsWith("https://"),
      "Website must start with http:// or https://",
    ),
  city: z.string().trim().min(1, "Enter a city").max(80),
  state: z.string().trim().min(1, "Enter a state").max(80),
  type: z.string().min(1, "Select a type"),
  customType: z.string().trim().max(80).optional(),
  designation: z.string().min(1, "Select a designation"),
  customDesignation: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  studentStrength: z.string().min(1, "Select student strength"),
  cycleStatus: z.string().min(1, "Select placement cycle status"),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: "Required to continue" }) }),
  dataConsentAccepted: z.literal(true, { errorMap: () => ({ message: "Required to continue" }) }),
});
type FormValues = z.infer<typeof schema>;

// ── Route ──────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth/college-onboarding")({
  component: CollegeOnboardingPage,
});

// ── Component ──────────────────────────────────────────────────────────

function CollegeOnboardingPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);

  // Logo — same as company onboarding: captured locally with a preview,
  // not yet uploaded anywhere (needs a Storage bucket, not wired yet).
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Departments — free-text tag input (no master list exists for branch
  // names), reuses the same chip pattern as skills/hiring-domains elsewhere.
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentInput, setDepartmentInput] = useState("");
  const departmentInputRef = useRef<HTMLInputElement>(null);

  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);

  // ── Auth guard ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "college" } as never });
      return;
    }
    if (session.user.role !== "college") {
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

  const addDepartment = () => {
    const trimmed = departmentInput.trim();
    if (!trimmed || departments.includes(trimmed) || departments.length >= 30) {
      setDepartmentInput("");
      return;
    }
    setDepartments((prev) => [...prev, trimmed]);
    setDepartmentInput("");
  };
  const removeDepartment = (d: string) => setDepartments((prev) => prev.filter((x) => x !== d));
  const handleDepartmentKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDepartment();
    }
    if (e.key === "Backspace" && departmentInput === "" && departments.length > 0) {
      setDepartments((prev) => prev.slice(0, -1));
    }
  };

  const toggleIntent = (value: string) => {
    setSelectedIntents((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      collegeName: "",
      website: "",
      city: "",
      state: "",
      type: "",
      customType: "",
      designation: "",
      customDesignation: "",
      phone: "",
      studentStrength: "",
      cycleStatus: "",
    },
  });

  const type = form.watch("type");
  const designation = form.watch("designation");

  const STEP_FIELDS: Record<number, (keyof FormValues)[]> = {
    0: ["collegeName", "website", "city", "state", "type"],
    1: ["designation", "phone"],
    2: ["studentStrength", "cycleStatus"],
    3: [],
    4: ["tosAccepted", "dataConsentAccepted"],
  };

  const goNext = async () => {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (!valid) return;
    if (step === 3 && selectedIntents.length === 0) {
      toast.error("Select at least one platform intent.");
      return;
    }
    if (step === 2 && departments.length === 0) {
      toast.error("Add at least one department.");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // ── Submit ─────────────────────────────────────────────────────────
  const onSubmit = async (_values: FormValues) => {
    // NOTE: fully stubbed — unlike company onboarding, no existing endpoint
    // lets a College account update anything about its own college row today
    // (profiles.college_id is never even set at signup). Everything above is
    // captured and validated for review, but nothing is sent yet: this needs
    // db/college_onboarding_migration.sql run + a new backend endpoint that
    // creates/links the colleges row, sets profiles.college_id, and inserts
    // college_contacts/college_platform_intent/college_consents — none of
    // which are wired yet, pending schema approval.
    setSubmitting(true);
    try {
      toast.success("Workspace ready!");
      navigate({ to: "/college/placement-cycle" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) return null;

  const firstName = session.user.firstName ?? session.user.name?.split(" ")[0] ?? "there";

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">You're in, {firstName}!</h1>
          <p className="text-sm text-muted-foreground">A few details before your workspace is ready.</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-surface p-3 text-xs">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                i <= step ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
        {/* ── Step A: Institute identity ── */}
        {step === 0 && (
          <fieldset className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="collegeName">College name</Label>
              <Input id="collegeName" placeholder="LNM Institute of Information Technology" {...form.register("collegeName")} />
              {form.formState.errors.collegeName && (
                <p className="text-xs text-destructive">{form.formState.errors.collegeName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="website" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                College website
              </Label>
              <Input id="website" type="url" placeholder="https://yourcollege.edu" {...form.register("website")} />
              {form.formState.errors.website && (
                <p className="text-xs text-destructive">{form.formState.errors.website.message}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" placeholder="Jaipur" {...form.register("city")} />
                {form.formState.errors.city && (
                  <p className="text-xs text-destructive">{form.formState.errors.city.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input id="state" placeholder="Rajasthan" {...form.register("state")} />
                {form.formState.errors.state && (
                  <p className="text-xs text-destructive">{form.formState.errors.state.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="type">Institution type</Label>
              <Select onValueChange={(v) => form.setValue("type", v, { shouldValidate: true })}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {COLLEGE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.type && (
                <p className="text-xs text-destructive">{form.formState.errors.type.message}</p>
              )}
            </div>
            {type === "Other" && (
              <div className="space-y-1.5">
                <Label htmlFor="customType">Enter institution type</Label>
                <Input id="customType" placeholder="e.g. Autonomous College" {...form.register("customType")} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>College logo</Label>
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

        {/* ── Step B: Point of contact ── */}
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
                <Input id="customDesignation" placeholder="e.g. Dean of Placements" {...form.register("customDesignation")} />
              </div>
            )}
          </fieldset>
        )}

        {/* ── Step C: Scale & context ── */}
        {step === 2 && (
          <fieldset className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="studentStrength">Total student strength</Label>
                <Select onValueChange={(v) => form.setValue("studentStrength", v, { shouldValidate: true })}>
                  <SelectTrigger id="studentStrength">
                    <SelectValue placeholder="Select range" />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDENT_STRENGTH_RANGES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.studentStrength && (
                  <p className="text-xs text-destructive">{form.formState.errors.studentStrength.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycleStatus">Current placement cycle status</Label>
                <Select onValueChange={(v) => form.setValue("cycleStatus", v, { shouldValidate: true })}>
                  <SelectTrigger id="cycleStatus">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLE_STATUSES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.cycleStatus && (
                  <p className="text-xs text-destructive">{form.formState.errors.cycleStatus.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="departmentInput">
                Departments / branches offered <span className="text-destructive">*</span>
              </Label>
              {departments.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="list" aria-label="Selected departments">
                  {departments.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      role="listitem"
                      className="gap-1 border-primary/30 bg-primary/5 pr-1 text-primary"
                    >
                      {d}
                      <button
                        type="button"
                        onClick={() => removeDepartment(d)}
                        aria-label={`Remove ${d}`}
                        className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  id="departmentInput"
                  ref={departmentInputRef}
                  value={departmentInput}
                  onChange={(e) => setDepartmentInput(e.target.value)}
                  onKeyDown={handleDepartmentKeyDown}
                  placeholder='e.g. "Computer Science" then press Enter'
                  autoComplete="off"
                />
                <Button type="button" variant="outline" size="icon" onClick={addDepartment} aria-label="Add department" className="shrink-0">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </fieldset>
        )}

        {/* ── Step D: Platform intent ── */}
        {step === 3 && (
          <fieldset className="space-y-2">
            <Label>What do you want to use the platform for?</Label>
            <p className="text-xs text-muted-foreground">Select all that apply.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PLATFORM_INTENTS.map((intent) => {
                const checked = selectedIntents.includes(intent.value);
                return (
                  <label
                    key={intent.value}
                    htmlFor={`intent-${intent.value}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                      checked ? "border-primary/40 bg-primary/5" : "border-border/60 hover:border-primary/30"
                    }`}
                  >
                    <Checkbox
                      id={`intent-${intent.value}`}
                      checked={checked}
                      onCheckedChange={() => toggleIntent(intent.value)}
                    />
                    {intent.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* ── Step E: Legal & consent ── */}
        {step === 4 && (
          <fieldset className="space-y-3 rounded-lg border border-border/60 bg-surface p-3">
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
                We acknowledge that our college will have access to student evaluation data through
                this platform, and will handle it responsibly. <span className="text-destructive">*</span>
              </Label>
            </div>
            {form.formState.errors.dataConsentAccepted && (
              <p className="text-xs text-destructive">{form.formState.errors.dataConsentAccepted.message}</p>
            )}
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
            <Button type="button" onClick={goNext} className="flex-1 bg-gradient-brand text-primary-foreground shadow-soft">
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={submitting} className="flex-1 bg-gradient-brand text-primary-foreground shadow-soft">
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
