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
  getIdentityForParticipant,
  getPublicDisplayName,
  addChatMessage,
  getChatHistory,
  getHostParticipantId,
  holdsSlotWithIdentity,
  everyoneConsentedToTranscription,
  isRoomRestricted,
  isParticipantPrivate,
  getRoomIdForSocket,
  getPartner,
  releaseParticipant,
  getPrecallSnapshot,
  setSessionConsent,
  setReady,
  isSessionStarted,
  isPairAdmitted,
  isSessionCancelled,
  cancelSession,
  precallNeedsTimer,
  setMediaReady,
  markConsentVerified,
  isConsentVerified,
  getParticipantsForRoom,
} = require('./roomManager');
const { hasEnoughToJudge, buildInsufficientReport } = require('./answerCheck');
const { sanitizeReport } = require('./reportSanitizer');
const {
  createDeepgramTranscriptionManager,
} = require('./deepgramTranscription');
const { createInterviewAssistant } = require('./interviewAssistant');
const jwt = require('jsonwebtoken');

// ─── Dashboard integration ─────────────────────────────────────────────────────
// Optional identity handoff. Tokens signed by the Mirracle FastAPI backend with
// PEERMEET_SHARED_SECRET (HS256) attach the caller's student identity to
// their participant slot. Verification is synchronous — no network round trip.
// Missing/malformed/expired tokens fall back to anonymous behavior silently:
// existing anonymous PeerMeet flows are never rejected.
const PEERMEET_SHARED_SECRET = process.env.PEERMEET_SHARED_SECRET || null;
const MIRRACLE_WEBHOOK_URL = process.env.MIRRACLE_WEBHOOK_URL || null;
// Separate secrets are optional; both fall back to the older single shared secret.
const TOKEN_SECRET = process.env.PEERMEET_TOKEN_SECRET || PEERMEET_SHARED_SECRET;
const WEBHOOK_SECRET = process.env.PEERMEET_WEBHOOK_SECRET || PEERMEET_SHARED_SECRET;
// When set, EVERY room needs a valid room-bound token (use this for a dashboard-only deployment).
// Unset keeps standalone anonymous rooms working.
const REQUIRE_TOKEN = ['1', 'true', 'yes'].includes(String(process.env.PEERMEET_REQUIRE_TOKEN || '').toLowerCase());
// Room and participant ids are used as socket.io room names: keep them boring.
const ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const crypto = require('crypto');

/** First characters only: room ids are join credentials, so they never go to the logs in full. */
const short = (id) => String(id || '').slice(0, 4) + '…';

/**
 * Verify a dashboard-issued identity token. Returns
 * `{ studentId, studentName }` on success, or null on any failure
 * (missing token, secret unconfigured, bad signature, expired, malformed).
 * NEVER throws — a bad token must not reject room creation/join.
 */
function verifyPeerToken(token) {
  if (!token || !TOKEN_SECRET) return null;
  try {
    const decoded = jwt.verify(token, TOKEN_SECRET, { algorithms: ['HS256'], audience: 'peermeet' });
    // A token must expire and must name the room it is for; without those it is not usable.
    if (!decoded || !decoded.student_id || !decoded.exp || !decoded.room) return null;
    return {
      studentId: decoded.student_id,
      studentName: decoded.name || null,
      firstName: decoded.first_name || null,
      collegeBranch: decoded.college_branch || null,
      room: decoded.room,
    };
  } catch {
    return null;
  }
}

/**
 * Decide whether a socket may enter a room. Returns null when allowed, or the reason it is refused.
 *  - a token for a DIFFERENT room is always refused (misuse or a replayed token);
 *  - rooms that belong to the dashboard (created with a token) refuse anonymous guests;
 *  - with PEERMEET_REQUIRE_TOKEN=1 nobody enters without a valid token.
 */
function checkRoomAccess(roomId, rawToken, identity, { creating = false } = {}) {
  if (rawToken && !identity) return REQUIRE_TOKEN || isRoomRestricted(roomId) ? 'invalid-token' : null;
  if (identity && identity.room !== roomId) return 'wrong-room';
  if (!identity) {
    if (REQUIRE_TOKEN) return 'token-required';
    if (!creating && isRoomRestricted(roomId)) return 'token-required';
  }
  return null;
}

// Retry schedule for the report webhook (ms). A report is the only durable record of an interview,
// so a short outage on the dashboard side must not lose it. Overridable for tests.
const WEBHOOK_RETRY_DELAYS_MS = (process.env.PEERMEET_WEBHOOK_RETRY_MS || '0,2000,10000,30000')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

