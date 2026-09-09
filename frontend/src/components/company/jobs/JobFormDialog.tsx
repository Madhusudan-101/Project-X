import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SkillsMultiSelect, type SelectedSkill } from "@/components/candidate/SkillsMultiSelect";
import { WeightSlidersField } from "./WeightSlidersField";
import { DriveSchedulerTable, emptyDrive, type DraftDrive } from "./DriveSchedulerTable";
import { jobsService } from "@/services/api/company/jobs";
import { drivesService, driveTemplatesService } from "@/services/api/company/drives";
import { ApiClientError } from "@/services/api/client";
import {
  EMPLOYMENT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  INTERVIEW_MODE_LABELS,
  JOB_EMPLOYMENT_TYPES,
  JOB_EXPERIENCE_LEVELS,
  JOB_INTERVIEW_MODES,
  ZERO_WEIGHTS,
  weightsTotal,
  type DrivePayload,
  type Job,
  type JobEmploymentType,
  type JobInterviewMode,
  type JobWeights,
} from "@/types/jobs";

const LAST_ELIGIBILITY_KEY = "mirracle:lastDriveEligibility";

const optionalNumber = (max?: number) =>
  z
    .union([
      z.literal(""),
      max === undefined
        ? z.coerce.number().min(0, "Must be 0 or more")
        : z.coerce.number().min(0, "Must be 0 or more").max(max, `Must be ${max} or less`),
    ])
    .optional();

const schema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(150),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(8000),
  domain: z.enum(["tech", "non-tech"], { required_error: "Pick a domain" }),
  experienceLevel: z.enum(JOB_EXPERIENCE_LEVELS, { required_error: "Pick an experience level" }),
  employmentType: z.enum(JOB_EMPLOYMENT_TYPES, { required_error: "Pick an employment type" }),
  interviewMode: z.enum(JOB_INTERVIEW_MODES, { required_error: "Pick an interview mode" }),
  location: z.string().trim().min(1, "Location is required").max(120),
  openingsCount: z.coerce.number().int().min(1, "At least 1 opening").max(10000),
  ctcMin: optionalNumber(),
  ctcMax: optionalNumber(),
  ctcCurrency: z.string().trim().min(1).max(8),
  // Internship-only (shown when employmentType === "intern").
  stipendMin: optionalNumber(),
  stipendMax: optionalNumber(),
  internshipDuration: z
    .union([z.literal(""), z.coerce.number().int().min(1, "1–24 months").max(24, "1–24 months")])
    .optional(),
  ppoCtcMin: optionalNumber(),
  ppoCtcMax: optionalNumber(),
});
type FormValues = z.infer<typeof schema>;

const EMPTY_VALUES: FormValues = {
  title: "",
  description: "",
  domain: undefined as unknown as "tech",
  experienceLevel: undefined as unknown as (typeof JOB_EXPERIENCE_LEVELS)[number],
  employmentType: "full-time",
  interviewMode: "ai",
  location: "",
  openingsCount: 1,
  ctcMin: "",
  ctcMax: "",
  ctcCurrency: "INR",
  stipendMin: "",
  stipendMax: "",
  internshipDuration: "",
  ppoCtcMin: "",
  ppoCtcMax: "",
};

interface LastEligibility {
  minCgpa: string;
  eligibleBranches: string[];
  eligibleBatchYears: number[];
}

