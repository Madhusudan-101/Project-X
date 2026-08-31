/**
 * index.js — Signaling Server
 *
 * This server handles WebRTC signaling plus Deepgram transcription relay events.
 * Call audio/video still flows directly peer-to-peer via WebRTC.
 * Only each participant's own microphone chunks are relayed for transcription.
 *
 * Participant identity: every participant carries a client-generated, stable
 * `participantId` (persisted in sessionStorage across page refreshes) in
 * addition to their ephemeral `socket.id`. Room membership and interview
 * roles are keyed on `participantId` so a reconnect (network blip or page
 * refresh) can reclaim the same slot/role instead of being treated as a
 * brand-new participant. See roomManager.js for the participant model.
 *
 * Socket.io Events:
 *   Incoming (client → server):
 *     - create-room   : { roomId, participantId } — create a new room
 *     - join-room     : { roomId, participantId } — join OR reconnect to a
 *                        room; reconnect is detected when participantId
 *                        already holds a slot in that room
 *     - signal        : Forward SDP offer/answer or ICE candidate to partner
 *     - transcription:start : { roomId, mimeType } — start this participant's Deepgram stream
 *     - transcription:audio : Send this participant's microphone audio chunk
 *     - transcription:stop  : Stop this participant's Deepgram stream
 *     - ice-servers:request : Request the current STUN/TURN server list
 *     - disconnect    : Built-in; marks the participant's slot disconnected
 *                        (not removed — see roomManager.leaveRoom)
 *
 *   Outgoing (server → client):
 *     - room-created  : Confirm room creation with roomId
 *     - room-exists   : create-room hit an already-existing room (client falls back to join-room)
 *     - user-joined   : Notify the other participant that someone joined/reconnected
 *     - ready         : Tell the joining/reconnecting participant who the other side is
 *     - return-signal : Deliver signal data to target peer
 *     - user-left     : Notify remaining peer that partner disconnected
 *     - room-full     : Reject a 3rd distinct participant
 *     - room-not-found: Reject joiner with invalid/abandoned room ID (client falls back to create-room if it expected to be first)
 *     - transcription:interim/final/error/recovered : live transcription lifecycle
 *     - interview:*   : interview lifecycle — role, started, deadline, assistant-update,
 *                        turn-report, roles-switched, ended — resent to a reconnecting
 *                        participant via sendInterviewStateTo() so they catch up
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const {
  createRoom,
  joinRoom,
  leaveRoom,
  roomExists,
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
  getSocketIdForParticipant,
  getParticipantIdForSocket,
} = require('./roomManager');
const {
  createDeepgramTranscriptionManager,
} = require('./deepgramTranscription');
const { createInterviewAssistant } = require('./interviewAssistant');

const app = express();
const server = http.createServer(app);

// ─── CORS ──────────────────────────────────────────────────────────────────────
// Supports a comma-separated list so staging/prod can share one deploy.
const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  })
);

app.use(express.json());

// ─── Production Config Check ────────────────────────────────────────────────────
// Every one of these degrades silently in code (isConfigured() checks,
// fallback ICE list, etc.) so the app never crashes without them — good for
// local dev, but it means a misconfigured production deploy can go live
// with AI assistance, transcription, or TURN quietly non-functional and no
// indication anywhere why. This only runs the check (never throws) when
// NODE_ENV=production, so `npm run dev` is completely unaffected.
if (process.env.NODE_ENV === 'production') {
  const REQUIRED_IN_PRODUCTION = ['CLIENT_URL', 'GEMINI_API_KEY', 'DEEPGRAM_API_KEY', 'METERED_API_KEY'];
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(
      `\n⚠️  [Config] Missing environment variable(s) in production: ${missing.join(', ')}\n` +
      '   The server will still start, but dependent features will be silently disabled:\n' +
      '     - CLIENT_URL missing      → CORS falls back to localhost, the real frontend will be blocked\n' +
      '     - GEMINI_API_KEY missing  → AI interview assistant (questions/evaluation/follow-ups/reports) disabled\n' +
      '     - DEEPGRAM_API_KEY missing→ live transcription disabled\n' +
      '     - METERED_API_KEY missing → falls back to static TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL if set, else TURN relay is unavailable\n'
    );
  }
}

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Socket.io Setup ───────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
});

// ─── ICE servers (WebRTC NAT traversal) ─────────────────────────────────────────
// Credentials live only in server env — never shipped in client source, where
// anyone could extract them from the bundle and exhaust/abuse the TURN quota.
//
// Preferred path: Metered's credential API (METERED_API_KEY) hands back a
// freshly-issued TURN username/credential per request, so nothing long-lived
// is stored here. Cached briefly to avoid hammering the API on every join.
const METERED_CACHE_MS = 6 * 60 * 60 * 1000; // 6h — comfortably inside Metered's issuance window
let meteredCache = { servers: null, fetchedAt: 0 };

async function fetchMeteredIceServers() {
  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) return null;

  if (meteredCache.servers && Date.now() - meteredCache.fetchedAt < METERED_CACHE_MS) {
    return meteredCache.servers;
  }

  const domain = process.env.METERED_DOMAIN || 'mirracle.metered.live';
  const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Metered API responded ${res.status}`);
    const servers = await res.json();
    if (!Array.isArray(servers) || !servers.length) throw new Error('Empty ICE server list');
    meteredCache = { servers, fetchedAt: Date.now() };
    return servers;
  } catch (err) {
    console.error('[ICE] Failed to fetch TURN credentials from Metered:', err.message);
    return meteredCache.servers; // serve stale cache over nothing, if we have it
  }
}

function buildStaticIceServers() {
  const servers = [];
  const turnUrls = (process.env.TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrls.length && turnUsername && turnCredential) {
    for (const urls of turnUrls) {
      servers.push({ urls, username: turnUsername, credential: turnCredential });
    }
  }

  return servers;
}

async function buildIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];

  const meteredServers = await fetchMeteredIceServers();
  if (meteredServers) {
    servers.push(...meteredServers);
  } else {
    servers.push(...buildStaticIceServers());
  }

  return servers;
}

/**
 * Emit to a participant by their STABLE participantId, resolving it to
 * whatever socket they're currently connected on (io.to() requires an actual
 * socket/room id — a participantId is neither). No-ops safely if the
 * participant is currently disconnected (e.g. mid-reconnect gap); the
 * interview state itself (lastRecommendation/lastTurnReport/etc.) is what
 * lets them catch up once they reconnect, via sendInterviewStateTo().
 */
