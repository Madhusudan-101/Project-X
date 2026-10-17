import type { OAOverview } from "@/types/candidate/assessment";

const KIND = { coding: "Coding", sql: "SQL", mcq: "Multiple choice" } as const;

/** Step 1: what the test is, how it behaves, what is monitored. Everything here comes from the assessment. */
export function InstructionsStep({ oa }: { oa: OAOverview }) {
  const hasCoding = oa.sections.some((s) => s.kind !== "mcq");
  const rules: React.ReactNode[] = [
    <>
      This test has <b>{oa.sections.length}</b> section{oa.sections.length === 1 ? "" : "s"} and{" "}
      <b>{oa.totalQuestions}</b> question{oa.totalQuestions === 1 ? "" : "s"},{" "}
      <b>{oa.totalDurationMinutes} minutes</b> in total. Each section has its own time limit.
    </>,
    <>
      Once you move past a section you <b>cannot return</b> to it, and unused time does <b>not</b>{" "}
      carry over to the next one.
    </>,
    <>
      The timer runs on our server. Refreshing, losing your connection or closing the tab does{" "}
      <b>not</b> pause it, so make sure you will not be interrupted.
    </>,
    <>
      Your answers save automatically as you work. You can change an answer any time before its
      section closes.
    </>,
    ...(hasCoding
      ? [
          <>
            For coding questions choose a language (
            {"Python, JavaScript, Java or C++ where offered"}). <b>Run</b> checks your code on the
            examples and your own input; <b>Submit</b> grades it against every test, including
            hidden ones. <b>Only submitted solutions are scored</b>, and your best submission
            counts.
          </>,
        ]
      : []),
    <>
      Use a laptop or desktop with a stable internet connection, close other apps and notifications,
      and keep your charger connected.
    </>,
    <>
      Do not copy code from any source, share the questions, or use AI tools or other people for
      help. Your code is compared with other candidates&apos; solutions for the same question.
    </>,
  ];

  const monitored: React.ReactNode[] = [
    <>
      Switching tabs or windows, leaving fullscreen, and copying or pasting are recorded with the
      time and the question you were on.
    </>,
    ...(oa.webcamMode !== "off"
      ? [
          <>
            Your camera is switched on and a photo is taken about every{" "}
            {Math.max(1, Math.round(oa.snapshotIntervalSeconds / 60))} minute
            {oa.snapshotIntervalSeconds >= 90 ? "s" : ""}. Photos are shown to the hiring team and
            deleted after {oa.snapshotRetentionDays} days. No audio or video is recorded.
            {oa.webcamMode === "optional" ? " Camera access is optional for this test." : ""}
          </>,
        ]
      : []),
    ...(oa.monitorMode !== "off"
      ? [
          <>
            {oa.monitorMode === "required"
              ? "Only one display may be connected. The test will not start with an extra monitor attached."
              : "We check whether more than one display is connected and note it for the hiring team."}
          </>,
        ]
      : []),
    <>
      Take the test on your own, in a quiet place. Suspicious activity is flagged to the hiring team
      for review; a flag alone is never a verdict.
    </>,
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-2xl font-semibold">Instructions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Please read these carefully before you begin.
        </p>
        <ol className="mt-5 list-decimal space-y-2.5 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
          {rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold">Assessment integrity</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
          {monitored.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold">Test format</h3>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Section</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Questions</th>
                <th className="px-4 py-2.5 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {oa.sections.map((s) => (
                <tr key={s.position} className="border-t border-border">
                  <td className="px-4 py-3 tabular-nums">{s.position}</td>
                  <td className="px-4 py-3 font-medium">{s.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{KIND[s.kind]}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.questionCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.durationMinutes} min</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30 font-medium">
                <td className="px-4 py-3" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{oa.totalQuestions}</td>
                <td className="px-4 py-3 text-right tabular-nums">{oa.totalDurationMinutes} min</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {hasCoding && !oa.codingEnabled && (
        <p className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Code execution is not switched on for this assessment right now, so Run and Submit will be
          unavailable. Contact the recruiter before you start.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        If you face a genuine technical problem before the test begins, contact the recruitment team
        right away. Good luck!
      </p>
    </div>
  );
}
