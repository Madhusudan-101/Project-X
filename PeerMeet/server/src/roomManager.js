/**
 * roomManager.js
 *
 * In-memory room state manager.
 * Each room holds at most 2 participants.
 *
 * Participants are identified by a STABLE `participantId` (a UUID the client
 * generates once per room and persists in sessionStorage), not by the
 * ephemeral Socket.io `socket.id`. This is what lets a reconnect (network
 * blip or page refresh) reclaim the same interview role instead of being
 * treated as a brand-new participant — `socket.id` changes on every
 * reconnect, but `participantId` does not.
 *
 * Data structure:
 *   rooms: Map<roomId, {
 *     participants: [{ participantId, socketId }, { participantId, socketId }?],
 *     interview: {...}
 *   }>
 *
 * A participant's `socketId` is set to `null` while they're disconnected but
 * still hold their slot (so a reconnect within the room's lifetime can
 * reclaim it via matching participantId). The room itself is only deleted
 * once EVERY participant slot has `socketId === null`.
 */

const rooms = new Map();

/**
 * Create a new room and register the first participant.
 * @param {string} roomId
 * @param {string} participantId
 * @param {string} socketId
 */
function createRoom(roomId, participantId, socketId, identity = null, keepPrivate = false, transcriptionConsent = false) {
  rooms.set(roomId, {
    // The first participant is the room host: only they may configure/start an interview.
    hostParticipantId: participantId,
    // A room created with a verified identity token belongs to the dashboard: everyone who joins it
    // must also present a valid token for THIS room (anonymous guests are refused).
    restricted: !!identity,
    participants: [{ participantId, socketId, identity: identity || null, keepPrivate: !!keepPrivate, transcriptionConsent: !!transcriptionConsent }],
    // ── Interview state (all AI/role data lives server-side) ──────────────
    // This block is additive; existing signaling logic ignores it.
    interview: createInitialInterviewState(),
    // Full-call live-transcript history (id/speakerParticipantId/text/
    // timestamp), independent of interview.transcriptBuffer (which is
    // per-phase and wiped on every role switch). Lets a reconnecting or
    // late-joining participant resync the SAME transcript everyone else
    // already sees, instead of starting with a blank panel.
    transcriptHistory: [],
    // Text chat for the call (capped), replayed to someone who reconnects.
    chatHistory: [],
  });
}

const MAX_CHAT_HISTORY = 200;
const MAX_CHAT_LENGTH = 500;

/**
 * Add a chat message from `participantId` and return it, or null when it is empty, too long to be sane,
 * or the sender is not in the room. Text is plain text: it is trimmed, control characters removed and
 * capped; the client must render it as text, never as HTML.
 */
function addChatMessage(roomId, participantId, text) {
  const room = rooms.get(roomId);
  if (!room || !room.participants.some((p) => p.participantId === participantId)) return null;
  const clean = String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
  if (!clean) return null;
  const message = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fromParticipantId: participantId,
    text: clean,
    at: Date.now(),
  };
  room.chatHistory.push(message);
  if (room.chatHistory.length > MAX_CHAT_HISTORY) {
    room.chatHistory.splice(0, room.chatHistory.length - MAX_CHAT_HISTORY);
  }
  return message;
}

function getChatHistory(roomId) {
  return rooms.get(roomId)?.chatHistory || [];
}

const MAX_TRANSCRIPT_HISTORY = 500;

/**
 * Append a line to the room's full-call transcript history (for resync),
 * capping length so a long call doesn't grow this unboundedly.
 * @param {string} roomId
 * @param {{ id: string, speakerId: string, speakerParticipantId: string, text: string, timestamp: number }} line
 */
function appendTranscriptHistory(roomId, line) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.transcriptHistory.push(line);
  if (room.transcriptHistory.length > MAX_TRANSCRIPT_HISTORY) {
    room.transcriptHistory.splice(0, room.transcriptHistory.length - MAX_TRANSCRIPT_HISTORY);
  }
}

/**
 * Get the room's full-call transcript history, oldest first.
 * @param {string} roomId
 * @returns {Array}
 */
function getTranscriptHistory(roomId) {
  return rooms.get(roomId)?.transcriptHistory || [];
}

/**
 * Build a fresh interview-state object for a room.
 *
 * SECURITY: This state is the single source of truth for who is currently
 * the interviewer. AI-assistant payloads are only ever emitted to
 * `roles.interviewerId`. The candidate socket is never sent this data.
 *
 * All identifiers in this state (`configuredBy`, `roles.interviewerId`,
 * `roles.candidateId`, transcript `speakerId`) are `participantId`s, NOT
 * `socket.id`s — they must be resolved to a live socket via
 * `getSocketIdForParticipant()` before emitting.
 *
 * @returns {object}
 */
