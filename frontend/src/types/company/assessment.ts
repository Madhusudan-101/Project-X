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

export type WebcamMode = "off" | "optional" | "required";

export interface Assessment {
  id: string;
  title: string;
  inviteMode: InviteMode;
  webcamMode: WebcamMode;
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
  webcamMode?: WebcamMode;
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
  /** camera photos taken / ones where the browser saw nobody / several people */
  snapshots: number;
  snapshotsNoFace: number;
  snapshotsMultiFace: number;
  /** the camera policy this attempt started under */
  webcamMode: WebcamMode;
  webcamConsented: boolean;
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

export type IntegrityEventType =
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
  | "camera_restored";

export interface IntegrityEvent {
  type: IntegrityEventType;
  at: string;
  /** seconds since the candidate started */
  offsetSeconds: number | null;
  question: { section: number | null; position: number; title: string } | null;
  text?: string;
  length?: number;
  truncated?: boolean;
  target?: "editor" | "other";
  awayMs?: number;
}

export interface IntegrityTimeline {
  items: IntegrityEvent[];
  counts: Partial<Record<IntegrityEventType, number>>;
  largestPaste: number;
  /** events the candidate's browser sent, including any past the log cap */
  logged: number;
  capped: boolean;
}

export interface ResultDetail {
  events: IntegrityTimeline;
  candidate: ResultRow;
  assessmentTitle: string;
  sectionTitles: Record<number, string>;
  questions: ResultQuestion[];
}

export type SimilarityLevel = "high" | "medium";

export interface SimilarityPerson {
  applicationId: string;
  name: string;
  /** never submitted: this is the saved editor draft */
  draft?: boolean;
}

export interface SimilarityPair {
  a: SimilarityPerson;
  b: SimilarityPerson;
  language: string;
  /** rarity-weighted share of the shorter solution found in the other (0-1) */
  similarity: number;
  overlap: number;
  /** same, with variable names kept: high means they even share names */
  rawOverlap: number;
  level: SimilarityLevel;
}

export interface SimilarityQuestion {
  questionId: string;
  title: string;
  section: number | null;
  position: number;
  compared: number;
  skipped: number;
  pairs: SimilarityPair[];
  clusters: { size: number; members: SimilarityPerson[] }[];
}

export interface SimilarityReport {
  note: string;
  minSimilarity: number;
  summary: { flaggedPairs: number; candidatesInvolved: number };
  questions: SimilarityQuestion[];
}

export interface SimilarityCompareSide {
  applicationId: string;
  name: string;
  language: string;
  source: string;
  draft: boolean;
  matchedLines: number[];
  skipped: string | null;
}

export interface SimilarityCompare {
  note: string;
  question: { id: string; title: string };
  similarity: number;
  rawOverlap: number;
  level: SimilarityLevel | null;
  /** same language and enough code on both sides */
  comparable: boolean;
  a: SimilarityCompareSide;
  b: SimilarityCompareSide;
}

export interface CameraSnapshot {
  id: string;
  takenAt: string;
  offsetSeconds: number;
  /** faces the candidate's browser counted; null when it couldn't tell */
  faces: number | null;
  question: { section: number | null; position: number; title: string } | null;
  /** short-lived signed URL; null if storage couldn't sign it */
  url: string | null;
}

export interface CameraSnapshots {
  mode: WebcamMode;
  consentedAt: string | null;
  retentionDays: number;
  items: CameraSnapshot[];
}
