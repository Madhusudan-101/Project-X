export type OAState = "unscheduled" | "upcoming" | "open" | "closed" | "in_progress" | "submitted";

export type OASectionKind = "coding" | "sql" | "mcq";

export interface OASection {
  position: number;
  title: string;
  kind: OASectionKind;
  questionCount: number;
  durationMinutes: number;
}

export interface OAOverview {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  assessmentTitle: string;
  state: OAState;
  windowStart: string | null;
  windowEnd: string | null;
  serverTime: string;
  totalDurationMinutes: number;
  totalQuestions: number;
  sections: OASection[];
  codingEnabled: boolean;
  attempt: {
    status: "in_progress" | "submitted";
    currentSection: number;
    startedAt: string;
    submittedAt: string | null;
  } | null;
}

export interface OAListItem {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  state: OAState;
  windowStart: string | null;
  windowEnd: string | null;
}

export type CodeLanguage = "javascript" | "python";

export interface OAProblem {
  id: string;
  functionName: string;
  languages: CodeLanguage[];
  constraintsHtml: string;
  examples: { input: string; expected: string }[];
}

export interface OAQuestion {
  id: string;
  position: number;
  qtype: "mcq" | "coding";
  title: string;
  prompt: string;
  options: string[] | null;
  starterCode: Record<string, string> | null;
  points: number;
  promptFormat: "markdown" | "html";
  problem: OAProblem | null;
  answer: string | null;
  language: string | null;
}

export interface OASession {
  status: "in_progress" | "submitted";
  serverTime: string;
  codingEnabled: boolean;
  section: {
    position: number;
    totalSections: number;
    title: string;
    kind: OASectionKind;
    durationMinutes: number;
    deadline: string;
    questions: OAQuestion[];
  } | null;
}

export type CaseStatus = "pass" | "fail" | "error" | "timeout" | "ran";

export interface OACaseResult {
  label: string;
  status: CaseStatus;
  input: string;
  expected: string | null;
  actual: string | null;
  error: string | null;
}

export type Verdict =
  | "accepted"
  | "wrong_answer"
  | "runtime_error"
  | "compile_error"
  | "time_limit"
  | "judge_error";

export interface OARunResult {
  verdict: Verdict;
  compileError: string | null;
  crash: string | null;
  stdout: string;
  cases: OACaseResult[];
}

export interface OASubmitResult extends OARunResult {
  passed: number;
  total: number;
  hiddenPassed: number;
  hiddenTotal: number;
  score: number;
  points: number;
  submissionsLeft: number;
}

export type OAEventType = "tab_switch" | "fullscreen_exit" | "paste";
