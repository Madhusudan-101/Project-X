export type AiInterviewDomain = "ai_ml" | "web_dev" | "dsa";

export interface AiInterviewSession {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  maxMinutes: number;
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
}

export interface AiInterviewReportDetail extends AiInterviewReport {
  report_markdown: string | null;
  transcript: string | null;
}
