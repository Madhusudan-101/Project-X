import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import { jobsService } from "@/services/api/company/jobs";
import type {
  InterviewLevel,
  InterviewTemplate,
  RubricPreset,
  TemplateDraft,
} from "@/types/company/aiInterview";
import {
  LEVEL_LABEL,
  MAX_COMPETENCIES,
  MAX_DURATION,
  MIN_DURATION,
  draftFromTemplate,
  emptyCompetency,
  emptyDraft,
  toPayload,
  validateDraft,
  weightPercentages,
} from "./rubric";

const selectClass = "h-10 w-full rounded-md border bg-card px-3 text-sm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this interview; omit to create a new one. */
  template?: InterviewTemplate;
  onSaved?: (t: InterviewTemplate) => void;
}

export function TemplateFormDialog({ open, onOpenChange, template, onSaved }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft());
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(template ? draftFromTemplate(template) : emptyDraft());
    setShowErrors(false);
  }, [open, template]);

  const presets = useQuery<RubricPreset[]>({
    queryKey: ["company-ai-presets"],
    queryFn: companyAiInterviewService.presets,
    enabled: open && !template,
    staleTime: Infinity,
  });
  const jobs = useQuery({
    queryKey: ["company-ai-jobs"],
    queryFn: () => jobsService.list(),
    enabled: open,
    staleTime: 60_000,
  });

  const errors = validateDraft(draft);
  const pct = weightPercentages(draft.rubric);

  const save = useMutation({
    mutationFn: async (status: "draft" | "active") => {
      const body = toPayload(draft);
      if (!template) return companyAiInterviewService.create(body, status);
      return companyAiInterviewService.update(template.id, {
        ...body,
        clear_job: body.job_id === null && template.job_id !== null,
        job_id: body.job_id ?? undefined,
      });
    },
    onSuccess: (t) => {
      toast.success(template ? "Interview updated." : "Interview created.");
      qc.invalidateQueries({ queryKey: ["company-ai-interviews"] });
      onSaved?.(t);
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });

  const submit = (status: "draft" | "active") => {
    setShowErrors(true);
    if (errors.length === 0) save.mutate(status);
  };

  const patch = (p: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchComp = (i: number, p: Partial<TemplateDraft["rubric"][number]>) =>
    setDraft((d) => ({ ...d, rubric: d.rubric.map((c, k) => (k === i ? { ...c, ...p } : c)) }));

  const applyPreset = (id: string) => {
    const p = presets.data?.find((x) => x.id === id);
    if (!p) return;
    setDraft((d) => ({
      ...d,
      title: d.title || `${p.label} interview`,
      role_title: d.role_title || p.role_title,
      rubric: p.competencies.map(({ weight_pct: _p, ...c }) => ({ ...c })),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Edit interview" : "New AI interview"}</DialogTitle>
          <DialogDescription>
            Set up the role and the rubric. The AI interviewer asks about each competency in order
            and scores it. Candidates never see this rubric.
            {template &&
              " Changes apply to new interviews only: candidates who already started keep the rubric they were given."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!template && (
            <div className="space-y-1.5">
              <Label htmlFor="ai-preset">Start from a template (optional)</Label>
              <select
                id="ai-preset"
                className={selectClass}
                defaultValue=""
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="">Blank rubric</option>
                {presets.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-title">Interview title</Label>
              <Input
                id="ai-title"
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Backend Engineer, round 1"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-role">Role</Label>
              <Input
                id="ai-role"
                value={draft.role_title}
                onChange={(e) => patch({ role_title: e.target.value })}
                placeholder="Backend Engineer"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-level">Level</Label>
              <select
                id="ai-level"
                className={selectClass}
                value={draft.level}
                onChange={(e) => patch({ level: e.target.value as InterviewLevel })}
              >
                {Object.entries(LEVEL_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-duration">Duration (minutes)</Label>
              <Input
                id="ai-duration"
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                value={draft.duration_minutes}
                onChange={(e) => patch({ duration_minutes: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ai-job">Linked job (optional)</Label>
              <select
                id="ai-job"
                className={selectClass}
                value={draft.job_id ?? ""}
                onChange={(e) => patch({ job_id: e.target.value || null })}
              >
                <option value="">Not linked to a job</option>
                {jobs.data?.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ai-instructions">Message to candidates (optional)</Label>
              <Textarea
                id="ai-instructions"
                value={draft.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
                placeholder="Shown on the invitation. For example: what to expect, or who to contact."
                maxLength={1000}
                rows={2}
              />
            </div>
          </div>

          <section aria-labelledby="rubric-h" className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="rubric-h" className="text-sm font-semibold">
                  Rubric
                </h3>
                <p className="text-xs text-muted-foreground">
                  Weights show how much each competency counts toward the overall score.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={draft.rubric.length >= MAX_COMPETENCIES}
                onClick={() => patch({ rubric: [...draft.rubric, emptyCompetency()] })}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add competency
              </Button>
            </div>

            {draft.rubric.map((c, i) => (
              <fieldset key={i} className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  Competency {i + 1} · {pct[i]}% of the score
                </legend>
                <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`c-name-${i}`}>Name</Label>
                    <Input
                      id={`c-name-${i}`}
                      value={c.name}
                      onChange={(e) => patchComp(i, { name: e.target.value })}
                      placeholder="System design"
                      maxLength={60}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`c-weight-${i}`}>Weight</Label>
                    <Input
                      id={`c-weight-${i}`}
                      type="number"
                      min={1}
                      max={100}
                      value={c.weight}
                      onChange={(e) => patchComp(i, { weight: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove competency ${i + 1}`}
                      disabled={draft.rubric.length === 1}
                      onClick={() => patch({ rubric: draft.rubric.filter((_, k) => k !== i) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`c-desc-${i}`}>What to assess</Label>
                  <Textarea
                    id={`c-desc-${i}`}
                    value={c.description}
                    onChange={(e) => patchComp(i, { description: e.target.value })}
                    placeholder="What a strong answer looks like."
                    maxLength={500}
                    rows={2}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`c-q-${i}`}>Seed questions (one per line, up to 3)</Label>
                    <Textarea
                      id={`c-q-${i}`}
                      value={c.questions.join("\n")}
                      onChange={(e) => patchComp(i, { questions: e.target.value.split("\n") })}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`c-concepts-${i}`}>Expected concepts (optional)</Label>
                    <Textarea
                      id={`c-concepts-${i}`}
                      value={c.expected_concepts}
                      onChange={(e) => patchComp(i, { expected_concepts: e.target.value })}
                      placeholder="Terms and ideas a correct answer should show."
                      maxLength={600}
                      rows={3}
                    />
                  </div>
                </div>
              </fieldset>
            ))}
          </section>

          {showErrors && errors.length > 0 && (
            <ul
              role="alert"
              className="space-y-1 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {template ? (
            <Button
              disabled={save.isPending}
              onClick={() => submit(template.status === "active" ? "active" : "draft")}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={save.isPending} onClick={() => submit("draft")}>
                Save as draft
              </Button>
              <Button
                className="bg-gradient-brand text-primary-foreground"
                disabled={save.isPending}
                onClick={() => submit("active")}
              >
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create and
                activate
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