function loadLastEligibility(): LastEligibility | null {
  try {
    const raw = localStorage.getItem(LAST_ELIGIBILITY_KEY);
    return raw ? (JSON.parse(raw) as LastEligibility) : null;
  } catch {
    return null;
  }
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function draftToPayload(d: DraftDrive): DrivePayload {
  return {
    collegeId: d.collegeId,
    isOnCampus: d.isOnCampus,
    applyDeadline: toIso(d.applyDeadline) ?? new Date().toISOString(),
    oaWindowStart: toIso(d.oaWindowStart),
    oaWindowEnd: toIso(d.oaWindowEnd),
    minCgpa: d.minCgpa.trim() === "" ? null : Number(d.minCgpa),
    eligibleBranches: d.eligibleBranches.length ? d.eligibleBranches : null,
    eligibleBatchYears: d.eligibleBatchYears.length ? d.eligibleBatchYears : null,
    rounds: d.rounds.map((r, i) => ({
      roundNumber: i + 1,
      roundType: r.roundType,
      mode: r.mode,
      windowStart: toIso(r.windowStart),
      windowEnd: toIso(r.windowEnd),
    })),
  };
}

const CREATE_STEPS = ["Basics", "Scoring", "Colleges & drives", "Eligibility"] as const;
const EDIT_STEPS = ["Basics", "Scoring"] as const;

interface JobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  job?: Job | null;
  onSuccess: (job: Job) => void;
}

