/** Company AI interviews: a hiring team sets up an interview for a role, invites candidates and
 *  reads the results. Shapes mirror the API (snake_case). */

import type { IntegrityEvent, IntegritySummary } from "@/types/candidate/aiInterview";

export type InterviewLevel = "intern" | "junior" | "mid" | "senior";
export type TemplateStatus = "draft" | "active" | "archived";
export type InviteStatus = "invited" | "started" | "completed" | "revoked" | "expired";
export type Decision = "advance" | "hold" | "reject";

export interface Competency {
  name: string;
  description: string;
  weight: number;
  questions: string[];
  expected_concepts: string;
  /** Added by the API: this weight as a share of the whole rubric, summing to exactly 100. */
  weight_pct?: number;
}

export interface InterviewTemplate {
  id: string;
  title: string;
  role_title: string;
  level: InterviewLevel;
  job_id: string | null;
  instructions: string;
  duration_minutes: number;
  status: TemplateStatus;
  version: number;
  rubric: Competency[];
  counts: { invited: number; started: number; completed: number };
  created_at: string;
  updated_at: string;
}

/** What the builder edits. */
export interface TemplateDraft {
  title: string;
  role_title: string;
  level: InterviewLevel;
  job_id: string | null;
  instructions: string;
  duration_minutes: number;
  rubric: Competency[];
}

export interface RubricPreset {
  id: string;
  label: string;
  role_title: string;
  competencies: Competency[];
}

export interface InviteRow {
  id: string;
  email: string;
  name: string | null;
  has_account: boolean;
  status: InviteStatus;
  expires_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_emailed_at: string | null;
  email_status: "sent" | "skipped" | "failed" | null;
  decision: Decision | null;
  overall_score: number | null;
  retakes?: number;
  accommodation_request?: string | null;
  integrity_review?: IntegrityReview | null;
}

export type IntegrityReview = "dismissed" | "confirmed";

export interface Applicant {
  application_id: string;
  name: string | null;
  email: string;
  application_status: string | null;
  already_invited: boolean;
}

export interface PreviousAttempt {
  started_at: string | null;
  ended_reason: string | null;
  overall_score: number | null;
  partial: boolean;
  has_report: boolean;
}

export interface InviteResult {
  invited: number;
  reinvited: number;
  already_invited: number;
  already_taken: number;
  invalid: string[];
  emails_sent: number;
  emails_skipped: number;
  emails_failed: number;
}

export interface CompetencyScore {
  name: string;
  score: number | null;
  weight: number | null;
  evidence: string;
}

export interface ResultRow extends InviteRow {
  technical_score: number | null;
  communication_score: number | null;
  recommendation: string | null;
  partial: boolean;
  competencies: CompetencyScore[];
  integrity: IntegritySummary;
  /** Finished without a report: the team can allow a retake. */
  incomplete?: boolean;
}

export interface ResultsPayload {
  template: InterviewTemplate;
  summary: {
    taken: number;
    reported: number;
    average_score: number | null;
    flagged: number;
    incomplete?: number;
  };
  rows: ResultRow[];
}

export interface ResultDetail {
  candidate: InviteRow;
  rubric: Competency[];
  consent: { accepted_at: string | null; version: string | null; audio: boolean; video: boolean };
  report: null | {
    partial: boolean;
    overall_score: number | null;
    technical_score: number | null;
    communication_score: number | null;
    competencies: CompetencyScore[];
    strengths: string[];
    weaknesses: string[];
    red_flags: string[];
    per_question: { question: string; feedback: string; score: number | null }[];
    recommendation: string | null;
    report_markdown: string | null;
    transcript: string | null;
    duration_seconds: number | null;
  };
  integrity: IntegritySummary;
  integrity_events: IntegrityEvent[];
  decision: { decision: Decision | null; note: string; decided_at: string | null };
  integrity_review?: { review: IntegrityReview | null; note: string };
  previous_attempts?: PreviousAttempt[];
  accommodation?: { request: string | null; at: string | null };
}

export interface DecisionResult {
  decision: Decision | null;
  note: string;
  application_status?: string | null;
  candidate_email?: "sent" | "skipped" | "failed" | null;
}
