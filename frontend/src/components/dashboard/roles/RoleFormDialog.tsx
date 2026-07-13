import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { EXPERIENCE_LEVELS } from "@/types/role";
import type { Role } from "@/types/role";
import { rolesService } from "@/services/api/roles";
import { ApiClientError } from "@/services/api/client";

// ── Validation ─────────────────────────────────────────────────────────

const schema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(150),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(5000),
  experienceLevel: z.string().min(1, "Select an experience level"),
  deadline: z.string().min(1, "Select a deadline"),
  minimumEmployabilityScore: z.coerce
    .number()
    .min(0, "Score must be between 0 and 100")
    .max(100, "Score must be between 0 and 100"),
});

type FormValues = z.infer<typeof schema>;

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
  const [skillInput, setSkillInput] = useState("");
  const [skillsError, setSkillsError] = useState("");
  const skillInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      experienceLevel: "",
      deadline: "",
      minimumEmployabilityScore: 0,
    },
  });

  // Reset form + skills whenever the dialog opens (create → blank, edit → hydrated)
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && role) {
      form.reset({
        title: role.title,
        description: role.description,
        experienceLevel: role.experienceLevel,
        deadline: role.deadline,
        minimumEmployabilityScore: role.minimumEmployabilityScore,
      });
      setSkills(role.requiredSkills);
    } else {
      form.reset({
        title: "",
        description: "",
        experienceLevel: "",
        deadline: "",
        minimumEmployabilityScore: 0,
      });
      setSkills([]);
    }
    setSkillInput("");
    setSkillsError("");
  }, [open, mode, role, form]);

  // ── Skill tag helpers ─────────────────────────────────────────────

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (!trimmed) return;
    if (skills.includes(trimmed)) {
      setSkillInput("");
      return;
    }
    if (skills.length >= 30) {
      setSkillsError("Maximum 30 skills allowed");
      return;
    }
    setSkills((prev) => [...prev, trimmed]);
    setSkillInput("");
    setSkillsError("");
  };

  const removeSkill = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
    setSkillsError("");
  };

  const handleSkillKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill();
    }
    if (e.key === "Backspace" && skillInput === "" && skills.length > 0) {
      setSkills((prev) => prev.slice(0, -1));
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    if (skills.length === 0) {
      setSkillsError("Add at least one required skill");
      skillInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: values.title,
        description: values.description,
        requiredSkills: skills,
        experienceLevel: values.experienceLevel,
        deadline: values.deadline,
        minimumEmployabilityScore: values.minimumEmployabilityScore,
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
          <div className="space-y-1.5">
            <Label htmlFor="role-skill-input">
              Required skills <span className="text-muted-foreground">(at least one)</span>
            </Label>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="list" aria-label="Required skills">
                {skills.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    role="listitem"
                    className="gap-1 border-primary/30 bg-primary/5 pr-1 text-primary"
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => removeSkill(s)}
                      aria-label={`Remove ${s}`}
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
                id="role-skill-input"
                ref={skillInputRef}
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder='e.g. "React" then press Enter'
                aria-invalid={!!skillsError}
                aria-describedby={skillsError ? "skills-error" : undefined}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addSkill}
                aria-label="Add skill"
                className="shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {skillsError && (
              <p id="skills-error" role="alert" className="text-xs text-destructive">
                {skillsError}
              </p>
            )}
          </div>

          {/* Experience level + Deadline */}
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
