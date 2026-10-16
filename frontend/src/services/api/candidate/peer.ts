import { request } from "@/services/api/client";
import { withGuidelines } from "@/store/candidate/peerGuidelines";

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
  | "completed"
  | "expired"
  | "no_show";

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
  // No room_id: a room id is a join credential, so it is only handed out by /join.
  title: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: ScheduledMeetingStatus;
  host_display_name: string;
  is_open: boolean; // no invitee -> any authed student may join
  is_authorized: boolean; // caller may join THIS meeting
  can_join_now: boolean; // is_authorized AND inside join window
}

export interface PeerHistoryItem {
  room_id: string;
  kind: "matched" | "scheduled";
  title: string | null;
  when: string;
  /** completed | ended | scheduled | waiting | live | cancelled | expired | no_show */
  status: string;
  /** The partner's name only if they were not anonymous; null when nobody joined. */
  partner_label: string | null;
  report_id: string | null;
  has_report: boolean;
  rated: boolean;
  blocked: boolean;
  can_report_or_rate: boolean;
}

/** Topics a person can ask to be matched on. The matcher prefers a partner on the same topic but never
 * makes anyone wait for it; "any" means no preference. */
export const MATCH_TOPICS = [
  { id: "any", label: "Any topic" },
  { id: "software", label: "Software engineering" },
  { id: "data", label: "Data and analytics" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "business", label: "Business" },
] as const;
export type MatchTopic = (typeof MATCH_TOPICS)[number]["id"];

export interface PeerPreferences {
  default_private: boolean;
  /** An IANA timezone such as "Asia/Kolkata", or null to use the browser's. */
  timezone: string | null;
  email_invites: boolean;
  email_reminders: boolean;
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
  ends_at: string;
  duration_minutes: number;
  is_ready: boolean;
  status: ScheduledMeetingStatus;
}

/** Dashboard-summary shape for a completed peer interview report. */
export interface PeerReport {
  id: string;
  room_id: string;
  role: "candidate" | "interviewer";
  /** "Anonymous Candidate" when the partner chose to stay private. */
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
  /** Mint a short-lived token for ONE room of the separately-deployed PeerMeet app. The server only
   * issues it for a room the caller was matched into or may join. */
  createSessionToken(roomId: string): Promise<PeerSessionToken> {
    return withGuidelines(() =>
      request<PeerSessionToken>("/candidate/peer-session-token", {
        method: "POST",
        body: { room_id: roomId },
      }),
    );
  },

  /** Enter or poll the matchmaking queue. Idempotent — safe to call every 2s. */
  requestMatch(keepPrivate: boolean, topic: MatchTopic = "any"): Promise<MatchmakingStatus> {
    return withGuidelines(() =>
      request<MatchmakingStatus>("/candidate/peer-matchmaking/request", {
        method: "POST",
        body: { keep_private: keepPrivate, topic: topic === "any" ? null : topic },
      }),
    );
  },

  /** Leave the queue (only affects `waiting` tickets). */
  cancelMatch(): Promise<void> {
    return request<void>("/candidate/peer-matchmaking/cancel", { method: "POST" });
  },

  /** I am done with my current match: frees me and my partner to be matched again. Idempotent. */
  endMatch(): Promise<void> {
    return request<void>("/candidate/peer-matchmaking/end", { method: "POST" });
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
    return withGuidelines(() =>
      request<ScheduledMeeting>("/candidate/peer-meetings", {
        method: "POST",
        body,
      }),
    );
  },

  /** Move a meeting nobody has joined yet. The invitee is emailed. */
  rescheduleMeeting(id: string, scheduledAtIso: string): Promise<ScheduledMeeting> {
    return request<ScheduledMeeting>(`/candidate/peer-meetings/${id}`, {
      method: "PATCH",
      body: { scheduled_at: scheduledAtIso },
    });
  },

  /** Every peer session I was part of, newest first. */
  history(): Promise<PeerHistoryItem[]> {
    return request<PeerHistoryItem[]>("/candidate/peer-history");
  },

  getPreferences(): Promise<PeerPreferences> {
    return request<PeerPreferences>("/candidate/peer-preferences");
  },

  setPreferences(prefs: PeerPreferences): Promise<PeerPreferences> {
    return request<PeerPreferences>("/candidate/peer-preferences", { method: "PUT", body: prefs });
  },

  cancelScheduledMeeting(id: string): Promise<void> {
    return request<void>(`/candidate/peer-meetings/${id}`, { method: "DELETE" });
  },

  joinScheduledMeeting(id: string): Promise<JoinScheduledOut> {
    return withGuidelines(() =>
      request<JoinScheduledOut>(`/candidate/peer-meetings/${id}/join`, {
        method: "POST",
      }),
    );
  },

  /** List the caller's own past peer interview reports, newest first. Used
   * to populate the learning-curve chart, streak, and "Recent" list on the
   * candidate dashboard. */
  listMyReports(): Promise<PeerReport[]> {
    return request<PeerReport[]>("/candidate/peer-reports");
  },
};
