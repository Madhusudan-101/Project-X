/** Pure helpers for the interview builder, invites and results (no React). */

import type {
  Competency,
  Decision,
  InterviewTemplate,
  InviteResult,
  InviteStatus,
  ResultRow,
  TemplateDraft,
  TemplateStatus,
} from "@/types/company/aiInterview";

export const MAX_COMPETENCIES = 8;
export const MAX_QUESTIONS = 3;
export const MIN_DURATION = 10;
export const MAX_DURATION = 60;

export const emptyCompetency = (): Competency => ({
  name: "",
  description: "",
  weight: 20,
  questions: [],
  expected_concepts: "",
});

export const emptyDraft = (): TemplateDraft => ({
  title: "",
  role_title: "",
  level: "junior",
  job_id: null,
  instructions: "",
  duration_minutes: 20,
  rubric: [emptyCompetency()],
});

export const draftFromTemplate = (t: InterviewTemplate): TemplateDraft => ({
  title: t.title,
  role_title: t.role_title,
  level: t.level,
  job_id: t.job_id,
  instructions: t.instructions,
  duration_minutes: t.duration_minutes,
  rubric: t.rubric.map(({ weight_pct: _pct, ...c }) => ({ ...c })),
});

/** Each weight as a whole percentage of the total, summing to exactly 100 (largest remainder).
 *  Matches the server, so the numbers on screen are the numbers the report uses. */