function createInitialInterviewState() {
  return {
    configured: false,
    // The participant who submitted interview setup (the meeting host).
    // Distinct from roles.interviewerId: when whoStarts === 'candidate' the
    // host is assigned the CANDIDATE role, so authorization for
    // configure/start must anchor on this, not on the dynamic interviewer.
    configuredBy: null,
    started: false,
    ended: false,
    endedReason: null,
    config: null, // { domain, difficulty, experience, durationMinutes, whoStarts }
    deadline: null, // absolute ms timestamp when the interview auto-ends
    roles: {
      interviewerId: null, // participantId currently acting as interviewer
      candidateId: null, // participantId currently being interviewed
    },
    phase: 0, // increments on every role switch
    // Per-phase transcript buffer (participantId-tagged) used for AI analysis.
    transcriptBuffer: [],
    // Questions already asked this session (avoid repetition across phases).
    askedQuestions: [],
    // Explicit tracking (spec Feature 6) — maintained across the phase, not
    // just derived from the latest evaluation summary.
    topicsCovered: [], // distinct topics assessed so far
    remainingTopics: [], // topics still worth covering (latest AI estimate)
    difficultyProgression: [], // ordered list of per-question difficulties
    // Follow-up questions already suggested to the interviewer this phase
    // (see interviewAssistant.evaluateAnswer) — dedup context so the AI
    // doesn't suggest the same probe twice for the same candidate.
    suggestedFollowUps: [],
    // Running evaluation for the *current* candidate, reset each phase. Now
    // also carries the latest follow-up-question recommendations (same
    // object, enriched — see interviewAssistant.js).
    evaluation: null,
    // Last AI recommendation, so a reconnecting interviewer can be caught up
    // (the live `interview:assistant-update` emit is fire-and-forget).
    lastRecommendation: null,
    // Last turn report delivered (or pending delivery), so a reconnecting
    // participant who missed it can be caught up.
    lastTurnReport: null, // { forParticipantId, report, final }
    // ── Interview Copilot (additive) ───────────────────────────────────────
    // Latest AI-estimated domain coverage breakdown (from generateQuestion —
    // same call, enriched schema, no new Gemini request).
    coverage: [], // [{ area, percent }]
    // Latest suggested next move for the interviewer (same call as above).
    strategy: null, // { action, label, reason }
    // Strengths/weaknesses observed ACROSS the phase so far (deduplicated),
    // accumulated from each evaluateAnswer result's strong_areas/weak_areas/
    // weaknessSignals — this is what powers the continuously-updated
    // "Interview Summary" without any additional AI calls.
    strengthsLog: [],
    weaknessLog: [],
  };
}

/**
 * Get the mutable interview state for a room (or undefined).
 * @param {string} roomId
 */
function getInterview(roomId) {
  return rooms.get(roomId)?.interview;
}

const MAX_CONFIG_STRING_LENGTH = 60;
const ALLOWED_DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Adaptive']);
const ALLOWED_WHO_STARTS = new Set(['interviewer', 'candidate']);

/**
 * Clamp/validate the client-submitted interview config before it's stored
 * and, eventually, interpolated into Gemini prompts. Bounds free-text fields
 * (domain) and restricts enum-like fields to known values.
 * @param {object} config
 */
function sanitizeConfig(config) {
  const clampString = (value, fallback) => {
    const str = typeof value === 'string' ? value.trim() : '';
    if (!str) return fallback;
    return str.slice(0, MAX_CONFIG_STRING_LENGTH);
  };

  const durationMinutes = Number(config?.durationMinutes);

  return {
    domain: clampString(config?.domain, 'General'),
    difficulty: ALLOWED_DIFFICULTIES.has(config?.difficulty) ? config.difficulty : 'Adaptive',
    experience: clampString(config?.experience, 'Unknown'),
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0
      ? Math.min(durationMinutes, 180)
      : 0,
    whoStarts: ALLOWED_WHO_STARTS.has(config?.whoStarts) ? config.whoStarts : 'interviewer',
  };
}

/**
 * Store the interview configuration (domain, difficulty, etc.) and assign the
 * initial interviewer/candidate roles based on `whoStarts`.
 *
 * @param {string} roomId
 * @param {object} config
 * @param {string} configuringParticipantId - the participant submitting setup (the creator)
 * @returns {object|null} the updated interview state, or null if room missing
 */