/** POST a signed payload to the dashboard backend; retries network errors, 429 and 5xx, never other 4xx. */
const postReportWithRetry = (payload) => postSigned('/internal/peer-reports', payload);

async function postSigned(pathname, payload, { delays = WEBHOOK_RETRY_DELAYS_MS } = {}) {
  const url = `${MIRRACLE_WEBHOOK_URL.replace(/\/+$/, '')}${pathname}`;
  const body = JSON.stringify(payload);
  let lastError = 'no attempt made';
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    // Fresh timestamp + signature each attempt so a retry is never rejected as stale.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WEBHOOK_SECRET}`,
          'X-Peer-Timestamp': timestamp,
          'X-Peer-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return res;
      lastError = `responded ${res.status}`;
      if (res.status !== 429 && res.status < 500) {
        // permanent: do not retry. Keep the status and the server's own words for callers that show them.
        const failure = new Error(lastError);
        failure.status = res.status;
        failure.detail = (await res.json().catch(() => null))?.detail;
        throw failure;
      }
    } catch (err) {
      if (String(err.message).startsWith('responded')) throw err;
      lastError = err.message;
    }
    console.error(`[Webhook] peer-reports attempt failed (${lastError})`);
  }
  throw new Error(lastError);
}

/**
 * One signed call to the dashboard backend whose ANSWER matters (consent check, onboarding flag, no-show).
 * Never throws: returns { ok, status, body }. A person is waiting on it, so there is a single quick attempt.
 */
