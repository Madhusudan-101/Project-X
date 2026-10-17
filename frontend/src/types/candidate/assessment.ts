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
  /** off | optional | required: whether snapshots are taken from the candidate's camera */
  webcamMode: "off" | "optional" | "required";
  /** off | optional | required: the multiple-display check before the test */
  monitorMode: OffOptionalRequired;
  /** what the profile already knows, to prefill the details form */
  prefill: Partial<OADetailsForm>;
  snapshotIntervalSeconds: number;
  snapshotRetentionDays: number;
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

export type CodeLanguage = "javascript" | "python" | "java" | "cpp";

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
  /** `active` = the candidate agreed, so the browser should send snapshots */
  webcam: { mode: "off" | "optional" | "required"; active: boolean; intervalSeconds: number };
  /** the multiple-display check this attempt started under; the test page keeps watching */
  monitorMode: OffOptionalRequired;
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

export type OAEventType =
  | "tab_switch"
  | "tab_return"
  | "window_blur"
  | "window_focus"
  | "fullscreen_exit"
  | "fullscreen_enter"
  | "paste"
  | "copy"
  | "cut"
  | "camera_denied"
  | "camera_lost"
  | "camera_restored"
  | "multi_monitor";

/** What accompanies an event. Text is capped by the client and again by the server. */
export interface OAEventExtra {
  questionId?: string | null;
  /** paste / copy / cut: the clipboard text */
  text?: string;
  /** where it happened: inside the code editor, or elsewhere on the page */
  target?: "editor" | "other";
  /** tab_return / window_focus: how long the candidate was away */
  awayMs?: number;
  /** multi_monitor: how many displays, when the browser can count them */
  count?: number;
}

export type OffOptionalRequired = "off" | "optional" | "required";

/** What the details form asks for. Numbers stay strings while typing. */
export interface OADetailsForm {
  fullName: string;
  email: string;
  phone: string;
  college: string;
  rollNumber: string;
  branch: string;
  graduationYear: string;
  cgpa: string;
}

export type DisplayStatus = "single" | "multiple" | "unknown";

export interface OADisplayCheck {
  status: DisplayStatus;
  count: number | null;
  method: "is-extended" | "window-management" | "unsupported";
}

/** What the pre-test checks found; sent with Start and kept for the recruiter. */
export interface OAPrecheck {
  webcam: "granted" | "denied" | "skipped" | "not_required";
  monitors: OADisplayCheck | null;
  fullscreen: boolean;
  browser: string;
  screen: string;
}

export interface OAStartPayload {
  webcamConsent: boolean;
  agreed: boolean;
  details: Omit<OADetailsForm, "email">;
  precheck: OAPrecheck;
}