function emitToParticipant(roomId, participantId, event, payload) {
  const socketId = getSocketIdForParticipant(roomId, participantId);
  if (!socketId) return;
  io.to(socketId).emit(event, payload);
}

// ── AI Interview Assistant (Gemini) ────────────────────────────────────────────
const interviewAssistant = createInterviewAssistant({
  apiKey: process.env.GEMINI_API_KEY,
});
console.log(
  interviewAssistant.isConfigured()
    ? `[Assistant] Gemini configured | model=${process.env.GEMINI_MODEL || 'gemini-3.6-flash (default)'}`
    : '[Assistant] GEMINI_API_KEY not set — AI interview assistance is disabled'
);

// Debounce timers per room so we analyze meaningful chunks, not every word.
const analysisTimers = new Map();
// Track how much of each room's transcript we've already analyzed, so we skip
// redundant AI calls when nothing new (or nothing from the candidate) arrived.
const analysisWatermark = new Map(); // roomId -> { lineCount, candidateChars }
// Rooms currently mid-Gemini-call, so overlapping debounce timers don't fire
// a second concurrent analysis for the same room.
const analysisInFlight = new Set();
const ANALYSIS_DEBOUNCE_MS = 4000;
const MIN_NEW_CANDIDATE_CHARS = 40; // don't call AI on trivial fragments
// Bounds each Gemini analysis call — the SDK sets no request timeout of its
// own, and analysisInFlight can only clear once the call settles.
const ANALYSIS_TIMEOUT_MS = 20_000;

/**
 * Decide whether a room has enough NEW candidate speech to justify an AI call.
 * Returns the current measurement so the caller can update the watermark.
 */
function shouldAnalyze(interview, roomId) {
  const candidateId = interview.roles.candidateId;
  const buffer = interview.transcriptBuffer;

  const candidateChars = buffer
    .filter((l) => l.speakerId === candidateId)
    .reduce((sum, l) => sum + (l.text?.length || 0), 0);

  const prev = analysisWatermark.get(roomId) || { lineCount: 0, candidateChars: 0 };
  const newCandidateChars = candidateChars - prev.candidateChars;
  const hasNewLines = buffer.length > prev.lineCount;

  const measurement = { lineCount: buffer.length, candidateChars };

  // Require both: some new lines AND meaningful new candidate speech.
  const worth = hasNewLines && newCandidateChars >= MIN_NEW_CANDIDATE_CHARS;
  return { worth, measurement };
}

/**
 * Run AI analysis for a room and push results ONLY to the active interviewer.
 * SECURITY: the candidate socket is never a target of these emits.
 */
