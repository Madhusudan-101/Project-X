import { request } from "@/services/api/client";

export interface PeerSessionToken {
  token: string;
  expires_in: number;
}

export interface MatchmakingStatus {
  status: "waiting" | "matched";
  ticket_id: string;
  room_id: string | null;
  token: string | null;
  partner_name: string | null;
  keep_private: boolean;
  waiting_since: string | null;
}

export type ScheduledMeetingStatus =
  | "scheduled"
  | "waiting"
  | "live"
  | "cancelled"
  | "completed";

export interface ScheduledMeeting {
  id: string;
  room_id: string;
  title: string | null;
  scheduled_at: string;
  duration_minutes: number;
  keep_private: boolean;
  status: ScheduledMeetingStatus;
  creator_id: string;
  invitee_id: string | null;
  role: "creator" | "invitee";
}

/** Redacted card shape returned by /peer-meetings/upcoming (public list). */
export interface PublicScheduledMeeting {
  id: string;
  room_id: string;
  title: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: ScheduledMeetingStatus;
  host_display_name: string;
  is_open: boolean;       // no invitee -> any authed student may join
  is_authorized: boolean; // caller may join THIS meeting
  can_join_now: boolean;  // is_authorized AND inside join window
}

export interface CreateScheduledMeetingIn {
  title?: string;
  scheduled_at: string; // ISO
  duration_minutes: number;
  keep_private: boolean;
  invitee_email?: string;
}

export interface JoinScheduledOut {
  room_id: string;
  token: string;
  keep_private: boolean;
  starts_at: string;
  is_ready: boolean;
  status: ScheduledMeetingStatus;
}

/** Dashboard-summary shape for a completed peer interview report. */
export interface PeerReport {
  id: string;
  room_id: string;
  role: "candidate" | "interviewer";
  partner_display_name: string | null;
  overall_score: number | null;
  technical_score: number | null;
  communication_score: number | null;
  confidence_score: number | null;
  problem_solving_score: number | null;
  topics_covered: string[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  final_recommendation: string | null;
  created_at: string;
}

export const peerService = {
  /** Mint a short-lived token for the separately-deployed PeerMeet app. */
  createSessionToken(): Promise<PeerSessionToken> {
    return request<PeerSessionToken>("/candidate/peer-session-token", { method: "POST" });
  },

  /** Enter or poll the matchmaking queue. Idempotent — safe to call every 2s. */
  requestMatch(keepPrivate: boolean): Promise<MatchmakingStatus> {
    return request<MatchmakingStatus>("/candidate/peer-matchmaking/request", {
      method: "POST",
      body: { keep_private: keepPrivate },
    });
  },

  /** Leave the queue (only affects `waiting` tickets). */
  cancelMatch(): Promise<void> {
    return request<void>("/candidate/peer-matchmaking/cancel", { method: "POST" });
  },

  /** List my upcoming scheduled meetings (as creator or invitee). */
  listScheduledMeetings(): Promise<ScheduledMeeting[]> {
    return request<ScheduledMeeting[]>("/candidate/peer-meetings");
  },

  /** PUBLIC listing — every authenticated student can see every upcoming
   * scheduled meeting. Private fields are redacted server-side. */
  listUpcomingMeetings(): Promise<PublicScheduledMeeting[]> {
    return request<PublicScheduledMeeting[]>("/candidate/peer-meetings/upcoming");
  },

  createScheduledMeeting(body: CreateScheduledMeetingIn): Promise<ScheduledMeeting> {
    return request<ScheduledMeeting>("/candidate/peer-meetings", {
      method: "POST",
      body,
    });
  },

  cancelScheduledMeeting(id: string): Promise<void> {
    return request<void>(`/candidate/peer-meetings/${id}`, { method: "DELETE" });
  },

  joinScheduledMeeting(id: string): Promise<JoinScheduledOut> {
    return request<JoinScheduledOut>(`/candidate/peer-meetings/${id}/join`, {
      method: "POST",
    });
  },

  /** List the caller's own past peer interview reports, newest first. Used
   * to populate the learning-curve chart, streak, and "Recent" list on the
   * candidate dashboard. */
  listMyReports(): Promise<PeerReport[]> {
    return request<PeerReport[]>("/candidate/peer-reports");
  },
};