function configureInterview(roomId, config, configuringParticipantId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const partner = room.participants.find((p) => p.participantId !== configuringParticipantId) || null;
  const safeConfig = sanitizeConfig(config);

  // "Who starts first" decides who holds the interviewer role initially.
  // The configuring user is treated as the meeting creator. If the candidate
  // starts, the *other* participant is the first interviewer.
  const creatorIsInterviewer = safeConfig.whoStarts !== 'candidate';

  room.interview = {
    ...createInitialInterviewState(),
    configured: true,
    configuredBy: configuringParticipantId,
    config: safeConfig,
    roles: {
      interviewerId: creatorIsInterviewer ? configuringParticipantId : (partner?.participantId || null),
      candidateId: creatorIsInterviewer ? (partner?.participantId || null) : configuringParticipantId,
    },
  };

  return room.interview;
}

/**
 * Mark the interview as started.
 * @param {string} roomId
 */
function startInterview(roomId) {
  const interview = getInterview(roomId);
  if (!interview) return null;
  interview.started = true;
  return interview;
}

/**
 * Swap interviewer and candidate roles for a room and advance the phase.
 * Clears the per-phase transcript buffer and evaluation so the new turn
 * starts clean, while preserving `askedQuestions` to avoid repeats.
 *
 * @param {string} roomId
 * @returns {object|null} the updated interview state (post-swap) or null
 */
function switchInterviewRoles(roomId) {
  const interview = getInterview(roomId);
  if (!interview || !interview.roles.interviewerId) return null;

  const { interviewerId, candidateId } = interview.roles;

  interview.roles = {
    interviewerId: candidateId,
    candidateId: interviewerId,
  };
  interview.phase += 1;
  interview.transcriptBuffer = [];
  interview.evaluation = null;
  interview.topicsCovered = [];
  interview.remainingTopics = [];
  interview.difficultyProgression = [];
  interview.suggestedFollowUps = [];
  interview.lastRecommendation = null;
  interview.coverage = [];
  interview.strategy = null;
  interview.strengthsLog = [];
  interview.weaknessLog = [];

  return interview;
}

/**
 * Append a speaker-tagged transcript line to the current phase buffer.
 * @param {string} roomId
 * @param {{ speakerId: string, text: string, timestamp: number }} line - speakerId is a participantId
 */
function appendTranscriptLine(roomId, line) {
  const interview = getInterview(roomId);
  if (!interview) return;
  interview.transcriptBuffer.push(line);
}

/**
 * Push items into `list` in place, skipping any already present
 * (case-insensitive). Shared dedup logic for topic/question tracking.
 * @param {string[]} list
 * @param {string[]} items
 */
function addUnique(list, items) {
  const seen = new Set(list.map((t) => String(t).toLowerCase()));
  for (const item of items || []) {
    const key = String(item).toLowerCase();
    if (item && !seen.has(key)) {
      list.push(item);
      seen.add(key);
    }
  }
}

/**
 * Merge tracking data from an AI recommendation into interview state.
 * Deduplicates topics (case-insensitive) and appends the question's difficulty
 * to the progression. Keeps remainingTopics as the latest AI estimate minus
 * anything already covered.
 *
 * @param {string} roomId
 * @param {object} recommendation - parsed AI question JSON
 */
function mergeTracking(roomId, recommendation) {
  const interview = getInterview(roomId);
  if (!interview || !recommendation) return;

  addUnique(interview.topicsCovered, recommendation.topics_covered);

  // Remaining = latest AI estimate, excluding anything now covered.
  const coveredLower = new Set(interview.topicsCovered.map((t) => String(t).toLowerCase()));
  interview.remainingTopics = (recommendation.remaining_topics || []).filter(
    (t) => t && !coveredLower.has(String(t).toLowerCase())
  );

  if (recommendation.difficulty) {
    interview.difficultyProgression.push(recommendation.difficulty);
  }

  // Copilot: latest domain coverage breakdown + next-move strategy — same
  // recommendation object, just mirrored into dedicated fields so consumers
  // (getCopilotSummary, reconnect resync) have one obvious place to read
  // the CURRENT snapshot without reaching into lastRecommendation.
  if (recommendation.coverage?.length) {
    interview.coverage = recommendation.coverage;
  }
  if (recommendation.strategy) {
    interview.strategy = recommendation.strategy;
  }
}

