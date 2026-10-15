export type SectionKind = "coding" | "sql" | "mcq";
export type InviteMode = "all" | "invited";
export type AssessmentTemplate = "coding" | "analytics" | "aptitude";

export interface LibraryProblem {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard" | null;
  topics: string[];
  languages: string[];
}

export interface ProblemPreview extends LibraryProblem {
  statementHtml: string;
  constraintsHtml: string;
  examples: { input: string; expected: unknown }[];
  hiddenTestCount: number;
}

export interface AssessmentQuestion {
  position: number;
  qtype: "mcq" | "coding";
  title: string;
  points: number;
  problemId: string | null;
}

export interface AssessmentSection {
  position: number;
  title: string;
  kind: SectionKind;
  durationMinutes: number;
  questions: AssessmentQuestion[];
}

export interface Assessment {
  id: string;
  title: string;
  inviteMode: InviteMode;
  locked: boolean;
  codingEnabled: boolean;
  stats: { invited: number; started: number; submitted: number };
  totalDurationMinutes: number;
  sections: AssessmentSection[];
}

/** What the builder sends. A question is a library problem OR an MCQ. */
export interface McqDraft {
  title: string;
  prompt: string;
  options: string[];
  correctOption: number;
  points: number;
}

export interface QuestionDraft {
  problemId?: string;
  problemTitle?: string;
  points?: number;
  mcq?: McqDraft;
}

export interface SectionDraft {
  title: string;
  kind: SectionKind;
  durationMinutes: number;
  questions: QuestionDraft[];
}

export interface AssessmentDraft {
  title: string;
  inviteMode: InviteMode;
  template?: AssessmentTemplate;
  sections?: SectionDraft[];
}

export interface InviteRow {
  applicationId: string;
  name: string;
  email: string | null;
  invited: boolean;
  emailStatus: "sent" | "skipped" | "failed" | null;
  attempt: "in_progress" | "submitted" | null;
}

export interface InviteResult {
  invited: number;
  alreadyInvited: number;
  notEligible: number;
  email: { sent: number; skipped: number; failed: number };
}

export interface ResultRow {
  applicationId: string;
  name: string;
  email: string | null;
  invited: boolean;
  state: "not_started" | "in_progress" | "submitted";
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  startedAt: string | null;
  submittedAt: string | null;
  timeTakenSeconds: number | null;
  tabSwitches: number;
  fullscreenExits: number;
  pasteEvents: number;
  flagged: boolean;
}

export interface Results {
  rows: ResultRow[];
  stats: {
    invited: number;
    started: number;
    submitted: number;
    averagePercent: number | null;
    flagged: number;
  };
}

export interface CodeSubmission {
  id: string;
  language: string;
  verdict: string;
  passed: number;
  total: number;
  score: number;
  createdAt: string;
  source: string;
}

export interface ResultQuestion {
  section: number | null;
  position: number;
  qtype: "mcq" | "coding";
  title: string;
  points: number;
  options?: string[] | null;
  correctOption?: number | null;
  chosenOption?: number | null;
  bestScore?: number;
  draft?: { language: string | null; source: string | null } | null;
  submissions?: CodeSubmission[];
}

export interface ResultDetail {
  candidate: ResultRow;
  assessmentTitle: string;
  sectionTitles: Record<number, string>;
  questions: ResultQuestion[];
}
