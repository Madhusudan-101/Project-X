import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Play, Send, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";
import type {
  CodeLanguage,
  OACaseResult,
  OAQuestion,
  OARunResult,
  OASubmitResult,
  Verdict,
} from "@/types/candidate/assessment";
import { CodeEditor } from "./CodeEditor";
import { SafeHtml } from "./SafeHtml";

const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  runtime_error: "Runtime error",
  compile_error: "Compile error",
  time_limit: "Time limit exceeded",
  judge_error: "Judge error",
};

interface Props {
  applicationId: string;
  question: OAQuestion;
  language: CodeLanguage;
  code: string;
  codingEnabled: boolean;
  onEdit: (code: string, language: CodeLanguage) => void;
  onPaste: () => void;
  /** Called after a graded submission so the runner can show progress. */
  onSubmitted: (result: OASubmitResult) => void;
  best: OASubmitResult | null;
}

export function CodingWorkspace({
  applicationId,
  question,
  language,
  code,
  codingEnabled,
  onEdit,
  onPaste,
  onSubmitted,
  best,
}: Props) {
  const problem = question.problem!;
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [result, setResult] = useState<(OARunResult & { submit?: OASubmitResult }) | null>(null);
  const [activeCase, setActiveCase] = useState(0);

  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong running your code.");

  const run = useMutation({
    mutationFn: () => {
      let customArgs: unknown[] | null = null;
      if (showCustom && custom.trim()) {
        const parsed = JSON.parse(custom);
        if (!Array.isArray(parsed))
          throw new Error("Custom input must be a JSON array of arguments.");
        customArgs = parsed;
      }
      return candidateAssessmentService.runCode(applicationId, question.id, {
        language,
        source: code,
        customArgs,
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setActiveCase(showCustom && custom.trim() ? Math.max(0, r.cases.length - 1) : 0);
    },
    onError: (e) =>
      fail(
        e instanceof SyntaxError
          ? new Error("Custom input isn't valid JSON, e.g. [[2,7,11],9].")
          : e,
      ),
  });

  const submit = useMutation({
    mutationFn: () =>
      candidateAssessmentService.submitCode(applicationId, question.id, { language, source: code }),
    onSuccess: (r) => {
      setResult({ ...r, submit: r });
      setActiveCase(0);
      onSubmitted(r);
      if (r.verdict === "accepted") toast.success("All tests passed!");
    },
    onError: fail,
  });

  const busy = run.isPending || submit.isPending;
  const shown: OACaseResult | undefined =
    result?.cases[Math.min(activeCase, (result?.cases.length ?? 1) - 1)];

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Problem */}
      <Card className="max-h-[calc(100vh-11rem)] space-y-5 overflow-y-auto p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {question.points} points
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold">{question.title}</h2>
        </div>
        <SafeHtml html={question.prompt} />
        {problem.examples.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Examples</h3>
            {problem.examples.map((ex, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
              >
                <div>
                  <span className="text-muted-foreground">Input: </span>
                  {ex.input}
                </div>
                <div>
                  <span className="text-muted-foreground">Output: </span>
                  {ex.expected}
                </div>
              </div>
            ))}
          </div>
        )}
        {problem.constraintsHtml && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Constraints</h3>
            <SafeHtml html={`<ul>${problem.constraintsHtml}</ul>`} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Define{" "}
          <code className="font-mono">
            {language === "python" ? snake(problem.functionName) : problem.functionName}
          </code>{" "}
          — keep its name and parameters. <b>Run</b> checks the examples; <b>Submit</b> grades all
          tests and only submitted solutions are scored.
        </p>
      </Card>

      {/* Editor + results */}
      <div className="flex min-w-0 flex-col gap-3">
        <CodeEditor
          languages={problem.languages}
          language={language}
          value={code}
          onChange={(c) => onEdit(c, language)}
          onLanguageChange={(l) => onEdit(code, l as CodeLanguage)}
          onPaste={onPaste}
        />

        {showCustom && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`custom-${question.id}`}>
              Custom input — a JSON array holding the arguments in order, like the examples above
            </label>
            <textarea
              id={`custom-${question.id}`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              rows={2}
              placeholder="[[2,7,11,15], 9]"
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => run.mutate()} disabled={busy || !codingEnabled}>
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={busy || !codingEnabled}
            className="bg-gradient-brand text-primary-foreground"
          >
            {submit.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Submit
          </Button>
          <button
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowCustom((v) => !v)}
          >
            {showCustom ? "Hide custom input" : "Test with custom input"}
          </button>
          {best && (
            <Badge
              variant="outline"
              className="ml-auto border-primary/30 bg-primary/10 text-primary"
            >
              Best: {best.passed}/{best.total} tests · {best.score}/{best.points} pts
            </Badge>
          )}
        </div>
        {!codingEnabled && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Code execution isn&apos;t enabled for this assessment, so Run and Submit are
            unavailable. Your code is still saved automatically.
          </p>
        )}

        {/* Results */}
        {result && (
          <Card className="space-y-3 p-4" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  result.verdict === "accepted"
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }
              >
                {VERDICT_LABEL[result.verdict]}
              </Badge>
              {result.submit && (
                <span className="text-xs text-muted-foreground">
                  Passed {result.submit.passed}/{result.submit.total} tests
                  {result.submit.hiddenTotal > 0 &&
                    ` (hidden ${result.submit.hiddenPassed}/${result.submit.hiddenTotal})`}{" "}
                  · {result.submit.score}/{result.submit.points} pts ·{" "}
                  {result.submit.submissionsLeft} submission
                  {result.submit.submissionsLeft === 1 ? "" : "s"} left
                </span>
              )}
            </div>

            {result.compileError && (
              <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">
                {result.compileError}
              </pre>
            )}
            {result.crash && (
              <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">
                {result.crash}
              </pre>
            )}

            {result.cases.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2">
                  {result.cases.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveCase(i)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs " +
                        (i === activeCase
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted")
                      }
                    >
                      {c.status === "pass" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      ) : c.status === "ran" ? (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      {c.label}
                    </button>
                  ))}
                </div>
                {shown && (
                  <dl className="space-y-2 font-mono text-xs">
                    <Field label="Input" value={shown.input} />
                    {shown.expected !== null && <Field label="Expected" value={shown.expected} />}
                    {shown.actual !== null && (
                      <Field
                        label="Your output"
                        value={shown.actual}
                        bad={shown.status === "fail"}
                      />
                    )}
                    {shown.error && <Field label="Error" value={shown.error} bad />}
                  </dl>
                )}
              </>
            )}

            {result.stdout.trim() && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Your printed output</p>
                <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
                  {result.stdout}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="mb-0.5 font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          "overflow-x-auto whitespace-pre rounded-md border px-2.5 py-1.5 " +
          (bad
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-border bg-muted/30")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function snake(name: string): string {
  return name
    .replace(/(.)([A-Z][a-z]+)/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