async function callBackend(pathname, payload) {
  if (!MIRRACLE_WEBHOOK_URL || !WEBHOOK_SECRET) return { ok: false, status: 0, body: null };
  try {
    const res = await postSigned(pathname, payload, { delays: [0] });
    return { ok: true, status: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    return { ok: false, status: err.status || 0, body: null, detail: typeof err.detail === 'string' ? err.detail : null, error: err.message };
  }
}

/**
 * Fire-and-forget POST of a generated report to the FastAPI persistence
 * webhook. MUST be called WITHOUT `await` — the caller has already emitted
 * the live 'interview:turn-report' event to the participant, and a webhook
 * failure (or FastAPI being down) must never delay or affect the live
 * interview. Skipped entirely when the reporting participant is anonymous.
 */
function fireReportWebhook({
  roomId,
  subjectParticipantId,
  partnerParticipantId,
  role,
  report,
  phase = 1,
  final = true,
}) {
  if (!MIRRACLE_WEBHOOK_URL || !WEBHOOK_SECRET) return;
  if (!report) return;

  const subject = getIdentityForParticipant(roomId, subjectParticipantId);
  if (!subject?.studentId) return; // anonymous subject → never persist

  const partner = partnerParticipantId
    ? getIdentityForParticipant(roomId, partnerParticipantId)
    : null;

  const payload = {
    room_id: roomId,
    student_id: subject.studentId,
    partner_student_id: partner?.studentId || null,
    role,
    phase,
    final,
    unavailable: !!report.unavailable,
    insufficient: !!report.insufficient,
    // Did the partner ask to stay anonymous? The dashboard hides their name unless this is false.
    partner_private: partnerParticipantId ? isParticipantPrivate(roomId, partnerParticipantId) : null,
    report: {
      overall_score: report.overall_score ?? null,
      technical_score: report.technical_score ?? null,
      communication_score: report.communication_score ?? null,
      confidence_score: report.confidence_score ?? null,
      problem_solving_score: report.problem_solving_score ?? null,
      topics_covered: report.topics_covered || [],
      strengths: report.strengths || [],
      weaknesses: report.weaknesses || [],
      question_timeline: report.question_timeline || [],
      suggestions: report.suggestions || [],
      final_recommendation: report.final_recommendation ?? null,
    },
  };

  postReportWithRetry(payload).catch((err) => {
    console.error(`[Webhook] peer-reports gave up: ${err.message}`);
  });
}

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
  const REQUIRED_IN_PRODUCTION = [
    'CLIENT_URL',
    'GEMINI_API_KEY',
    'DEEPGRAM_API_KEY',
    'METERED_API_KEY',
    'PEERMEET_SHARED_SECRET',
    'MIRRACLE_WEBHOOK_URL',
  ];
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(
      `\n⚠️  [Config] Missing environment variable(s) in production: ${missing.join(', ')}\n` +
      '   The server will still start, but dependent features will be silently disabled:\n' +
      '     - CLIENT_URL missing      → CORS falls back to localhost, the real frontend will be blocked\n' +
      '     - GEMINI_API_KEY missing  → AI interview assistant (questions/evaluation/follow-ups/reports) disabled\n' +
      '     - DEEPGRAM_API_KEY missing→ live transcription disabled\n' +
      '     - METERED_API_KEY missing → falls back to static TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL if set, else TURN relay is unavailable\n' +
      '     - PEERMEET_SHARED_SECRET missing → dashboard identity tokens are ignored and reports are never saved\n' +
      '     - MIRRACLE_WEBHOOK_URL missing → interview reports are never saved to the dashboard\n'
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

/**
 * Run one room's setup steps one after another. The browser sends "configure" and "start" back to back,
 * and "configure" now waits on the backend to confirm both Yes answers, so without this "start" could be
 * looked at before "configure" had finished and be silently ignored.
 */
const roomQueues = new Map();
function enqueueForRoom(roomId, task) {
  const prev = roomQueues.get(roomId) || Promise.resolve();
  const next = prev.then(task).catch((err) => console.error(`[Room] queued step failed: ${err.message}`));
  roomQueues.set(roomId, next);
  next.then(() => {
    if (roomQueues.get(roomId) === next) roomQueues.delete(roomId);
  });
  return next;
}

// ── Pre-call ("Get ready") ─────────────────────────────────────────────────────
// Both people join the room first, but nothing is sent between them (no video, no captions, no AI)
// until each has answered the consent question with Yes and clicked Ready.
const SESSION_CONSENT_VERSION = '2026-10-session-v1'; // keep in step with the backend's SESSION_CONSENT_VERSION
const PRECALL_TIMEOUT_MS = Number(process.env.PEERMEET_PRECALL_TIMEOUT_MS) || 5 * 60 * 1000;
const precallTimers = new Map();
const precallDeadlines = new Map();

function sendPrecallState(roomId) {
  for (const p of getParticipantsForRoom(roomId)) {
    if (!p.socketId) continue;
    const snap = getPrecallSnapshot(roomId, p.participantId);
    if (!snap) continue;
    io.to(p.socketId).emit('precall:state', {
      roomId,
      ...snap,
      deadlineAt: snap.phase === 'precall' ? precallDeadlines.get(roomId) || null : null,
      consentVersion: SESSION_CONSENT_VERSION,
    });
  }
}

function clearPrecallTimer(roomId) {
  clearTimeout(precallTimers.get(roomId));
  precallTimers.delete(roomId);
  precallDeadlines.delete(roomId);
}

/** Cancel the pre-call for both people. Only a timeout names a reason; a decline never does. */
function cancelPrecall(roomId, reason) {
  const people = cancelSession(roomId);
  clearPrecallTimer(roomId);
  for (const p of people || []) {
    if (p.socketId) io.to(p.socketId).emit('session:cancelled', reason ? { reason } : {});
  }
}

/** Start the clock once both people are on the Ready screen: someone who never clicks Ready ends it. */
function armPrecallTimer(roomId) {
  if (!precallNeedsTimer(roomId)) return;
  if (precallTimers.has(roomId)) return;
  precallDeadlines.set(roomId, Date.now() + PRECALL_TIMEOUT_MS);
  const timer = setTimeout(() => {
    precallTimers.delete(roomId);
    precallDeadlines.delete(roomId);
    if (roomExists(roomId) && !isSessionStarted(roomId) && !isSessionCancelled(roomId)) cancelPrecall(roomId, 'timeout');
  }, PRECALL_TIMEOUT_MS);
  timer.unref?.();
  precallTimers.set(roomId, timer);
}

/**
 * May this room's speech be transcribed and reviewed by AI? Only when the session has started and BOTH
 * people said Yes, and (for dashboard people) the backend confirms a stored Yes for each of them.
 * Anything unclear means no.
 */
async function recordingAllowed(roomId) {
  if (!isPairAdmitted(roomId) || !everyoneConsentedToTranscription(roomId)) return false;
  const people = getParticipantsForRoom(roomId);
  const identified = people.filter((p) => p.studentId);
  if (identified.length === 0) return true; // a plain anonymous room has no account to store an answer on
  if (identified.length !== people.length) return false; // one side cannot be verified
  if (isConsentVerified(roomId)) return true;
  const res = await callBackend('/internal/peer/session-consent/check', {
    room_id: roomId,
    student_ids: identified.map((p) => p.studentId),
  });
  if (res.ok && res.body?.all_yes === true) {
    markConsentVerified(roomId);
    return true;
  }
  return false;
}

/** The first time a person is ever made interviewer, show them a one-time message (saved per person). */
async function offerInterviewerOnboarding(roomId, participantId) {
  const identity = getIdentityForParticipant(roomId, participantId);
  let show = true; // a person we cannot save a flag for (anonymous, or the backend is down) sees it
  if (identity?.studentId) {
    const res = await callBackend('/internal/peer/onboarding/status', { student_id: identity.studentId });
    if (res.ok && res.body?.seen === true) show = false;
  }
  if (show) emitToParticipant(roomId, participantId, 'onboarding:interviewer', {});
}

/** A round with too little candidate speech gets an honest "too short to judge" report, not a score. */
async function buildTurnReport(roomId, interview) {
  if (!hasEnoughToJudge(interview.transcriptBuffer, interview.roles.candidateId)) {
    return buildInsufficientReport(interview.topicsCovered || []);
  }
  let report = null;
  if (interviewAssistant.isConfigured()) {
    try {
      report = sanitizeReport(
        await interviewAssistant.generateReport({
          config: interview.config,
          transcriptBuffer: interview.transcriptBuffer,
          interviewerId: interview.roles.interviewerId,
          summary: getCopilotSummary(roomId),
        })
      );
    } catch (err) {
      console.error(`[Interview] report generation failed: ${err.message}`);
    }
  }
  return report || buildFallbackReport(interview);
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
  // The phase this analysis belongs to: if roles switch while Gemini is thinking, drop the result.
  const phaseAtStart = interview.phase;

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

  // Roles may have switched (or the interview ended) during the AI call. Writing this result would
  // put the old turn's questions into the new turn and send an interviewer-only update to the new candidate.
  if (interview.phase !== phaseAtStart || interview.ended || interview.roles.interviewerId !== interviewerId) return;

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
  // `ending` is set BEFORE the long report await, so a manual end plus the timer cannot both run.
  if (!interview || interview.ended || interview.ending) return;
  interview.ending = true;

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

  const report = await buildTurnReport(roomId, interview);

  interview.ended = true;
  interview.endedReason = opts.reason || 'manual';

  if (candidateId && report) {
    interview.lastTurnReport = { forParticipantId: candidateId, report, final: true };
    emitToParticipant(roomId, candidateId, 'interview:turn-report', {
      phase: interview.phase,
      report,
      final: true,
    });
    // Fire-and-forget persistence — MUST NOT be awaited: the live socket
    // emit above must not be delayed and a webhook failure must never
    // affect the interview. Skipped internally when subject is anonymous.
    fireReportWebhook({
      roomId,
      subjectParticipantId: candidateId,
      partnerParticipantId: interviewerId,
      role: 'candidate',
      report,
      phase: interview.phase + 1, // the dashboard counts phases from 1; roomManager starts at 0
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
    offerInterviewerOnboarding(roomId, participantId).catch(() => {});
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

const chatTimes = new Map(); // socket.id -> recent message timestamps
function isChatLimited(socket) {
  const now = Date.now();
  const recent = (chatTimes.get(socket.id) || []).filter((t) => now - t < 5000);
  if (recent.length >= 10) {
    chatTimes.set(socket.id, recent);
    return true;
  }
  recent.push(now);
  chatTimes.set(socket.id, recent);
  return false;
}

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
  socket.on('create-room', ({ roomId, participantId, token, keepPrivate } = {}) => {
    console.log(`[Room] create-room | room=${short(roomId)} | socket=${short(socket.id)}`);

    if (!ID_PATTERN.test(String(roomId || '')) || !ID_PATTERN.test(String(participantId || ''))) {
      socket.emit('room-not-found', { roomId: null });
      return;
    }

    if (roomExists(roomId)) {
      // Room already exists — the client falls back to join-room.
      socket.emit('room-exists', { roomId });
      return;
    }

    // Identity comes from a signed, room-bound token. Anonymous rooms are allowed unless the
    // deployment sets PEERMEET_REQUIRE_TOKEN=1.
    const identity = verifyPeerToken(token);
    const denied = checkRoomAccess(roomId, token, identity, { creating: true });
    if (denied) {
      socket.emit('auth-error', { reason: denied });
      return;
    }
    createRoom(roomId, participantId, socket.id, identity, !!keepPrivate);
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    sendPrecallState(roomId);

    console.log(`[Room] Created: ${short(roomId)}`);
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
  socket.on('join-room', ({ roomId, participantId, token, keepPrivate } = {}) => {
    console.log(`[Room] join-room | room=${short(roomId)} | socket=${short(socket.id)}`);

    if (!ID_PATTERN.test(String(roomId || '')) || !ID_PATTERN.test(String(participantId || ''))) {
      socket.emit('room-not-found', { roomId: null });
      return;
    }

    const identity = verifyPeerToken(token);
    let denied = checkRoomAccess(roomId, token, identity);
    // Someone who is ALREADY in this room (they verified when they first joined) is coming back after a
    // refresh or a network blip: their 10-minute token may have expired or been lost. Let them back into
    // their own slot. A token for a different room is still refused.
    if ((denied === 'invalid-token' || denied === 'token-required') && holdsSlotWithIdentity(roomId, participantId)) {
      denied = null;
    }
    if (denied && roomExists(roomId)) {
      socket.emit('auth-error', { reason: denied });
      return;
    }

    // The liveness probe lets joinRoom tell a genuine reconnect (old socket
    // already gone) apart from a duplicate tab that inherited this room's
    // participantId via sessionStorage (old socket still connected).
    const result = joinRoom(
      roomId,
      participantId,
      socket.id,
      (id) => io.sockets.sockets.has(id),
      identity,
      !!keepPrivate
    );

    if (result.notFound) {
      socket.emit('room-not-found', { roomId });
      return;
    }

    if (result.duplicateSession) {
      console.log(`[Room] Rejecting duplicate session | room=${short(roomId)} | socket=${short(socket.id)}`);
      socket.emit('room-full', { roomId, reason: 'duplicate-session' });
      return;
    }

    if (result.isFull) {
      socket.emit('room-full', { roomId });
      return;
    }

    // A session that was cancelled (declined, or nobody got ready in time) cannot be joined again.
    if (isSessionCancelled(roomId)) {
      socket.emit('session:cancelled', {});
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
    const chat = getChatHistory(roomId);
    if (chat.length) {
      socket.emit('chat:history', {
        messages: chat.map((m) => ({
          id: m.id,
          text: m.text,
          at: m.at,
          mine: m.fromParticipantId === participantId,
        })),
      });
    }

    // Where things stand on the Ready screen, for both people. No video, captions or AI are paired up
    // here: that only happens once both have said Yes and clicked Ready (see 'session:media-ready').
    armPrecallTimer(roomId); // first, so the state below carries the deadline
    sendPrecallState(roomId);
    if (result.reconnected) {
      // They missed whatever was emitted to their previous (now-dead) socket while disconnected.
      sendInterviewStateTo(roomId, participantId, socket.id);
      console.log(`[Room] ${short(socket.id)} reconnected to room ${short(roomId)}`);
      return;
    }
    console.log(`[Room] ${short(socket.id)} joined room ${short(roomId)}`);
  });

  /**
   * PRECALL:CONSENT
   * "This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?"
   * A Yes is stored on the backend first (for dashboard people), so a Yes that was not saved never
   * unlocks anything. A No cancels the session for both; the partner is not told why.
   */
  socket.on('precall:consent', async ({ roomId, answer, version } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const pid = getParticipantIdForSocket(roomId, socket.id);
    if (!pid || typeof answer !== 'boolean') return;
    if (isRateLimited(socket, 'precall:consent', 500)) return;
    if (version !== SESSION_CONSENT_VERSION) {
      socket.emit('precall:error', { reason: 'outdated-wording' });
      return;
    }
    const identity = getIdentityForParticipant(roomId, pid);
    if (identity?.studentId) {
      const saved = await callBackend('/internal/peer/session-consent', {
        room_id: roomId,
        student_id: identity.studentId,
        answer,
        version,
      });
      if (!saved.ok) {
        socket.emit('precall:error', { reason: 'consent-not-saved' });
        return;
      }
    }
    const result = setSessionConsent(roomId, pid, answer);
    if (!result.ok) {
      socket.emit('precall:error', { reason: result.reason });
      return;
    }
    if (answer === false && isSessionStarted(roomId)) {
      // Someone who arrived into a session that is already running said No: only they leave.
      const { partnerId } = releaseParticipant(socket.id);
      socket.leave(roomId);
      socket.emit('session:cancelled', { self: true });
      if (partnerId) io.to(partnerId).emit('user-left', { socketId: socket.id });
      if (roomExists(roomId)) sendPrecallState(roomId);
      return;
    }
    if (answer === false) {
      const partnerSocket = getPartner(roomId, socket.id);
      clearPrecallTimer(roomId);
      cancelSession(roomId);
      socket.emit('session:cancelled', { self: true });
      if (partnerSocket) io.to(partnerSocket).emit('session:cancelled', {}); // no reason given
      return;
    }
    sendPrecallState(roomId);
  });

  /**
   * PRECALL:READY
   * Needs a Yes on file and working camera and microphone. When both people are present and ready the
   * session starts ('session:go'); only then do cameras and microphones go on. Repeat clicks change nothing.
   */
  socket.on('precall:ready', ({ roomId, devicesOk } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const pid = getParticipantIdForSocket(roomId, socket.id);
    if (!pid) return;
    if (isRateLimited(socket, 'precall:ready', 300)) return;
    const result = setReady(roomId, pid, devicesOk === true);
    if (!result.ok) {
      socket.emit('precall:error', { reason: result.reason });
      return;
    }
    if (result.justStarted) {
      clearPrecallTimer(roomId);
      for (const p of getParticipantsForRoom(roomId)) {
        if (p.socketId) io.to(p.socketId).emit('session:go', { roomId });
      }
    } else if (result.justAdmitted) {
      socket.emit('session:go', { roomId }); // joined a running session: only they get the go
    }
    sendPrecallState(roomId);
  });

  /**
   * SESSION:MEDIA-READY
   * After 'session:go' each browser turns its camera and microphone on and says so. When both have, the
   * two are paired for video (the same handshake a join used to start).
   */
  socket.on('session:media-ready', ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const pid = getParticipantIdForSocket(roomId, socket.id);
    if (!pid) return;
    const paired = setMediaReady(roomId, pid);
    if (!paired?.partner) return;
    const other = getParticipantsForRoom(roomId).find((p) => p.socketId === paired.partner);
    socket.emit('ready', {
      initiatorId: paired.partner,
      partnerDisplayName: other ? getPublicDisplayName(roomId, other.participantId) : null,
    });
    io.to(paired.partner).emit('user-joined', {
      signal: null,
      callerId: socket.id,
      partnerDisplayName: getPublicDisplayName(roomId, pid),
    });
  });

  /**
   * NO-SHOW:MARK
   * The person waiting alone says their partner did not show. The backend decides (the scheduled start
   * plus the grace window) and records who was absent.
   */
  socket.on('no-show:mark', async ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const pid = getParticipantIdForSocket(roomId, socket.id);
    const identity = pid ? getIdentityForParticipant(roomId, pid) : null;
    if (!identity?.studentId) {
      socket.emit('no-show:error', { message: 'This is only available for scheduled meetings.' });
      return;
    }
    if (isRateLimited(socket, 'no-show:mark', 3000)) return;
    if (getParticipantsForRoom(roomId).length > 1) {
      socket.emit('no-show:error', { message: 'Your partner is already here.' });
      return;
    }
    const res = await callBackend('/internal/peer/no-show', { room_id: roomId, reporter_student_id: identity.studentId });
    if (!res.ok) {
      socket.emit('no-show:error', {
        message: res.status >= 400 && res.status < 500 && res.detail ? String(res.detail).slice(0, 200) : 'Could not do that right now. Try again.',
      });
      return;
    }
    socket.emit('no-show:marked', {});
    clearPrecallTimer(roomId);
    releaseParticipant(socket.id);
    socket.leave(roomId);
  });

  /** The interviewer clicked "Got it" on the one-time message: remember it for that person, everywhere. */
  socket.on('onboarding:interviewer-dismiss', async ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    const pid = getParticipantIdForSocket(roomId, socket.id);
    const identity = pid ? getIdentityForParticipant(roomId, pid) : null;
    if (!identity?.studentId) return;
    if (isRateLimited(socket, 'onboarding:dismiss', 1000)) return;
    const res = await callBackend('/internal/peer/onboarding/seen', { student_id: identity.studentId });
    if (!res.ok) console.error('[Onboarding] could not save the seen flag');
  });

  /**
   * SIGNAL
   * Forward a WebRTC signal (SDP offer, SDP answer, or ICE candidate)
   * from the sender to the target peer.
   * The server is a dumb relay — it never inspects the signal content.
   */
  socket.on('signal', ({ signal, to } = {}) => {
    // Only relay between the two members of the sender's own room. `to` used to be forwarded to
    // any socket id or room name, which let an outsider inject signals into someone else's call.
    const senderRoom = getRoomIdForSocket(socket.id);
    if (!senderRoom || typeof to !== 'string' || getPartner(senderRoom, socket.id) !== to) return;
    // No video is exchanged until both people said Yes and clicked Ready.
    if (!isPairAdmitted(senderRoom)) return;

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
  socket.on('transcription:start', async ({ roomId, mimeType } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) {
      socket.emit('transcription:error', {
        message: 'Join a meeting room before starting transcription.',
      });
      return;
    }

    // 1s floor: a real client starts this once per mic-enable/reconnect —
    // guards against a client opening a flood of Deepgram connections.
    if (isRateLimited(socket, 'transcription:start', 1000)) return;

    // Audio goes to a third-party transcription service, so it only starts once the session has begun
    // and BOTH people said Yes (checked against the stored answers on the backend).
    if (!(await recordingAllowed(roomId)) || !socket.rooms.has(roomId)) {
      socket.emit('transcription:error', {
        message: 'Live captions are off because both people have not agreed for this session.',
      });
      return;
    }

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
    enqueueForRoom(roomId, async () => {
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:configure', 1000)) return;

    // Only the room host (whoever started the meeting) may set the interview up. Without this the
    // second person to arrive could configure first, take the interviewer role and see the AI panel.
    const host = getHostParticipantId(roomId);
    if (host && host !== myParticipantId) {
      socket.emit('interview:error', { reason: 'not-host' });
      return;
    }

    // Setup is submitted once. It is locked from the first submit, and for good once the session begins.
    const existing = getInterview(roomId);
    if (existing?.started) {
      socket.emit('interview:error', { reason: 'already-started' });
      return;
    }
    if (existing?.configured) {
      socket.emit('interview:error', { reason: 'setup-locked' });
      return;
    }

    // AI feedback processes BOTH people's speech, so it needs both of them to have said Yes.
    if (!(await recordingAllowed(roomId))) {
      socket.emit('interview:error', { reason: 'consent-required' });
      return;
    }
    // Something may have been submitted while we were checking.
    if (getInterview(roomId)?.configured) {
      socket.emit('interview:error', { reason: 'setup-locked' });
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
  });

  // ── Interview: start ─────────────────────────────────────────────────────
  socket.on('interview:start', ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    enqueueForRoom(roomId, async () => {
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    if (!myParticipantId) return;
    if (isRateLimited(socket, 'interview:start', 2000)) return;

    const existing = getInterview(roomId);
    // Only the meeting host (whoever submitted setup) may start the
    // interview — anchored on configuredBy, not roles.interviewerId, since
    // the host may have assigned themselves the candidate role.
    if (!existing?.configuredBy || existing.configuredBy !== myParticipantId) return;
    // Starting twice would reset the deadline and call the AI again; ignore repeats and a finished interview.
    if (existing.started || existing.ended) return;
    // Never start the AI without both people's stored Yes, even if configure was somehow reached.
    if (!(await recordingAllowed(roomId))) {
      socket.emit('interview:error', { reason: 'consent-required' });
      return;
    }
    if (getInterview(roomId)?.started) return;

    const interview = startInterview(roomId);
    if (!interview) return;

    for (const participantId of [interview.roles.interviewerId, interview.roles.candidateId]) {
      emitToParticipant(roomId, participantId, 'interview:started', { phase: interview.phase });
    }
    offerInterviewerOnboarding(roomId, interview.roles.interviewerId).catch(() => {});

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
    // A second click (or the other side racing) while the report is still being written must not flip twice.
    if (interview.ended || interview.ending || interview.switching) return;
    interview.switching = true;

    const outgoingCandidateId = interview.roles.candidateId;
    const interviewerId = interview.roles.interviewerId;
    const phaseAtSwitch = interview.phase;

    try {
    // Build the report from the current phase transcript BEFORE swapping.
    let report = await buildTurnReport(roomId, interview);
    if (interview.ended || interview.phase !== phaseAtSwitch) return;

    // Deliver the report to the participant who was just the candidate.
    if (outgoingCandidateId && report) {
      interview.lastTurnReport = { forParticipantId: outgoingCandidateId, report, final: false };
      emitToParticipant(roomId, outgoingCandidateId, 'interview:turn-report', {
        phase: interview.phase,
        report,
      });
      // Fire-and-forget persistence — see note in endInterviewForRoom.
      fireReportWebhook({
        roomId,
        subjectParticipantId: outgoingCandidateId,
        partnerParticipantId: interviewerId,
        role: 'candidate',
        report,
        phase: phaseAtSwitch + 1, // the dashboard counts phases from 1
        final: false,
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
    offerInterviewerOnboarding(roomId, updated.roles.interviewerId).catch(() => {});
    } finally {
      interview.switching = false;
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
   * CHAT:MESSAGE
   * A text message to the other person in the room. Relayed only to the sender's partner.
   */
  socket.on('chat:message', ({ roomId, text } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!roomId || !socket.rooms.has(roomId)) return reply({ ok: false, error: 'not-in-room' });
    // 10 messages every 5 seconds, per person: a conversation, not a flood.
    if (isChatLimited(socket)) return reply({ ok: false, error: 'slow-down' });
    const pid = getParticipantIdForSocket(roomId, socket.id);
    const message = addChatMessage(roomId, pid, text);
    if (!message) return reply({ ok: false, error: 'empty' });
    const partnerSocket = getPartner(roomId, socket.id);
    if (partnerSocket) {
      io.to(partnerSocket).emit('chat:message', {
        id: message.id,
        text: message.text,
        at: message.at,
        from: getPublicDisplayName(roomId, pid),
        mine: false,
      });
    }
    reply({ ok: true, message: { id: message.id, text: message.text, at: message.at, mine: true } });
  });

  /**
   * MEDIA-STATE
   * Tell the partner whether my microphone and camera are on, so their screen can show it.
   */
  socket.on('media-state', ({ roomId, audio, video } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    if (isRateLimited(socket, 'media-state', 100)) return;
    const partnerSocket = getPartner(roomId, socket.id);
    if (partnerSocket) {
      io.to(partnerSocket).emit('media-state', { audio: audio !== false, video: video !== false });
    }
  });

  /**
   * REPORT-USER
   * Report the other person from inside the meeting. The reporter's identity comes from their verified
   * token (never from this payload), the transcript evidence is captured here on the server, and the
   * backend works out who the partner was from the room, so the browser cannot forge any of it.
   */
  socket.on('report-user', async ({ roomId, reason, details, block } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!roomId || !socket.rooms.has(roomId)) return reply({ ok: false, error: 'not-in-room' });
    if (isRateLimited(socket, 'report-user', 10000)) return reply({ ok: false, error: 'slow-down' });
    const myParticipantId = getParticipantIdForSocket(roomId, socket.id);
    const me = getIdentityForParticipant(roomId, myParticipantId);
    if (!me?.studentId || !MIRRACLE_WEBHOOK_URL || !WEBHOOK_SECRET) {
      // Anonymous guests cannot be attributed, so there is nobody to take the report on.
      return reply({ ok: false, error: 'login-required' });
    }
    const transcript = getTranscriptHistory(roomId)
      .slice(-200)
      .map((l) => `${l.speakerParticipantId === myParticipantId ? 'Reporter' : 'Other person'}: ${String(l.text || '').slice(0, 300)}`);
    const chatLines = getChatHistory(roomId)
      .slice(-50)
      .map((m) => `Chat, ${m.fromParticipantId === myParticipantId ? 'Reporter' : 'Other person'}: ${m.text.slice(0, 300)}`);
    transcript.push(...chatLines);
    try {
      await postSigned('/internal/peer-safety/report', {
        room_id: roomId,
        reporter_student_id: me.studentId,
        reason: String(reason || '').slice(0, 60),
        details: String(details || '').slice(0, 1000),
        block: !!block,
        evidence: { transcript, captured_at: new Date().toISOString() },
      });
      reply({ ok: true });
    } catch (err) {
      console.error(`[Safety] report not delivered: ${err.message}`);
      reply({ ok: false, error: 'not-delivered' });
    }
  });

  /**
   * LEAVE-ROOM
   * The participant clicked Leave. Unlike a dropped connection (which keeps their slot so they can
   * rejoin), this frees the slot at once and tells the partner they left.
   */
  socket.on('leave-room', ({ roomId } = {}) => {
    if (!roomId || !socket.rooms.has(roomId)) return;
    transcriptionManager.stop(socket.id);
    const { partnerId } = releaseParticipant(socket.id);
    socket.leave(roomId);
    if (partnerId) io.to(partnerId).emit('user-left', { socketId: socket.id });
    if (roomExists(roomId)) {
      if (!precallNeedsTimer(roomId)) clearPrecallTimer(roomId);
      sendPrecallState(roomId);
    } else {
      clearPrecallTimer(roomId);
    }
  });

  /**
   * DISCONNECT
   * Built-in event. Clean up the room and notify partner.
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} | reason=${reason}`);

    rateLimitState.delete(socket.id);
    chatTimes.delete(socket.id);
    transcriptionManager.stop(socket.id);

    // leaveRoom() marks this participant's slot as disconnected but keeps
    // it around (see roomManager.js) so a reconnect within the room's
    // lifetime can reclaim it and its interview role — it only deletes the
    // room once EVERY participant slot is disconnected.
    const { roomId, partnerId } = leaveRoom(socket.id);

    if (partnerId) {
      console.log(`[Room] partner notified: ${short(socket.id)} left room ${short(roomId)}`);
      io.to(partnerId).emit('user-left', { socketId: socket.id });
    }
    if (roomId) {
      if (roomExists(roomId)) {
        if (!precallNeedsTimer(roomId)) clearPrecallTimer(roomId);
        sendPrecallState(roomId);
      } else {
        clearPrecallTimer(roomId);
      }
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
      console.log(`[Room] ${short(socket.id)} removed from room ${short(roomId)}`);
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
