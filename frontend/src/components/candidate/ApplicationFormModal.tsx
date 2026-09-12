import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { candidateJobsService } from "@/services/api/candidate/jobs";
import type { ApplicationDraft, ApplySubmission } from "@/types/jobs";

interface ApplicationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle?: string | null;
  submitting: boolean;
  onSubmit: (submission: ApplySubmission) => void;
}

export function ApplicationFormModal({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  submitting,
  onSubmit,
}: ApplicationFormModalProps) {
  const {
    data: draft,
    isLoading,
    isError,
    error,
  } = useQuery<ApplicationDraft>({
    queryKey: ["application-draft", jobId],
    queryFn: () => candidateJobsService.createApplicationDraft(jobId),
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [coverLetter, setCoverLetter] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Prefill from the draft once it lands (and reset when the modal reopens).
  useEffect(() => {
    if (!open || !draft) return;
    setCoverLetter(draft.coverLetter);
    // A flagged question's drafted "answer" is just a hint ("[Add your notice
    // period]") — seed it EMPTY so the blank check catches an untouched one;
    // the hint is shown as placeholder text instead (see the Textarea below).
    setAnswers(
      Object.fromEntries(
        draft.screeningAnswers.map((a) => [a.questionId, a.studentInputRequired ? "" : a.answer]),
      ),
    );
  }, [open, draft]);

  const questions = useMemo(() => draft?.screeningAnswers ?? [], [draft]);
  const missingRequired = useMemo(
    () =>
      questions
        .filter((q) => q.required && !(answers[q.questionId] ?? "").trim())
        .map((q) => q.questionText),
    [questions, answers],
  );

  const submit = () => {
    if (missingRequired.length > 0) {
      toast.error("Answer every required question before submitting.");
      return;
    }
    onSubmit({
      coverLetter: coverLetter.trim() || null,
      screeningAnswers: questions.map((q) => ({
        questionId: q.questionId,
        answer: (answers[q.questionId] ?? "").trim(),
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !submitting && onOpenChange(n)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply{jobTitle ? ` — ${jobTitle}` : ""}</DialogTitle>
          <DialogDescription>
            We&apos;ve drafted a cover letter and answers from your resume. Edit anything, fill the
            flagged blanks, then submit.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Drafting your cover letter and answers…
          </div>
        ) : isError ? (
          <div className="py-8 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not draft your application."}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="af-cover" className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Cover letter
              </Label>
              <Textarea
                id="af-cover"
                rows={10}
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                placeholder="Your cover letter…"
              />
            </div>

            {questions.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Screening questions
                </p>
                {questions.map((q) => {
                  const val = answers[q.questionId] ?? "";
                  const needsInput = q.studentInputRequired && !val.trim();
                  return (
                    <div key={q.questionId} className="space-y-1.5">
                      <Label
                        htmlFor={`af-q-${q.questionId}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span>
                          {q.questionText}
                          {q.required && <span className="text-destructive"> *</span>}
                        </span>
                        {q.studentInputRequired && (
                          <Badge
                            variant="outline"
                            className="border-amber-400/50 bg-amber-50/60 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                          >
                            needs your input
                          </Badge>
                        )}
                      </Label>
                      <Textarea
                        id={`af-q-${q.questionId}`}
                        rows={2}
                        value={val}
                        placeholder={q.studentInputRequired ? q.answer : undefined}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [q.questionId]: e.target.value }))
                        }
                        className={needsInput ? "border-amber-400/60" : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || isLoading || isError}
            className="bg-gradient-brand text-primary-foreground shadow-soft"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
