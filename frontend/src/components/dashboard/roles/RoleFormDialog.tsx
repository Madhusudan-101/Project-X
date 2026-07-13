import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { EXPERIENCE_LEVELS, ROLE_TYPES } from "@/types/role";
import type { JdExtractionResult, Role } from "@/types/role";
import { rolesService } from "@/services/api/roles";
import { ApiClientError } from "@/services/api/client";
import { TagListInput, type TagListInputHandle } from "./TagListInput";
import { JobDescriptionUploadPanel } from "./JobDescriptionUploadPanel";

// ── Validation ─────────────────────────────────────────────────────────

const schema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(150),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(5000),
  experienceLevel: z.string().min(1, "Select an experience level"),
  roleType: z.string().optional(),
  deadline: z.string().min(1, "Select a deadline"),
  minimumEmployabilityScore: z.coerce
    .number()
    .min(0, "Score must be between 0 and 100")
    .max(100, "Score must be between 0 and 100"),
});

type FormValues = z.infer<typeof schema>;

const BLANK_VALUES: FormValues = {
  title: "",
  description: "",
  experienceLevel: "",
  roleType: "",
  deadline: "",
  minimumEmployabilityScore: 0,
};

// ── Component ──────────────────────────────────────────────────────────

interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  role?: Role | null;
  onSuccess: (role: Role) => void;
}

export function RoleFormDialog({ open, onOpenChange, mode, role, onSuccess }: RoleFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillsError, setSkillsError] = useState("");
  const [preferredQualifications, setPreferredQualifications] = useState<string[]>([]);
  const [jobDescriptionPath, setJobDescriptionPath] = useState<string | undefined>(undefined);
  const skillsInputRef = useRef<TagListInputHandle>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: BLANK_VALUES,
  });

  // Reset form + tag lists whenever the dialog opens (create → blank, edit → hydrated)
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && role) {
      form.reset({
        title: role.title,
        description: role.description,
        experienceLevel: role.experienceLevel,
        roleType: role.roleType ?? "",
        deadline: role.deadline,
        minimumEmployabilityScore: role.minimumEmployabilityScore,
      });
      setSkills(role.requiredSkills);
      setPreferredQualifications(role.preferredQualifications);
      setJobDescriptionPath(role.jobDescriptionPath ?? undefined);
    } else {
      form.reset(BLANK_VALUES);
      setSkills([]);
      setPreferredQualifications([]);
      setJobDescriptionPath(undefined);
    }
    setSkillsError("");
  }, [open, mode, role, form]);

  // ── AI extraction → pre-fill the form for review ─────────────────────

  const handleExtracted = (result: JdExtractionResult) => {
    if (result.title) form.setValue("title", result.title, { shouldValidate: true });
    if (result.description)
      form.setValue("description", result.description, { shouldValidate: true });
    if (result.experienceLevel) {
      form.setValue("experienceLevel", result.experienceLevel, { shouldValidate: true });
    }
    if (result.roleType) form.setValue("roleType", result.roleType, { shouldValidate: true });
    if (result.requiredSkills.length > 0) {
      setSkills(result.requiredSkills);
      setSkillsError("");
    }
    if (result.preferredQualifications.length > 0) {
      setPreferredQualifications(result.preferredQualifications);
    }
    setJobDescriptionPath(result.storagePath);
  };

  // ── Submit ─────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    if (skills.length === 0) {
      setSkillsError("Add at least one required skill");
      skillsInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: values.title,
        description: values.description,
        requiredSkills: skills,
        experienceLevel: values.experienceLevel,
        ...(values.roleType && { roleType: values.roleType }),
        preferredQualifications,
        deadline: values.deadline,
        minimumEmployabilityScore: values.minimumEmployabilityScore,
        ...(jobDescriptionPath && { jobDescriptionPath }),
      };

      const saved =
        mode === "edit" && role
          ? await rolesService.update(role.id, payload)
          : await rolesService.create(payload);

      toast.success(mode === "edit" ? "Role updated." : "Role created as draft.");
      onSuccess(saved);
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit role" : "Create a new role"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the details of this role."
              : "New roles start as a draft — publish when you're ready for candidates to see it."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {mode === "create" && (
            <JobDescriptionUploadPanel onExtracted={handleExtracted} disabled={submitting} />
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="role-title">Title</Label>
            <Input
              id="role-title"
              placeholder="e.g. Frontend Engineer Intern"
              aria-required="true"
              aria-invalid={!!form.formState.errors.title}
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              placeholder="Responsibilities, expectations, and what a great candidate looks like…"
              rows={5}
              aria-required="true"
              aria-invalid={!!form.formState.errors.description}
              {...form.register("description")}
            />
            {form.formState.errors.description && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          {/* Required skills */}
          <TagListInput
            ref={skillsInputRef}
            id="role-skill-input"
            label="Required skills"
            hint="(at least one)"
            values={skills}
            onChange={(next) => {
              setSkills(next);
              setSkillsError("");
            }}
            placeholder='e.g. "React" then press Enter'
            error={skillsError}
          />

          {/* Experience level + Role type */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-experience">Experience level</Label>
              <Select
                value={form.watch("experienceLevel") || undefined}
                onValueChange={(v) => form.setValue("experienceLevel", v, { shouldValidate: true })}
              >
                <SelectTrigger
                  id="role-experience"
                  aria-required="true"
                  aria-invalid={!!form.formState.errors.experienceLevel}
                >
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  {EXPERIENCE_LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>
                      {lvl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.experienceLevel && (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.experienceLevel.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-type">
                Role type <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={form.watch("roleType") || undefined}
                onValueChange={(v) => form.setValue("roleType", v, { shouldValidate: true })}
              >
                <SelectTrigger id="role-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preferred qualifications */}
          <TagListInput
            id="role-preferred-qualifications-input"
            label="Preferred qualifications"
            hint="(optional)"
            values={preferredQualifications}
            onChange={setPreferredQualifications}
            placeholder='e.g. "AWS certification" then press Enter'
          />

          {/* Deadline */}
          <div className="space-y-1.5">
            <Label htmlFor="role-deadline">Application deadline</Label>
            <Input
              id="role-deadline"
              type="date"
              min={todayIso}
              aria-required="true"
              aria-invalid={!!form.formState.errors.deadline}
              {...form.register("deadline")}
            />
            {form.formState.errors.deadline && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.deadline.message}
              </p>
            )}
          </div>

          {/* Minimum employability score */}
          <div className="space-y-1.5">
            <Label htmlFor="role-min-score">Minimum employability score (0–100)</Label>
            <Input
              id="role-min-score"
              type="number"
              min={0}
              max={100}
              aria-invalid={!!form.formState.errors.minimumEmployabilityScore}
              {...form.register("minimumEmployabilityScore")}
            />
            {form.formState.errors.minimumEmployabilityScore && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.minimumEmployabilityScore.message}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-gradient-brand text-primary-foreground shadow-soft"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : mode === "edit" ? (
                "Save changes"
              ) : (
                "Create role"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