export function JobFormDialog({ open, onOpenChange, mode, job, onSuccess }: JobFormDialogProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [skills, setSkills] = useState<SelectedSkill[]>([]);
  const [weights, setWeights] = useState<JobWeights>(ZERO_WEIGHTS);
  const [drives, setDrives] = useState<DraftDrive[]>([]);
  const [perks, setPerks] = useState<string[]>([]);
  const [perkInput, setPerkInput] = useState("");
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);

  const addPerk = () => {
    const v = perkInput.trim();
    if (v && !perks.includes(v)) setPerks((p) => [...p, v]);
    setPerkInput("");
  };

  const steps = mode === "edit" ? EDIT_STEPS : CREATE_STEPS;
  const isLast = step === steps.length - 1;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_VALUES,
  });

  const { data: colleges } = useQuery({
    queryKey: ["company-colleges"],
    queryFn: () => jobsService.listColleges(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: templates } = useQuery({
    queryKey: ["company-drive-templates"],
    queryFn: () => driveTemplatesService.list(),
    enabled: open && mode === "create",
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setBrief("");
    setPerkInput("");
    if (mode === "edit" && job) {
      form.reset({
        title: job.title,
        description: job.description,
        domain: job.domain,
        experienceLevel: job.experienceLevel,
        employmentType: job.employmentType,
        interviewMode: job.interviewMode,
        location: job.location,
        openingsCount: job.openingsCount,
        ctcMin: job.ctcMin ?? "",
        ctcMax: job.ctcMax ?? "",
        ctcCurrency: job.ctcCurrency ?? "INR",
        stipendMin: job.stipendMin ?? "",
        stipendMax: job.stipendMax ?? "",
        internshipDuration: job.internshipDurationMonths ?? "",
        ppoCtcMin: job.ppoCtcMin ?? "",
        ppoCtcMax: job.ppoCtcMax ?? "",
      });
      setSkills(job.skills.map((name) => ({ name, isCustom: false })));
      setWeights(job.weights ?? ZERO_WEIGHTS);
      setPerks(job.perks ?? []);
      setDrives([]);
    } else {
      form.reset(EMPTY_VALUES);
      setSkills([]);
      setWeights(ZERO_WEIGHTS);
      setPerks([]);
      setDrives([]);
    }
  }, [open, mode, job, form]);

  const weightsValid = weightsTotal(weights) === 100;
  const isIntern = form.watch("employmentType") === "intern";

  // Mirrors the backend's JobDriveIn / JobDriveRoundIn validators so the
  // user gets a targeted message here instead of a 422 mid-submit.
  const driveWindowIssue = (): string | null => {
    const nameOf = (id: string) => colleges?.find((c) => c.id === id)?.name ?? "this college";
    const before = (a: string, b: string) =>
      a && b && new Date(b).getTime() <= new Date(a).getTime();
    for (const d of drives) {
      const where = nameOf(d.collegeId);
      if (before(d.oaWindowStart, d.oaWindowEnd)) {
        return `${where}: the OA window end must be after its start.`;
      }
      for (let i = 0; i < d.rounds.length; i++) {
        const r = d.rounds[i];
        if (before(r.windowStart, r.windowEnd)) {
          return `${where}: round ${i + 1}'s end time must be after its start time.`;
        }
      }
    }
    return null;
  };

  const runDraft = async () => {
    if (!brief.trim()) {
      toast.error("Describe the role in a sentence or two first.");
      return;
    }
    setDrafting(true);
    try {
      const text = await jobsService.draftDescription({
        brief: brief.trim(),
        title: form.getValues("title") || undefined,
        domain: form.getValues("domain"),
        experienceLevel: form.getValues("experienceLevel"),
        location: form.getValues("location") || undefined,
        skills: skills.map((s) => s.name),
      });
      form.setValue("description", text, { shouldValidate: true });
      toast.success("Draft generated — edit it before you publish.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft a description.");
    } finally {
      setDrafting(false);
    }
  };

  // Add a college row pre-filled with the company's last-used eligibility.
  const drivesWithDefaults = (next: DraftDrive[]): DraftDrive[] => {
    const last = loadLastEligibility();
    if (!last) return next;
    return next.map((d) =>
      d.minCgpa === "" && d.eligibleBranches.length === 0 && d.eligibleBatchYears.length === 0
        ? {
            ...d,
            minCgpa: last.minCgpa ?? "",
            eligibleBranches: last.eligibleBranches ?? [],
            eligibleBatchYears: last.eligibleBatchYears ?? [],
          }
        : d,
    );
  };

  const goNext = async () => {
    if (step === 0) {
      const ok = await form.trigger([
        "title",
        "description",
        "domain",
        "experienceLevel",
        "employmentType",
        "location",
        "openingsCount",
        "ctcCurrency",
      ]);
      if (!ok) return;
    }
    if (step === 1 && !weightsValid) {
      toast.error("Scoring weights must total exactly 100%.");
      return;
    }
    if (step === 2) {
      if (drives.length === 0) {
        toast.error("Add at least one college.");
        return;
      }
      if (drives.some((d) => !d.applyDeadline)) {
        toast.error("Set an apply deadline for every college.");
        return;
      }
      const wIssue = driveWindowIssue();
      if (wIssue) {
        toast.error(wIssue);
        return;
      }
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const submit = async (publish: boolean) => {
    const ok = await form.trigger();
    if (!ok) {
      setStep(0);
      return;
    }
    if (!weightsValid) {
      setStep(1);
      toast.error("Scoring weights must total exactly 100%.");
      return;
    }
    if (mode === "create") {
      if (drives.length === 0) {
        setStep(2);
        toast.error("Add at least one college.");
        return;
      }
      if (drives.some((d) => !d.applyDeadline)) {
        setStep(2);
        toast.error("Set an apply deadline for every college.");
        return;
      }
      const wIssue = driveWindowIssue();
      if (wIssue) {
        setStep(2);
        toast.error(wIssue);
        return;
      }
      if (
        publish &&
        drives.some(
          (d) => d.rounds.length === 0 || d.rounds.some((r) => !r.windowStart || !r.windowEnd),
        )
      ) {
        setStep(2);
        toast.error("Every round needs a start and end time before a drive can go live.");
        return;
      }
    }

    const values = form.getValues();
    const toNum = (v: number | "" | undefined) => (v === "" || v === undefined ? null : Number(v));

    // job.deadline (a NOT NULL date, largely vestigial now) is derived from
    // the latest drive apply deadline on create; on edit it is left as-is.
    const latestDeadline =
      drives
        .map((d) => d.applyDeadline)
        .filter(Boolean)
        .sort()
        .pop() ?? "";
    const jobDeadline =
      mode === "edit" && job
        ? job.deadline
        : latestDeadline
          ? latestDeadline.slice(0, 10)
          : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

    const isIntern = values.employmentType === "intern";

    setSubmitting(true);
    try {
      const common = {
        title: values.title,
        description: values.description,
        domain: values.domain,
        experienceLevel: values.experienceLevel,
        location: values.location,
        openingsCount: values.openingsCount,
        deadline: jobDeadline,
        skills: skills.map((s) => s.name),
        weights,
        employmentType: values.employmentType,
        interviewMode: values.interviewMode,
        ctcCurrency: values.ctcCurrency.trim() || "INR",
        perks,
        // Full-time CTC vs. internship stipend / duration / PPO — only one
        // set is relevant, the other is cleared.
        ctcMin: isIntern ? null : toNum(values.ctcMin),
        ctcMax: isIntern ? null : toNum(values.ctcMax),
        stipendMin: isIntern ? toNum(values.stipendMin) : null,
        stipendMax: isIntern ? toNum(values.stipendMax) : null,
        internshipDurationMonths: isIntern
          ? values.internshipDuration === "" || values.internshipDuration === undefined
            ? null
            : Number(values.internshipDuration)
          : null,
        ppoCtcMin: isIntern ? toNum(values.ppoCtcMin) : null,
        ppoCtcMax: isIntern ? toNum(values.ppoCtcMax) : null,
      };

      let saved: Job;
      if (mode === "edit" && job) {
        // Don't clobber drive-managed / legacy job-level fields on edit.
        saved = await jobsService.update(job.id, common);
        if (publish && saved.status !== "live") saved = await jobsService.publish(saved.id);
      } else {
        const jobPayload = {
          ...common,
          visibility: "all" as const,
          visibleCollegeIds: [],
          interviewDurationMinutes: 30 as const,
          isOnCampus: drives.some((d) => d.isOnCampus),
          minCgpa: null,
          eligibleBranches: [],
          eligibleBatchYears: [],
        };
        saved = await jobsService.create({ ...jobPayload, publish });
        // Create a drive per college, then publish each if requested.
        for (const d of drives) {
          const created = await drivesService.create(saved.id, draftToPayload(d));
          if (publish) {
            try {
              await drivesService.publish(saved.id, created.id);
            } catch (e) {
              toast.warning(
                `Drive for ${d.collegeId} saved as draft — ${
                  e instanceof Error ? e.message : "finish its round dates to publish it."
                }`,
              );
            }
          }
        }
        // Remember this run's eligibility as the company default.
        try {
          const first = drives[0];
          localStorage.setItem(
            LAST_ELIGIBILITY_KEY,
            JSON.stringify({
              minCgpa: first.minCgpa,
              eligibleBranches: first.eligibleBranches,
              eligibleBatchYears: first.eligibleBatchYears,
            }),
          );
        } catch {
          /* non-fatal */
        }
      }

      toast.success(
        mode === "edit"
          ? "Job updated."
          : publish
            ? "Job published — drives are live for eligible students."
            : "Job and drives saved as drafts.",
      );
      onSuccess(saved);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Something went wrong.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !submitting && onOpenChange(n)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit job" : "Create a job"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update this job posting. Manage its drives from the job's page."
              : "Draft the JD, set scoring weights, then schedule a drive per college."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <ol className="flex items-center gap-1 text-xs">
          {steps.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
                  i === step
                    ? "bg-primary/10 font-medium text-primary"
                    : i < step
                      ? "text-foreground hover:bg-surface"
                      : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-full border text-[10px]",
                    i <= step ? "border-primary text-primary" : "border-border",
                  )}
                >
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {label}
              </button>
              {i < steps.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
          {/* ── Step 1: Basics ─────────────────────────────────────── */}
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="job-title">Role title</Label>
                <Input
                  id="job-title"
                  placeholder="e.g. Backend Engineer Intern"
                  {...form.register("title")}
                />
                {form.formState.errors.title && (
                  <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label
                  htmlFor="job-brief"
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Draft with AI
                </Label>
                <Textarea
                  id="job-brief"
                  rows={2}
                  placeholder="Describe the role in plain words — Gemini writes the full JD, you edit it."
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={runDraft}
                  disabled={drafting}
                >
                  {drafting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Generate draft
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="job-description">Description</Label>
                <Textarea
                  id="job-description"
                  rows={8}
                  placeholder="Responsibilities, requirements, nice-to-haves…"
                  {...form.register("description")}
                />
                {form.formState.errors.description && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="job-domain">Domain</Label>
                  <Select
                    value={form.watch("domain") || undefined}
                    onValueChange={(v) =>
                      form.setValue("domain", v as "tech" | "non-tech", { shouldValidate: true })
                    }
                  >
                    <SelectTrigger id="job-domain">
                      <SelectValue placeholder="Tech or non-tech" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tech">Tech</SelectItem>
                      <SelectItem value="non-tech">Non-tech</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.domain && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.domain.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job-exp">Experience level</Label>
                  <Select
                    value={form.watch("experienceLevel") || undefined}
                    onValueChange={(v) =>
                      form.setValue(
                        "experienceLevel",
                        v as (typeof JOB_EXPERIENCE_LEVELS)[number],
                        {
                          shouldValidate: true,
                        },
                      )
                    }
                  >
                    <SelectTrigger id="job-exp">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_EXPERIENCE_LEVELS.map((lvl) => (
                        <SelectItem key={lvl} value={lvl}>
                          {EXPERIENCE_LEVEL_LABELS[lvl]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.experienceLevel && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.experienceLevel.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job-emptype">Employment type</Label>
                  <Select
                    value={form.watch("employmentType") || undefined}
                    onValueChange={(v) =>
                      form.setValue("employmentType", v as JobEmploymentType, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="job-emptype">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {EMPLOYMENT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {isIntern ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="job-stipend-min">Stipend min (per month)</Label>
                      <Input
                        id="job-stipend-min"
                        type="number"
                        min={0}
                        placeholder="25000"
                        {...form.register("stipendMin")}
                      />
                      {form.formState.errors.stipendMin && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.stipendMin.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="job-stipend-max">Stipend max (per month)</Label>
                      <Input
                        id="job-stipend-max"
                        type="number"
                        min={0}
                        placeholder="50000"
                        {...form.register("stipendMax")}
                      />
                      {form.formState.errors.stipendMax && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.stipendMax.message}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="job-ctc-min">CTC min (per year)</Label>
                      <Input
                        id="job-ctc-min"
                        type="number"
                        min={0}
                        placeholder="600000"
                        {...form.register("ctcMin")}
                      />
                      {form.formState.errors.ctcMin && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.ctcMin.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="job-ctc-max">CTC max (per year)</Label>
                      <Input
                        id="job-ctc-max"
                        type="number"
                        min={0}
                        placeholder="1200000"
                        {...form.register("ctcMax")}
                      />
                      {form.formState.errors.ctcMax && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.ctcMax.message}
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="job-ctc-currency">Currency</Label>
                  <Select
                    value={form.watch("ctcCurrency") || "INR"}
                    onValueChange={(v) => form.setValue("ctcCurrency", v, { shouldValidate: true })}
                  >
                    <SelectTrigger id="job-ctc-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["INR", "USD", "EUR", "GBP", "SGD"].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Internship-only: duration + PPO conversion package */}
              {isIntern && (
                <div className="grid gap-3 rounded-lg border border-border/70 bg-surface/40 p-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="job-intern-duration">Duration (months)</Label>
                    <Input
                      id="job-intern-duration"
                      type="number"
                      min={1}
                      max={24}
                      placeholder="6"
                      {...form.register("internshipDuration")}
                    />
                    {form.formState.errors.internshipDuration && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.internshipDuration.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="job-ppo-min">PPO package min (per year)</Label>
                    <Input
                      id="job-ppo-min"
                      type="number"
                      min={0}
                      placeholder="1200000"
                      {...form.register("ppoCtcMin")}
                    />
                    {form.formState.errors.ppoCtcMin && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.ppoCtcMin.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="job-ppo-max">PPO package max (per year)</Label>
                    <Input
                      id="job-ppo-max"
                      type="number"
                      min={0}
                      placeholder="1800000"
                      {...form.register("ppoCtcMax")}
                    />
                    {form.formState.errors.ppoCtcMax && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.ppoCtcMax.message}
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground sm:col-span-3">
                    Expected annual CTC if the intern is converted to a full-time PPO offer.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="job-location">Location</Label>
                  <Input
                    id="job-location"
                    placeholder="Remote / Bengaluru"
                    {...form.register("location")}
                  />
                  {form.formState.errors.location && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.location.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job-openings">Openings</Label>
                  <Input
                    id="job-openings"
                    type="number"
                    min={1}
                    {...form.register("openingsCount")}
                  />
                  {form.formState.errors.openingsCount && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.openingsCount.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Required skills</Label>
                <SkillsMultiSelect value={skills} onChange={setSkills} />
              </div>

              {/* Perks & benefits — relocation assistance, accommodation, etc. */}
              <div className="space-y-1.5">
                <Label htmlFor="job-perk-input">Perks &amp; benefits</Label>
                <div className="flex gap-2">
                  <Input
                    id="job-perk-input"
                    placeholder="e.g. Relocation assistance"
                    value={perkInput}
                    onChange={(e) => setPerkInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPerk();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addPerk}>
                    Add
                  </Button>
                </div>
                {perks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {perks.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary"
                      >
                        {p}
                        <button
                          type="button"
                          aria-label={`Remove ${p}`}
                          onClick={() => setPerks((prev) => prev.filter((x) => x !== p))}
                          className="rounded-full p-0.5 hover:bg-primary/20"
                        >
                          <span aria-hidden>×</span>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Relocation assistance, accommodation, health insurance, certificate &amp; LoR…
                </p>
              </div>
            </>
          )}

          {/* ── Step 2: Scoring weights + interview mode ────────────── */}
          {step === 1 && (
            <>
              <WeightSlidersField value={weights} onChange={setWeights} disabled={submitting} />
              <div className="space-y-1.5">
                <Label htmlFor="job-int-mode">Interview mode</Label>
                <Select
                  value={form.watch("interviewMode")}
                  onValueChange={(v) =>
                    form.setValue("interviewMode", v as JobInterviewMode, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="job-int-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_INTERVIEW_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {INTERVIEW_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  How this job interviews — determines how the Interview weight above is read during
                  scoring.
                </p>
              </div>
            </>
          )}

          {/* ── Step 3: Colleges & drives ──────────────────────────── */}
          {step === 2 && mode === "create" && (
            <DriveSchedulerTable
              value={drives}
              onChange={(next) => setDrives(drivesWithDefaults(next))}
              colleges={colleges ?? []}
              templates={templates ?? []}
              section="schedule"
            />
          )}

          {/* ── Step 4: Eligibility (per college) ──────────────────── */}
          {step === 3 && mode === "create" && (
            <>
              <p className="text-xs text-muted-foreground">
                Optional. A blank filter means no restriction on that axis. Values carry over as
                your default next time.
              </p>
              <DriveSchedulerTable
                value={drives}
                onChange={setDrives}
                colleges={colleges ?? []}
                section="eligibility"
              />
            </>
          )}
        </form>

        <DialogFooter className="flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
          <div>
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={submitting}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            {!isLast ? (
              <Button type="button" onClick={goNext} disabled={submitting}>
                Next
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => submit(false)}
                  disabled={submitting || !weightsValid}
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save as draft
                </Button>
                <Button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={submitting || !weightsValid}
                  className="bg-gradient-brand text-primary-foreground shadow-soft"
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {mode === "edit" ? "Save & publish" : "Publish"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