/**
 * Record newly-suggested follow-up questions (deduplicated, case-insensitive)
 * so future evaluateAnswer calls this phase know not to suggest them again.
 * @param {string} roomId
 * @param {object} evaluation - the enriched, sanitized evaluateAnswer result
 */
function recordSuggestedFollowUps(roomId, evaluation) {
  const interview = getInterview(roomId);
  if (!interview || !evaluation?.followUpQuestions?.length) return;

  addUnique(
    interview.suggestedFollowUps,
    evaluation.followUpQuestions.map((q) => q.question).filter(Boolean)
  );
}

/**
 * Accumulate this turn's strengths/weaknesses into the running phase-wide
 * logs (deduplicated) — the Copilot's "Interview Summary" is built by
 * aggregating these, not by asking Gemini for a running narrative each
 * cycle, so it costs zero additional AI latency.
 * @param {string} roomId
 * @param {object} evaluation - the enriched, sanitized evaluateAnswer result
 */
function recordSummarySignals(roomId, evaluation) {
  const interview = getInterview(roomId);
  if (!interview || !evaluation) return;

  addUnique(interview.strengthsLog, evaluation.strong_areas);
  addUnique(interview.weaknessLog, [
    ...(evaluation.weak_areas || []),
    ...(evaluation.weaknessSignals || []),
  ]);
}

/**
 * Build the Interview Copilot's continuously-updated summary from state
 * that's already being tracked — pure aggregation, no AI call. Overall
 * coverage percent prefers the AI's own per-area coverage estimate when
 * available, falling back to a simple covered/total topic ratio.
 * @param {string} roomId
 * @returns {object|null}
 */
function getCopilotSummary(roomId) {
  const interview = getInterview(roomId);
  if (!interview) return null;

  let overallCoveragePercent = 0;
  if (interview.coverage.length) {
    overallCoveragePercent = Math.round(
      interview.coverage.reduce((sum, c) => sum + (c.percent || 0), 0) / interview.coverage.length
    );
  } else {
    const total = interview.topicsCovered.length + interview.remainingTopics.length;
    overallCoveragePercent = total > 0
      ? Math.round((interview.topicsCovered.length / total) * 100)
      : 0;
  }

  return {
    overallCoveragePercent,
    coverageAreas: interview.coverage,
    strategy: interview.strategy,
    topicsCovered: interview.topicsCovered,
    remainingTopics: interview.remainingTopics,
    strengths: interview.strengthsLog,
    weaknesses: interview.weaknessLog,
    latestScore: interview.evaluation?.score ?? null,
    latestConfidence: interview.evaluation?.confidence ?? null,
    latestDifficulty: interview.evaluation?.difficulty ?? null,
  };
}

/**
 * Snapshot of the explicit tracking fields for emitting to the interviewer.
 * @param {string} roomId
 */
function getTrackingSnapshot(roomId) {
  const interview = getInterview(roomId);
  if (!interview) return null;
  return {
    topicsCovered: interview.topicsCovered,
    remainingTopics: interview.remainingTopics,
    questionsAsked: interview.askedQuestions,
    difficultyProgression: interview.difficultyProgression,
  };
}

/**
 * Return the role ('interviewer' | 'candidate' | null) for a participant in a room.
 * @param {string} roomId
 * @param {string} participantId
 */
function getRole(roomId, participantId) {
  const interview = getInterview(roomId);
  if (!interview) return null;
  if (interview.roles.interviewerId === participantId) return 'interviewer';
  if (interview.roles.candidateId === participantId) return 'candidate';
  return null;
}

/**
 * Find which room a socket belongs to.
 * @param {string} socketId
 * @returns {string|undefined}
 */
function getRoomIdForSocket(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.some((p) => p.socketId === socketId)) return roomId;
  }
  return undefined;
}

/**
 * Resolve a participant's CURRENT live socket id, or null if they're
 * disconnected (e.g. mid-reconnect gap). Always use this before emitting to
 * a role (`roles.interviewerId`/`candidateId`) — never emit to a
 * participantId directly, it is not a socket.io room name.
 * @param {string} roomId
 * @param {string} participantId
 * @returns {string|null}
 */
function getSocketIdForParticipant(roomId, participantId) {
  const room = rooms.get(roomId);
  if (!room || !participantId) return null;
  const participant = room.participants.find((p) => p.participantId === participantId);
  return participant?.socketId || null;
}

/**
 * Resolve a live socket id back to its stable participantId.
 * @param {string} roomId
 * @param {string} socketId
 * @returns {string|null}
 */