async function runAssistantAnalysis(roomId) {
  const interview = getInterview(roomId);
  if (!interview || !interview.started || interview.ended) return;
  if (!interviewAssistant.isConfigured()) return;

  const interviewerId = interview.roles.interviewerId;
  if (!interviewerId) return;

  const { worth, measurement } = shouldAnalyze(interview, roomId);
  if (!worth) return;

  // Guard against overlapping timers double-calling on the same content
  // (independent of the watermark, which we now only commit on success —
  // committing it up front meant a failed Gemini call permanently skipped
  // that chunk of candidate speech until enough further speech accumulated).
  //
  // Because this guard can only be cleared once the in-flight call settles,
  // it's bounded by ANALYSIS_TIMEOUT_MS below — the Gemini SDK sets no
  // request timeout of its own, so an unbounded call here would otherwise
  // permanently block all future AI assistance for this room.
  if (analysisInFlight.has(roomId)) return;
  analysisInFlight.add(roomId);

  let recommendation = null;
  let evaluation = null;
  try {
    // Generate the next question + evaluate current answers in parallel,
    // bounded so a hung Gemini call can't wedge this room's analysis guard.
    [recommendation, evaluation] = await Promise.race([
      Promise.all([
        interviewAssistant.generateQuestion({
          config: interview.config,
          transcriptBuffer: interview.transcriptBuffer,
          askedQuestions: interview.askedQuestions,
          interviewerId,
        }),
        interviewAssistant.evaluateAnswer({
          config: interview.config,
          transcriptBuffer: interview.transcriptBuffer,
          interviewerId,
          candidateId: interview.roles.candidateId,
          askedQuestions: interview.askedQuestions,
          suggestedFollowUps: interview.suggestedFollowUps,
          difficultyProgression: interview.difficultyProgression,
        }),
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI analysis timed out')), ANALYSIS_TIMEOUT_MS)
      ),
    ]);
  } finally {
    analysisInFlight.delete(roomId);
  }

  // Only advance the watermark once we actually got a usable result —
  // otherwise a transient Gemini failure would permanently skip this chunk
  // of candidate speech.
  if (recommendation?.question) {
    analysisWatermark.set(roomId, measurement);
    interview.askedQuestions.push(recommendation.question);
    mergeTracking(roomId, recommendation);
    interview.lastRecommendation = recommendation;
  }
  if (evaluation) {
    interview.evaluation = evaluation;
    // Track suggested follow-ups so future analysis cycles this phase don't
    // re-suggest the same probe to the interviewer.
    recordSuggestedFollowUps(roomId, evaluation);
    // Accumulate into the Copilot's running summary — pure aggregation of
    // data we already have, zero additional AI latency.
    recordSummarySignals(roomId, evaluation);
  }

  // Emit to the interviewer's CURRENT socket only — never to the room or
  // candidate. Resolved dynamically since interviewerId is a participantId,
  // not a socket.id (it must survive a reconnect).
  emitToParticipant(roomId, interviewerId, 'interview:assistant-update', {
    phase: interview.phase,
    recommendation: recommendation || null,
    evaluation: evaluation || null,
    tracking: getTrackingSnapshot(roomId),
    summary: getCopilotSummary(roomId),
  });
}

function scheduleAssistantAnalysis(roomId) {
  if (analysisTimers.has(roomId)) {
    clearTimeout(analysisTimers.get(roomId));
  }
  const timer = setTimeout(() => {
    analysisTimers.delete(roomId);
    runAssistantAnalysis(roomId).catch((err) =>
      console.error(`[Assistant] analysis failed: ${err.message}`)
    );
  }, ANALYSIS_DEBOUNCE_MS);
  analysisTimers.set(roomId, timer);
}

/**
 * Minimal safe fallback so a participant ALWAYS gets a report object when
 * their turn ends, even if Gemini is unconfigured, times out, or errors
 * (e.g. an invalid/deprecated model). Without this, `report` stays null and
 * 'interview:turn-report' is never sent at all — the participant would
 * silently never see any feedback, with no error shown anywhere.
 * Mirrors the existing fallback-opener pattern used in 'interview:start'.
 * @param {object} interview
 */
function buildFallbackReport(interview) {
  return {
    overall_score: null,
    technical_score: null,
    communication_score: null,
    confidence_score: null,
    problem_solving_score: null,
    topics_covered: interview.topicsCovered || [],
    strengths: [],
    weaknesses: [],
    question_timeline: [],
    suggestions: [
      'The AI assistant could not generate detailed feedback for this session.',
    ],
    final_recommendation: 'Unavailable',
    unavailable: true,
  };
}

// Duration-enforcement timers per room (auto-end when time expires).
const durationTimers = new Map();

/**
 * End the interview for a room: generate the current candidate's report,
 * mark ended, and notify participants. Shared by the manual `interview:end`
 * handler and the automatic duration-expiry timer so behavior is identical.
 *
 * @param {string} roomId
 * @param {{ reason?: string }} [opts]
 */
async function endInterviewForRoom(roomId, opts = {}) {
  const interview = getInterview(roomId);
  if (!interview || interview.ended) return;

  // Clear any pending duration/analysis timers for this room.
  if (durationTimers.has(roomId)) {
    clearTimeout(durationTimers.get(roomId));
    durationTimers.delete(roomId);
  }
  if (analysisTimers.has(roomId)) {
    clearTimeout(analysisTimers.get(roomId));
    analysisTimers.delete(roomId);
  }

  const candidateId = interview.roles.candidateId;
  const interviewerId = interview.roles.interviewerId;

  let report = null;
  if (interviewAssistant.isConfigured()) {
    report = await interviewAssistant.generateReport({
      config: interview.config,
      transcriptBuffer: interview.transcriptBuffer,
      interviewerId,
      summary: getCopilotSummary(roomId),
    });
  }
  // Never leave the candidate with no report at all — degrade to a labeled
  // fallback rather than silently skipping 'interview:turn-report'.
  if (!report) {
    report = buildFallbackReport(interview);
  }

  interview.ended = true;
  interview.endedReason = opts.reason || 'manual';

  if (candidateId && report) {
    interview.lastTurnReport = { forParticipantId: candidateId, report, final: true };
    emitToParticipant(roomId, candidateId, 'interview:turn-report', {
      phase: interview.phase,
      report,
      final: true,
    });
  }

  // Both participants may be mid-reconnect — resolve each individually
  // instead of relying on io.to(roomId), which only reaches sockets that
  // are CURRENTLY joined to the Socket.io room.
  for (const participantId of [interview.roles.interviewerId, interview.roles.candidateId]) {
    emitToParticipant(roomId, participantId, 'interview:ended', {
      phase: interview.phase,
      reason: interview.endedReason,
    });
  }
}

/**
 * Catch a reconnecting participant up on interview state they missed while
 * their previous socket was dead — role, whether it's started, the
 * countdown deadline, the latest AI recommendation (interviewer only), and
 * either a pending turn report or the ended notice. Every emit here targets
 * `socketId` directly (their brand-new connection) rather than resolving
 * through emitToParticipant, since that's the one thing we know is live.
 *
 * @param {string} roomId
 * @param {string} participantId - the reconnecting participant's stable id
 * @param {string} socketId - their NEW socket, already joined to the room
 */
function sendInterviewStateTo(roomId, participantId, socketId) {
  const interview = getInterview(roomId);
  if (!interview || !interview.configured) return;

  const role =
    participantId === interview.roles.interviewerId
      ? 'interviewer'
      : participantId === interview.roles.candidateId
      ? 'candidate'
      : null;
  if (!role) return;

  io.to(socketId).emit('interview:role', {
    role,
    config: interview.config,
    phase: interview.phase,
    aiAssisted: true,
  });

  if (interview.ended) {
    io.to(socketId).emit('interview:ended', {
      phase: interview.phase,
      reason: interview.endedReason || 'manual',
    });
    if (
      interview.lastTurnReport &&
      interview.lastTurnReport.forParticipantId === participantId
    ) {
      io.to(socketId).emit('interview:turn-report', {
        phase: interview.phase,
        report: interview.lastTurnReport.report,
        final: interview.lastTurnReport.final,
      });
    }
    return;
  }

  if (!interview.started) return;

  io.to(socketId).emit('interview:started', { phase: interview.phase });

  if (interview.deadline) {
    io.to(socketId).emit('interview:deadline', { deadline: interview.deadline, phase: interview.phase });
  }

  if (
    interview.lastTurnReport &&
    interview.lastTurnReport.forParticipantId === participantId
  ) {
    io.to(socketId).emit('interview:turn-report', {
      phase: interview.phase,
      report: interview.lastTurnReport.report,
      final: interview.lastTurnReport.final,
    });
  }

  if (role === 'interviewer') {
    io.to(socketId).emit('interview:assistant-update', {
      phase: interview.phase,
      recommendation: interview.lastRecommendation || null,
      evaluation: interview.evaluation || null,
      tracking: getTrackingSnapshot(roomId),
      summary: getCopilotSummary(roomId),
    });
  }
}

const transcriptionManager = createDeepgramTranscriptionManager({
  apiKey: process.env.DEEPGRAM_API_KEY,
  onInterimTranscript: (payload) => {
    io.to(payload.speakerId).emit('transcription:interim', payload);
  },
  onFinalTranscript: (payload) => {
    // Resolve once: the speaker's STABLE participantId (not socket.id), so
    // the client can correctly label "You" vs "Participant" even after a
    // reconnect changes its own socket.id (which the raw speakerId does
    // not survive).
    const speakerParticipantId =
      getParticipantIdForSocket(payload.roomId, payload.speakerId) || payload.speakerId;

    const enrichedPayload = { ...payload, speakerParticipantId };

    // Broadcast the shared transcript to the whole room in realtime.
    io.to(payload.roomId).emit('transcription:final', enrichedPayload);

    // Persist into the full-call history so a reconnecting or late-joining
    // participant can resync the exact same transcript (see 'join-room').
    appendTranscriptHistory(payload.roomId, {
      id: payload.id,
      speakerId: payload.speakerId,
      speakerParticipantId,
      text: payload.text,
      timestamp: payload.timestamp,
    });

    // Additive: buffer the line into interview state and schedule AI analysis.
    const interview = getInterview(payload.roomId);
    if (interview && interview.started && !interview.ended) {
      appendTranscriptLine(payload.roomId, {
        speakerId: speakerParticipantId,
        text: payload.text,
        timestamp: payload.timestamp,
      });
      scheduleAssistantAnalysis(payload.roomId);
    }
  },
  onError: (socketId, message) => {
    io.to(socketId).emit('transcription:error', { message });
  },
  onReconnected: (socketId) => {
    io.to(socketId).emit('transcription:recovered');
  },
});

// ─── Lightweight per-socket rate limiting ───────────────────────────────────────
// Guards the handful of events that trigger an expensive/paid external call
// (Gemini, Deepgram, Metered) against obvious abuse (a misbehaving or
// malicious client firing the same event in a tight loop). Thresholds are
// generous multiples of realistic usage — see call sites — so a normal
// interview is never affected; this only rejects clearly-abnormal rates.
// Cleared per-socket on disconnect (see the 'disconnect' handler) so this
// never grows unbounded across the life of the server.
const rateLimitState = new Map(); // socket.id -> Map(eventName -> lastCallTimestamp)

function isRateLimited(socket, eventName, minIntervalMs) {
  let events = rateLimitState.get(socket.id);
  if (!events) {
    events = new Map();
    rateLimitState.set(socket.id, events);
  }

  const now = Date.now();
  const last = events.get(eventName) || 0;
  if (now - last < minIntervalMs) return true;

  events.set(eventName, now);
  return false;
}

// ─── Socket.io Signaling Logic ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  /**
   * ICE-SERVERS:REQUEST
   * Deliver the current STUN/TURN server list over the authenticated socket
   * connection instead of hardcoding credentials in client source.
   */
  socket.on('ice-servers:request', async () => {
    // 2s floor: one legitimate request per call join, plus the client's own
    // 3s no-response fallback — never hit in normal use.
    if (isRateLimited(socket, 'ice-servers:request', 2000)) return;
    socket.emit('ice-servers:response', { iceServers: await buildIceServers() });
  });

  /**
   * CREATE-ROOM
   * First participant creates a room and becomes the initiator. Also used
   * as the fallback when 'join-room' comes back room-not-found for someone
   * who expects to be the initiator (e.g. their room was fully abandoned
   * and needs recreating) — see the 'join-room'-driven client fallback.
   */
  socket.on('create-room', ({ roomId, participantId } = {}) => {
    console.log(`[Room] create-room | roomId=${roomId} | participantId=${participantId} | socketId=${socket.id}`);

    if (!roomId || !participantId) return;

    if (roomExists(roomId)) {
      // Room already exists — the client falls back to join-room.
      socket.emit('room-exists', { roomId });
      return;
    }

    createRoom(roomId, participantId, socket.id);
    socket.join(roomId);
    socket.emit('room-created', { roomId });

    console.log(`[Room] Created: ${roomId}`);
  });

  /**
   * JOIN-ROOM
   * Join an existing room as either a fresh second participant OR — when
   * `participantId` already holds a slot in this room — a RECONNECT (network
   * blip or page refresh), which reclaims that slot in place so interview
   * roles/state survive.
   *   - Room is full (2 DIFFERENT participants) → room-full.
   *   - Room doesn't exist → room-not-found (client falls back to
   *     create-room if it expects to be the initiator).
   *   - On success → notify both participants; on reconnect, also resync
   *     the reconnecting participant's interview state.
   */
  socket.on('join-room', ({ roomId, participantId } = {}) => {
    console.log(`[Room] join-room | roomId=${roomId} | participantId=${participantId} | socketId=${socket.id}`);

    if (!roomId || !participantId) {
      socket.emit('room-not-found', { roomId });
      return;
    }

    // The liveness probe lets joinRoom tell a genuine reconnect (old socket
    // already gone) apart from a duplicate tab that inherited this room's
    // participantId via sessionStorage (old socket still connected).
    const result = joinRoom(roomId, participantId, socket.id, (id) =>
      io.sockets.sockets.has(id)
    );

    if (result.notFound) {
      socket.emit('room-not-found', { roomId });
      return;
    }

    if (result.duplicateSession) {
      console.log(
        `[Room] Rejecting duplicate session | roomId=${roomId} | participantId=${participantId} | socketId=${socket.id}`
      );
      socket.emit('room-full', { roomId, reason: 'duplicate-session' });
      return;
    }

    if (result.isFull) {
      socket.emit('room-full', { roomId });
      return;
    }

    // Join the Socket.io room (for targeting)
    socket.join(roomId);

    // Resync the live-transcript panel: a reconnecting participant's old
    // socket.id is gone (their client-side transcript state is fresh/empty
    // React state), and a late-joining second participant has never seen
    // anything said before they joined. Either way, replay the room's full
    // transcript history so both sides always converge on the same log.
    const history = getTranscriptHistory(roomId);
    if (history.length) {
      socket.emit('transcription:history', { entries: history });
    }

    if (result.reconnected) {
      // Tell this participant who the current partner is, exactly like a
      // fresh 'ready' — their client destroys any stale peer and creates a
      // new one as the receiver.
      socket.emit('ready', { initiatorId: result.partnerId });
      // Tell the (still-connected) partner this participant is back, so
      // THEY create a fresh peer as the initiator.
      if (result.partnerId) {
        io.to(result.partnerId).emit('user-joined', { signal: null, callerId: socket.id });
      }
      // Resync interview role/state — they missed whatever was emitted to
      // their previous (now-dead) socket while disconnected.
      sendInterviewStateTo(roomId, participantId, socket.id);

      console.log(`[Room] ${socket.id} reconnected to room ${roomId} as participant ${participantId}`);
      return;
    }

    // Fresh join: tell the initiator (participant A) that B has joined.
    // Initiator will create SimplePeer with initiator=true and send an offer.
    socket.to(result.partnerId).emit('user-joined', {
      signal: null,
      callerId: socket.id,
    });

    // Tell participant B who the initiator is so they can set up SimplePeer.
    socket.emit('ready', {
      initiatorId: result.partnerId,
    });

    console.log(`[Room] ${socket.id} joined room ${roomId}. Partner: ${result.partnerId}`);
  });

  /**
   * SIGNAL
   * Forward a WebRTC signal (SDP offer, SDP answer, or ICE candidate)
   * from the sender to the target peer.
   * The server is a dumb relay — it never inspects the signal content.
   */
  socket.on('signal', ({ signal, to }) => {
    console.log(`[Signal] ${socket.id} → ${to} | type=${signal?.type || 'candidate'}`);

    io.to(to).emit('return-signal', {
      signal,
      from: socket.id,
    });
  });

  /**
   * TRANSCRIPTION:START
   * Start an independent Deepgram stream for this participant.
   * The client must already be in the Socket.io room it is transcribing for.
   */
  socket.on('transcription:start', ({ roomId, mimeType } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) {
      socket.emit('transcription:error', {
        message: 'Join a meeting room before starting transcription.',
      });
      return;
    }

    // 1s floor: a real client starts this once per mic-enable/reconnect —
    // guards against a client opening a flood of Deepgram connections.
    if (isRateLimited(socket, 'transcription:start', 1000)) return;

    const started = transcriptionManager.start({
      socketId: socket.id,
      roomId,
      mimeType,
    });

    if (started) {
      socket.emit('transcription:started', { roomId });
    }
  });

  /**
   * TRANSCRIPTION:AUDIO
   * Forward only this socket's own microphone chunks to its own Deepgram stream.
   * Audio chunks are never broadcast to other participants.
   */
  socket.on('transcription:audio', (audioChunk) => {
    // 50ms floor (20/s cap): the real recorder emits one chunk every 250ms
    // (4/s) — 5x headroom over normal use, only rejects a flood.
    if (isRateLimited(socket, 'transcription:audio', 50)) return;
    transcriptionManager.sendAudio(socket.id, audioChunk);
  });

  /**
   * TRANSCRIPTION:STOP
   * Close this participant's Deepgram stream without affecting the WebRTC call.
   */
  socket.on('transcription:stop', () => {
    transcriptionManager.stop(socket.id);
    socket.emit('transcription:stopped');
  });

  // ── Interview: configure ─────────────────────────────────────────────────
  // The creator submits interview setup. Server assigns roles and tells BOTH
  // participants their role + that AI assistance is active (disclosure).
  socket.on('interview:configure', ({ roomId, config } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:configure', 1000)) return;

    // Don't allow reconfiguring once the interview has started.
    const existing = getInterview(roomId);
    if (existing?.started && !existing?.ended) return;

    // Only the participant who originally configured the interview (the
    // meeting host) may (re)configure it. This must NOT be checked against
    // roles.interviewerId — when whoStarts === 'candidate' the host is
    // assigned the CANDIDATE role, so anchoring on interviewerId would
    // incorrectly lock the host out of their own setup.
    if (existing?.configured && existing.configuredBy && existing.configuredBy !== myParticipantId) {
      return;
    }

    const interview = configureInterview(roomId, config, myParticipantId);
    if (!interview) return;

    // Both roles must be resolvable (i.e. the partner has joined) before we
    // announce roles; otherwise setup was submitted too early.
    if (!interview.roles.interviewerId || !interview.roles.candidateId) return;

    const { interviewerId, candidateId } = interview.roles;

    // Tell each participant their own role. Disclosure banner shows for both.
    emitToParticipant(roomId, interviewerId, 'interview:role', {
      role: 'interviewer',
      config: interview.config,
      phase: interview.phase,
      aiAssisted: true,
    });
    emitToParticipant(roomId, candidateId, 'interview:role', {
      role: 'candidate',
      config: interview.config,
      phase: interview.phase,
      aiAssisted: true,
    });
  });

  // ── Interview: start ─────────────────────────────────────────────────────
  socket.on('interview:start', async ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:start', 2000)) return;

    const existing = getInterview(roomId);
    // Only the meeting host (whoever submitted setup) may start the
    // interview — anchored on configuredBy, not roles.interviewerId, since
    // the host may have assigned themselves the candidate role.
    if (!existing?.configuredBy || existing.configuredBy !== myParticipantId) return;

    const interview = startInterview(roomId);
    if (!interview) return;

    for (const participantId of [interview.roles.interviewerId, interview.roles.candidateId]) {
      emitToParticipant(roomId, participantId, 'interview:started', { phase: interview.phase });
    }

    // ── Duration enforcement ──────────────────────────────────────────────
    // Emit an absolute deadline so both clients can render a synced countdown
    // and a 2-minute warning; the server auto-ends when the time expires.
    const durationMinutes = Number(interview.config?.durationMinutes) || 0;
    if (durationMinutes > 0) {
      const deadline = Date.now() + durationMinutes * 60 * 1000;
      interview.deadline = deadline;
      for (const participantId of [interview.roles.interviewerId, interview.roles.candidateId]) {
        emitToParticipant(roomId, participantId, 'interview:deadline', { deadline, phase: interview.phase });
      }

      if (durationTimers.has(roomId)) {
        clearTimeout(durationTimers.get(roomId));
      }
      const timer = setTimeout(() => {
        durationTimers.delete(roomId);
        endInterviewForRoom(roomId, { reason: 'time-expired' }).catch((err) =>
          console.error(`[Interview] auto-end failed: ${err.message}`)
        );
      }, durationMinutes * 60 * 1000);
      durationTimers.set(roomId, timer);
    }

    // If the candidate is set to start, immediately recommend an AI-generated
    // opening question to the interviewer only (no hardcoded fallback text
    // unless the AI is unavailable).
    if (interview.config?.whoStarts === 'candidate' && interview.roles.interviewerId) {
      let opener = null;
      if (interviewAssistant.isConfigured()) {
        opener = await interviewAssistant.generateOpeningQuestion({
          config: interview.config,
        });
      }

      // Minimal safe fallback only if the AI call is unavailable/failed.
      if (!opener) {
        opener = {
          question: `To start, walk me through your experience with ${interview.config?.domain || 'this area'}.`,
          expected_answer: [
            'A relevant summary of hands-on experience',
            'Specific projects or problems tackled',
            'Depth appropriate to the stated experience level',
          ],
          difficulty: 'Easy',
          skills: ['Communication'],
          follow_up: 'Which part of that are you most confident in?',
          candidate_level: interview.config?.experience || 'Unknown',
          confidence_estimate: 'n/a',
          topics_covered: [],
          remaining_topics: [],
          reasoning: 'Fallback opener (AI assistant unavailable).',
        };
      }

      if (opener.question) {
        interview.askedQuestions.push(opener.question);
        mergeTracking(roomId, opener);
        interview.lastRecommendation = opener;
      }

      emitToParticipant(roomId, interview.roles.interviewerId, 'interview:assistant-update', {
        phase: interview.phase,
        recommendation: opener,
        evaluation: null,
        tracking: getTrackingSnapshot(roomId),
        summary: getCopilotSummary(roomId),
      });
    }
  });

  // ── Interview: switch roles ──────────────────────────────────────────────
  // Generates a feedback report for the participant who just finished being
  // interviewed, then flips roles and re-routes AI assistance.
  socket.on('interview:switch-roles', async ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:switch-roles', 3000)) return;

    const interview = getInterview(roomId);
    if (!interview || !interview.started) return;
    // Only the current interviewer may end their own turn / switch roles.
    if (interview.roles.interviewerId !== myParticipantId) return;

    const outgoingCandidateId = interview.roles.candidateId;
    const interviewerId = interview.roles.interviewerId;

    // Build the report from the current phase transcript BEFORE swapping.
    let report = null;
    if (interviewAssistant.isConfigured()) {
      report = await interviewAssistant.generateReport({
        config: interview.config,
        transcriptBuffer: interview.transcriptBuffer,
        interviewerId,
        summary: getCopilotSummary(roomId),
      });
    }
    // Never leave the outgoing candidate with no report at all.
    if (!report) {
      report = buildFallbackReport(interview);
    }

    // Deliver the report to the participant who was just the candidate.
    if (outgoingCandidateId && report) {
      interview.lastTurnReport = { forParticipantId: outgoingCandidateId, report, final: false };
      emitToParticipant(roomId, outgoingCandidateId, 'interview:turn-report', {
        phase: interview.phase,
        report,
      });
    }

    // Flip roles + advance phase (also clears the phase transcript buffer).
    const updated = switchInterviewRoles(roomId);
    if (!updated) return;

    // Fresh phase — reset the analysis watermark so the new turn is analyzed.
    analysisWatermark.delete(roomId);

    // Notify both participants of their NEW roles.
    emitToParticipant(roomId, updated.roles.interviewerId, 'interview:role', {
      role: 'interviewer',
      config: updated.config,
      phase: updated.phase,
      aiAssisted: true,
    });
    emitToParticipant(roomId, updated.roles.candidateId, 'interview:role', {
      role: 'candidate',
      config: updated.config,
      phase: updated.phase,
      aiAssisted: true,
    });

    for (const participantId of [updated.roles.interviewerId, updated.roles.candidateId]) {
      emitToParticipant(roomId, participantId, 'interview:roles-switched', { phase: updated.phase });
    }
  });

  // ── Interview: end ───────────────────────────────────────────────────────
  // Produces a final report for the current candidate and marks the interview
  // ended. Reports are disclosed to their own subject.
  socket.on('interview:end', async ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:end', 3000)) return;

    const interview = getInterview(roomId);
    // Only the current interviewer may end the interview.
    if (!interview?.roles?.interviewerId || interview.roles.interviewerId !== myParticipantId) return;

    await endInterviewForRoom(roomId, { reason: 'manual' });
  });

  /**
   * DISCONNECT
   * Built-in event. Clean up the room and notify partner.
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} | reason=${reason}`);

    rateLimitState.delete(socket.id);
    transcriptionManager.stop(socket.id);

    // leaveRoom() marks this participant's slot as disconnected but keeps
    // it around (see roomManager.js) so a reconnect within the room's
    // lifetime can reclaim it and its interview role — it only deletes the
    // room once EVERY participant slot is disconnected.
    const { roomId, partnerId } = leaveRoom(socket.id);

    if (partnerId) {
      console.log(`[Room] Notifying partner ${partnerId} that ${socket.id} left room ${roomId}`);
      io.to(partnerId).emit('user-left', { socketId: socket.id });
    }

    // Only tear down room-scoped AI/duration timers once the room is
    // TRULY abandoned (both participants disconnected). A lone drop may
    // just be a transient network blip that reconnects within seconds —
    // killing the duration timer here would mean the interview could
    // never auto-end once time expires, and killing the analysis timer
    // would silently stop AI assistance even after they reconnect.
    if (roomId && !roomExists(roomId)) {
      if (analysisTimers.has(roomId)) {
        clearTimeout(analysisTimers.get(roomId));
        analysisTimers.delete(roomId);
      }
      analysisWatermark.delete(roomId);
      if (durationTimers.has(roomId)) {
        clearTimeout(durationTimers.get(roomId));
        durationTimers.delete(roomId);
      }
    }

    if (roomId) {
      console.log(`[Room] ${socket.id} removed from room ${roomId}`);
    }
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`\n🚀 Signaling server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Accepting clients from: ${CLIENT_URL}\n`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
// Most deploy platforms (Render, Railway, Fly, Docker, etc.) send SIGTERM on
// every redeploy/scale-down/restart. Without a handler, in-flight Gemini
// calls, Deepgram connections, and Socket.IO sessions are hard-killed
// mid-request instead of draining. This closes things in order and exits —
// deliberately simple (no request-draining infrastructure): clients already
// reconnect on their own (see socket.js's reconnection config), so a clean,
// prompt close is enough here.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received — closing server...`);

  // Stop all room-scoped timers so nothing fires against a closing server.
  for (const timer of durationTimers.values()) clearTimeout(timer);
  durationTimers.clear();
  for (const timer of analysisTimers.values()) clearTimeout(timer);
  analysisTimers.clear();

  // Close every open Deepgram connection.
  for (const [, connectedSocket] of io.sockets.sockets) {
    transcriptionManager.stop(connectedSocket.id);
  }

  // Stop accepting new Socket.IO connections and disconnect existing ones
  // (does NOT close the underlying HTTP server — it was passed in, not
  // created by Socket.IO — so server.close() below is still required).
  io.close();

  // Stop accepting new HTTP connections; exit once existing ones drain.
  server.close((err) => {
    if (err) {
      console.error('[Shutdown] Error while closing server:', err.message);
      process.exit(1);
    }
    console.log('[Shutdown] Closed cleanly.');
    process.exit(0);
  });

  // Safety net: force-exit if something hangs, instead of leaving the
  // process stuck forever past the platform's own kill timeout.
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
