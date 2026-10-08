import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type {
  Assessment,
  AssessmentDraft,
  InviteMode,
  McqDraft,
  SectionDraft,
} from "@/types/company/assessment";
import { ProblemPicker } from "./ProblemPicker";

const emptyMcq = (): McqDraft => ({
  title: "",
  prompt: "",
  options: ["", "", "", ""],
  correctOption: 0,
  points: 10,
});

function draftFrom(a: Assessment | null): AssessmentDraft {
  if (!a) return { title: "", inviteMode: "invited", sections: [] };
  return {
    title: a.title,
    inviteMode: a.inviteMode,
    // MCQ text isn't returned by the overview; editing an existing template-based
    // assessment re-creates its coding sections only. MCQ sections must be re-entered.
    sections: a.sections
      .filter((s) => s.kind !== "mcq")
      .map((s) => ({
        title: s.title,
        kind: s.kind,
        durationMinutes: s.durationMinutes,
        questions: s.questions
          .filter((q) => q.problemId)
          .map((q) => ({ problemId: q.problemId!, problemTitle: q.title, points: q.points })),
      })),
  };
}

export function AssessmentBuilderDialog({
  open,
  onOpenChange,
  jobId,
  driveId,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  driveId: string;
  existing: Assessment | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AssessmentDraft>(() => draftFrom(existing));
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(existing));
      setPickerFor(null);
    }
  }, [open, existing]);

  const sections = draft.sections ?? [];
  const setSections = (next: SectionDraft[]) => setDraft((d) => ({ ...d, sections: next }));
  const patchSection = (i: number, patch: Partial<SectionDraft>) =>
    setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = useMutation({
    mutationFn: () => companyAssessmentService.save(jobId, driveId, draft),
    onSuccess: () => {
      toast.success("Assessment saved.");
      queryClient.invalidateQueries({ queryKey: ["company-oa", jobId, driveId] });
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't save the assessment."),
  });

  const total = sections.reduce((n, s) => n + s.durationMinutes, 0);
  const valid =
    draft.title.trim().length > 0 &&
    sections.length > 0 &&
    sections.every(
      (s) =>
        s.title.trim() &&
        s.durationMinutes >= 1 &&
        s.questions.length > 0 &&
        s.questions.every(
          (q) =>
            q.problemId ||
            (q.mcq &&
              q.mcq.prompt.trim() &&
              q.mcq.title.trim() &&
              q.mcq.options.filter((o) => o.trim()).length >= 2 &&
              q.mcq.options[q.mcq.correctOption]?.trim()),
        ),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit assessment" : "Build an assessment"}</DialogTitle>
          <DialogDescription>
            Each section is timed on its own and can&apos;t be revisited once a candidate moves on.
            Total: <b>{total} minutes</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="space-y-1.5">
              <Label htmlFor="oa-title">Title</Label>
              <Input
                id="oa-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Backend Engineer — Online Assessment"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oa-mode">Who can take it</Label>
              <select
                id="oa-mode"
                value={draft.inviteMode}
                onChange={(e) => setDraft({ ...draft, inviteMode: e.target.value as InviteMode })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="invited">Only invited applicants</option>
                <option value="all">All eligible applicants</option>
              </select>
            </div>
          </div>

          {sections.map((s, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[10rem] flex-1 space-y-1.5">
                  <Label>Section {i + 1} title</Label>
                  <Input
                    value={s.title}
                    onChange={(e) => patchSection(i, { title: e.target.value })}
                  />
                </div>
                <div className="w-28 space-y-1.5">
                  <Label>Minutes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={s.durationMinutes}
                    onChange={(e) => patchSection(i, { durationMinutes: Number(e.target.value) })}
                  />
                </div>
                <span className="pb-2 text-xs uppercase text-muted-foreground">
                  {s.kind === "mcq" ? "Multiple choice" : "Coding"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove section ${i + 1}`}
                  onClick={() => setSections(sections.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {s.kind !== "mcq" ? (
                <>
                  {s.questions.map((q, qi) => (
                    <div
                      key={qi}
                      className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {q.problemTitle ?? q.problemId}
                      </span>
                      <Label className="text-xs text-muted-foreground">Points</Label>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20"
                        value={q.points ?? 100}
                        onChange={(e) =>
                          patchSection(i, {
                            questions: s.questions.map((x, k) =>
                              k === qi ? { ...x, points: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove problem"
                        onClick={() =>
                          patchSection(i, { questions: s.questions.filter((_, k) => k !== qi) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {pickerFor === i ? (
                    <ProblemPicker
                      chosen={new Set(s.questions.map((q) => q.problemId!))}
                      onAdd={(p) =>
                        patchSection(i, {
                          questions: [
                            ...s.questions,
                            { problemId: p.id, problemTitle: p.title, points: 100 },
                          ],
                        })
                      }
                    />
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setPickerFor(i)}>
                      <Plus className="mr-1.5 h-4 w-4" /> Add problems from the library
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {s.questions.map((q, qi) => (
                    <McqEditor
                      key={qi}
                      value={q.mcq!}
                      onChange={(mcq) =>
                        patchSection(i, {
                          questions: s.questions.map((x, k) => (k === qi ? { mcq } : x)),
                        })
                      }
                      onRemove={() =>
                        patchSection(i, { questions: s.questions.filter((_, k) => k !== qi) })
                      }
                    />
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchSection(i, { questions: [...s.questions, { mcq: emptyMcq() }] })
                    }
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Add question
                  </Button>
                </>
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setSections([
                  ...sections,
                  {
                    title: `Coding ${sections.length + 1}`,
                    kind: "coding",
                    durationMinutes: 30,
                    questions: [],
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Coding section
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setSections([
                  ...sections,
                  {
                    title: "Aptitude",
                    kind: "mcq",
                    durationMinutes: 15,
                    questions: [{ mcq: emptyMcq() }],
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Multiple-choice section
            </Button>
          </div>

          {existing && existing.sections.some((s) => s.kind === "mcq") && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Saving rebuilds the assessment from this form. Existing multiple-choice sections
              aren&apos;t loaded here, so re-add any you want to keep.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!valid || save.isPending}
              onClick={() => save.mutate()}
              className="bg-gradient-brand text-primary-foreground"
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save assessment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function McqEditor({
  value,
  onChange,
  onRemove,
}: {
  value: McqDraft;
  onChange: (v: McqDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <div className="flex gap-2">
        <Input
          placeholder="Short title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
        <Input
          type="number"
          min={0}
          className="w-24"
          aria-label="Points"
          value={value.points}
          onChange={(e) => onChange({ ...value, points: Number(e.target.value) })}
        />
        <Button variant="ghost" size="icon" aria-label="Remove question" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        placeholder="Question"
        rows={2}
        value={value.prompt}
        onChange={(e) => onChange({ ...value, prompt: e.target.value })}
      />
      {value.options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            name={`correct-${value.title}-${value.prompt.length}`}
            checked={value.correctOption === i}
            onChange={() => onChange({ ...value, correctOption: i })}
            aria-label={`Option ${i + 1} is correct`}
          />
          <Input
            placeholder={`Option ${i + 1}`}
            value={o}
            onChange={(e) =>
              onChange({
                ...value,
                options: value.options.map((x, k) => (k === i ? e.target.value : x)),
              })
            }
          />
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Select the radio next to the correct option.
      </p>
    </div>
  );
}
