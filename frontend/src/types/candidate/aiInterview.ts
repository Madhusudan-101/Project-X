export type AiInterviewDomain = "ai_ml" | "web_dev" | "dsa";

export interface AiInterviewSession {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  maxMinutes: number;
}

/** Limits and rules version the briefing screen must show; fetched before the candidate can start. */
export interface AiInterviewConfig {
  maxMinutes: number;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  consentVersion: string;
}

export type IntegrityKind =
  | "tab_hidden"
  | "window_blur"
  | "camera_lost"
  | "camera_restored"
  /** Seen by the AI interviewer's video check (only with the candidate's consent). */
  | "no_face"
  | "multiple_faces"
  | "camera_blocked";

export type VideoFlagKind = "no_face" | "multiple_faces" | "camera_blocked";

export interface IntegrityEvent {
  kind: IntegrityKind;
  offset_seconds: number;
  source?: "browser" | "agent";
}

export interface IntegritySummary {
  tab_switches: number;
  camera_lost: number;
  video_flags: number;
  total: number;
}

export interface AiInterviewQuestionFeedback {
  question: string;
  feedback: string;
  score: number; // 1-10
}

/** Scores are 0-100, same scale as PeerReport, so the dashboard can combine them. */
export interface AiInterviewReport {
  id: string;
  room_id: string;
  domain: AiInterviewDomain;
  partial: boolean;
  overall_score: number | null;
  technical_score: number | null;
  communication_score: number | null;
  strengths: string[];
  weaknesses: string[];
  red_flags: string[];
  per_question: AiInterviewQuestionFeedback[];
  final_recommendation: string | null;
  duration_seconds: number | null;
  created_at: string;
  integrity?: IntegritySummary;
}

export interface AiInterviewReportDetail extends AiInterviewReport {
  report_markdown: string | null;
  transcript: string | null;
  integrity_events?: IntegrityEvent[];
}