export function weightPercentages(rubric: Pick<Competency, "weight">[]): number[] {
  const weights = rubric.map((c) => Math.max(0, Math.round(Number(c.weight) || 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w * 100) / total);
  const floors = exact.map(Math.floor);
  const order = exact
    .map((x, i) => ({ i, rem: x - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const leftover = 100 - floors.reduce((a, b) => a + b, 0);
  for (let k = 0; k < leftover; k++) floors[order[k].i] += 1;
  return floors;
}

/** Everything wrong with a draft, in plain words. Empty means it can be saved. */
export function validateDraft(d: TemplateDraft): string[] {
  const errors: string[] = [];
  if (d.title.trim().length < 2) errors.push("Give the interview a title.");
  if (d.role_title.trim().length < 2) errors.push("Enter the role you are hiring for.");
  if (
    !Number.isInteger(d.duration_minutes) ||
    d.duration_minutes < MIN_DURATION ||
    d.duration_minutes > MAX_DURATION
  )
    errors.push(`Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes.`);
  if (d.rubric.length === 0) errors.push("Add at least one competency.");
  if (d.rubric.length > MAX_COMPETENCIES)
    errors.push(`Use at most ${MAX_COMPETENCIES} competencies.`);
  const seen = new Set<string>();
  d.rubric.forEach((c, i) => {
    const label = c.name.trim() || `Competency ${i + 1}`;
    if (c.name.trim().length < 2) errors.push(`${label}: enter a name.`);
    else if (seen.has(c.name.trim().toLowerCase()))
      errors.push(`${label}: names must be different.`);
    seen.add(c.name.trim().toLowerCase());
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)
      errors.push(`${label}: weight must be a whole number from 1 to 100.`);
    const qs = c.questions.map((q) => q.trim()).filter(Boolean);
    if (qs.length > MAX_QUESTIONS)
      errors.push(`${label}: at most ${MAX_QUESTIONS} seed questions.`);
    if (qs.some((q) => q.length > 300))
      errors.push(`${label}: each seed question must be 300 characters or fewer.`);
  });
  return errors;
}

/** The request body: trimmed text, blank seed questions dropped. */
export function toPayload(d: TemplateDraft): TemplateDraft {
  return {
    ...d,
    title: d.title.trim(),
    role_title: d.role_title.trim(),
    instructions: d.instructions.trim(),
    rubric: d.rubric.map((c) => ({
      name: c.name.trim(),
      description: c.description.trim(),
      weight: c.weight,
      questions: c.questions.map((q) => q.trim()).filter(Boolean),
      expected_concepts: c.expected_concepts.trim(),
    })),
  };
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** Split pasted text (commas, semicolons, spaces, new lines) into unique lowercase emails. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (EMAIL.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  invited: "Invited",
  started: "In progress",
  completed: "Completed",
  revoked: "Withdrawn",
  expired: "Expired",
};

export const DECISION_LABEL: Record<Decision, string> = {
  advance: "Advance",
  hold: "Hold",
  reject: "Reject",
};

export const LEVEL_LABEL = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
};

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export const STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/** One sentence for the toast after inviting: who was invited and whether emails went out. */
export function describeInviteResult(r: InviteResult): string {
  const parts = [
    r.invited && `${r.invited} invited`,
    r.reinvited && `${r.reinvited} invited again`,
    r.already_invited && `${r.already_invited} already invited`,
    r.already_taken && `${r.already_taken} already took it`,
  ].filter(Boolean) as string[];
  const mail =
    r.emails_sent > 0
      ? `${r.emails_sent} email${r.emails_sent === 1 ? "" : "s"} sent`
      : r.invited + r.reinvited > 0
        ? "no emails sent (email isn't set up), candidates still see it on their dashboard"
        : "";
  const failed =
    r.emails_failed > 0 ? `${r.emails_failed} email${r.emails_failed === 1 ? "" : "s"} failed` : "";
  return [parts.join(", "), mail, failed].filter(Boolean).join(". ") + ".";
}

// ---- Results: sorting, filtering, export ----

export type ResultSort = "recent" | "score" | "name" | "flags";
export type ResultFilter = "all" | "flagged" | "undecided" | "incomplete";

type RowLike = Pick<
  ResultRow,
  | "name"
  | "email"
  | "overall_score"
  | "completed_at"
  | "started_at"
  | "integrity"
  | "decision"
  | "incomplete"
  | "integrity_review"
>;

const isFlagged = (r: RowLike) => r.integrity.total > 0 && r.integrity_review !== "dismissed";

export function filterRows<T extends RowLike>(rows: T[], filter: ResultFilter): T[] {
  switch (filter) {
    case "flagged":
      return rows.filter(isFlagged);
    case "undecided":
      return rows.filter((r) => !r.decision);
    case "incomplete":
      return rows.filter((r) => r.incomplete);
    default:
      return rows;
  }
}

/** Returns a new array. Unscored rows always sort last when ranking by score. */
export function sortRows<T extends RowLike>(rows: T[], sort: ResultSort): T[] {
  const out = [...rows];
  const when = (r: RowLike) => r.completed_at ?? r.started_at ?? "";
  switch (sort) {
    case "score":
      return out.sort((a, b) => {
        if (a.overall_score === null && b.overall_score === null) return 0;
        if (a.overall_score === null) return 1;
        if (b.overall_score === null) return -1;
        return b.overall_score - a.overall_score;
      });
    case "name":
      return out.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
    case "flags":
      return out.sort((a, b) => b.integrity.total - a.integrity.total);
    default:
      return out.sort((a, b) => when(b).localeCompare(when(a)));
  }
}

/** Spreadsheets run a cell that starts with = + - @ (or a tab/CR) as a formula. Defuse those. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultsToCsv(rows: ResultRow[]): string {
  const head = [
    "Name",
    "Email",
    "Status",
    "Score",
    "AI recommendation",
    "Integrity flags",
    "Integrity review",
    "Decision",
    "Completed at",
  ];
  const lines = rows.map((r) =>
    [
      r.name ?? "",
      r.email,
      INVITE_STATUS_LABEL[r.status],
      r.overall_score === null ? "" : Math.round(r.overall_score),
      r.recommendation ?? "",
      r.integrity.total,
      r.integrity_review ?? "",
      r.decision ? DECISION_LABEL[r.decision] : "",
      r.completed_at ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.map(csvCell).join(","), ...lines].join("\r\n");
}

/** What the candidate will be asked about, from the rubric: names by weight, highest first. */
export function plannedTopics(rubric: Pick<Competency, "name" | "weight" | "questions">[]) {
  const pct = weightPercentages(rubric);
  return rubric
    .map((c, i) => ({ name: c.name.trim(), pct: pct[i], seeds: c.questions.filter(Boolean) }))
    .filter((t) => t.name)
    .sort((a, b) => b.pct - a.pct);
}

/** Pre-filled message for a rejection or advance email; the team can edit it. */
export const defaultDecisionMessage = (d: Decision | null, role: string, company?: string) =>
  d === "advance"
    ? `Thank you for completing the ${role} interview${company ? ` with ${company}` : ""}. We would like to move you to the next step and will be in touch shortly.`
    : d === "reject"
      ? `Thank you for the time you put into the ${role} interview${company ? ` with ${company}` : ""}. We have decided not to move forward at this time.`
      : "";
