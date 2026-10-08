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

export interface OAQuestion {
  id: string;
  position: number;
  qtype: "mcq" | "coding";
  title: string;
  prompt: string;
  options: string[] | null;
  starterCode: Record<string, string> | null;
  points: number;
  answer: string | null;
  language: string | null;
}

export interface OASession {
  status: "in_progress" | "submitted";
  serverTime: string;
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