/**
 * Return the attached identity ({ studentId, studentName }) for a
 * participant, or null if that slot is anonymous.
 * @param {string} roomId
 * @param {string} participantId
 */
function getIdentityForParticipant(roomId, participantId) {
  const room = rooms.get(roomId);
  if (!room || !participantId) return null;
  const participant = room.participants.find((p) => p.participantId === participantId);
  return participant?.identity || null;
}

/**
 * Return the DISPLAY name a peer should see for this participant.
 * Enforces the "Keep my identity private" preference server-side: when set,
 * the peer only ever sees "Anonymous Candidate", regardless of whether the
 * identity is attached (Mirracle still uses the real identity for the
 * webhook — that flow does not read this function).
 * @param {string} roomId
 * @param {string} participantId
 * @returns {string}
 */
function getPublicDisplayName(roomId, participantId) {
  const room = rooms.get(roomId);
  if (!room || !participantId) return 'Participant';
  const participant = room.participants.find((p) => p.participantId === participantId);
  if (!participant) return 'Participant';
  if (participant.keepPrivate) return 'Anonymous Candidate';
  return participant.identity?.studentName || 'Participant';
}

/** Did this person explicitly agree to live transcription (audio to a third party) and AI feedback? */
function hasTranscriptionConsent(roomId, participantId) {
  const p = rooms.get(roomId)?.participants.find((x) => x.participantId === participantId);
  return !!p?.transcriptionConsent;
}

/** True only when everyone currently in the room agreed. AI feedback processes BOTH people's speech. */
function everyoneConsentedToTranscription(roomId) {
  const room = rooms.get(roomId);
  return !!room && room.participants.length > 0 && room.participants.every((p) => p.transcriptionConsent);
}

/** Does this participant already hold a slot (with an identity) in the room? Used to let them back in. */
function holdsSlotWithIdentity(roomId, participantId) {
  const p = rooms.get(roomId)?.participants.find((x) => x.participantId === participantId);
  return !!p?.identity;
}

function getHostParticipantId(roomId) {
  return rooms.get(roomId)?.hostParticipantId || null;
}

function isRoomRestricted(roomId) {
  return !!rooms.get(roomId)?.restricted;
}

/** Did this participant ask to stay anonymous? Unknown participants count as private. */
function isParticipantPrivate(roomId, participantId) {
  const p = rooms.get(roomId)?.participants.find((x) => x.participantId === participantId);
  return p ? !!p.keepPrivate : true;
}

function getParticipantIdForSocket(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room || !socketId) return null;
  const participant = room.participants.find((p) => p.socketId === socketId);
  return participant?.participantId || null;
}

/**
 * Attempt to join an existing room. If `participantId` already holds a slot
 * in this room (a reconnect — network blip or page refresh), that slot's
 * socketId is updated in place rather than creating a duplicate participant,
 * which is what lets interview roles survive the reconnect.
 *
 * @param {string} roomId
 * @param {string} participantId
 * @param {string} socketId
 * @param {(socketId: string) => boolean} [isSocketAlive] - liveness probe used
 *   to tell a genuine reconnect apart from a duplicate browser tab (below)
 * @returns {{ success: boolean, reconnected?: boolean, partnerId?: string|null, partnerParticipantId?: string|null, isFull?: boolean, notFound?: boolean, duplicateSession?: boolean }}
 */
function joinRoom(roomId, participantId, socketId, isSocketAlive, identity = null, keepPrivate = false, transcriptionConsent = null) {
  const room = rooms.get(roomId);

  if (!room) {
    return { success: false, notFound: true };
  }

  const existing = room.participants.find((p) => p.participantId === participantId);
  if (existing) {
    // A slot whose socket is STILL LIVE is not a reconnect — it's a second
    // browser tab that inherited this room's participantId from
    // sessionStorage (browsers copy sessionStorage into a duplicated tab, and
    // into one opened via a target=_blank link). Treating that as a reconnect
    // silently re-pointed this slot at the new tab, which left `partnerId`
    // null — so the server emitted 'ready' with initiatorId: null, no SDP
    // offer was ever created, and NEITHER participant ever got remote video.
    //
    // The liveness probe is what keeps a real page refresh working: there the
    // old socket is already gone, so this falls through to the reconnect path
    // below even if the 'disconnect' event has not been processed yet.
    if (
      existing.socketId &&
      existing.socketId !== socketId &&
      typeof isSocketAlive === 'function' &&
      isSocketAlive(existing.socketId)
    ) {
      return { success: false, duplicateSession: true };
    }

    existing.socketId = socketId;
    // Only ever adopt a fresh identity on reconnect; never let an anonymous
    // reconnect blank out an already-attached identity.
    if (identity && !existing.identity) {
      existing.identity = identity;
    }
    // Privacy preference can be updated on reconnect (user may have toggled
    // it in the source tab before rejoining).
    if (typeof keepPrivate === 'boolean') {
      existing.keepPrivate = keepPrivate;
    }
    if (typeof transcriptionConsent === 'boolean') {
      existing.transcriptionConsent = transcriptionConsent;
    }
    const partner = room.participants.find((p) => p.participantId !== participantId) || null;
    return {
      success: true,
      reconnected: true,
      partnerId: partner?.socketId || null,
      partnerParticipantId: partner?.participantId || null,
    };
  }

  if (room.participants.length >= 2) {
    return { success: false, isFull: true };
  }

  const partner = room.participants[0] || null; // the existing participant, before we add the new one
  room.participants.push({ participantId, socketId, identity: identity || null, keepPrivate: !!keepPrivate, transcriptionConsent: !!transcriptionConsent });

  return {
    success: true,
    reconnected: false,
    partnerId: partner?.socketId || null,
    partnerParticipantId: partner?.participantId || null,
  };
}

/**
 * Mark a participant's socket as disconnected (keeping their slot so a
 * reconnect can reclaim it). The room is only deleted once every
 * participant slot has no live socket.
 * @param {string} socketId
 * @returns {{ roomId?: string, partnerId?: string|null }}
 */
/**
 * A participant deliberately LEFT (as opposed to a dropped connection, which keeps their slot for a
 * rejoin). Frees the slot immediately so the room is not "full" for the rest of its life.
 * @returns {{ roomId?: string, partnerId?: string|null }} partnerId is the remaining person's live socket
 */
function releaseParticipant(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    const idx = room.participants.findIndex((p) => p.socketId === socketId);
    if (idx === -1) continue;
    const [gone] = room.participants.splice(idx, 1);
    const partner = room.participants[0] || null;
    if (room.hostParticipantId === gone.participantId && partner) {
      room.hostParticipantId = partner.participantId; // someone must still be able to run the interview
    }
    if (room.participants.every((p) => p.socketId === null)) rooms.delete(roomId);
    return { roomId, partnerId: partner?.socketId || null };
  }
  return {};
}

function leaveRoom(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    const participant = room.participants.find((p) => p.socketId === socketId);
    if (participant) {
      participant.socketId = null;

      const partner = room.participants.find((p) => p.participantId !== participant.participantId);
      const stillHasLiveParticipant = room.participants.some((p) => p.socketId !== null);

      if (!stillHasLiveParticipant) {
        rooms.delete(roomId);
      }

      return { roomId, partnerId: partner?.socketId || null };
    }
  }
  return {};
}

/**
 * Get the partner's current socket id for a given socket in a room.
 * @param {string} roomId
 * @param {string} socketId
 * @returns {string|undefined}
 */
function getPartner(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  return room.participants.find((p) => p.socketId !== socketId && p.socketId)?.socketId;
}

/**
 * Check if a room exists.
 * @param {string} roomId
 * @returns {boolean}
 */
function roomExists(roomId) {
  return rooms.has(roomId);
}

/**
 * Get the number of participant slots in a room (connected or not).
 * @param {string} roomId
 * @returns {number}
 */
function getRoomSize(roomId) {
  const room = rooms.get(roomId);
  return room ? room.participants.length : 0;
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  releaseParticipant,
  getPartner,
  roomExists,
  getRoomSize,
  // Interview / role management (additive)
  getInterview,
  configureInterview,
  startInterview,
  switchInterviewRoles,
  appendTranscriptLine,
  appendTranscriptHistory,
  getTranscriptHistory,
  mergeTracking,
  recordSuggestedFollowUps,
  recordSummarySignals,
  getCopilotSummary,
  getTrackingSnapshot,
  getRole,
  getRoomIdForSocket,
  getSocketIdForParticipant,
  getParticipantIdForSocket,
  getIdentityForParticipant,
  getPublicDisplayName,
  addChatMessage,
  getChatHistory,
  getHostParticipantId,
  holdsSlotWithIdentity,
  hasTranscriptionConsent,
  everyoneConsentedToTranscription,
  isRoomRestricted,
  isParticipantPrivate,
};
