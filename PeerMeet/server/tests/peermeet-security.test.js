/**
 * PeerMeet security + reliability tests: real HTTP, real socket.io, real roomManager.
 * Covers the Phase 1 hardening: room-bound tokens, restricted (dashboard) rooms, id validation,
 * the signal relay, host-only interview setup, and the signed, retrying report webhook.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.PEERMEET_SHARED_SECRET = 'test-shared-secret';
process.env.PEERMEET_WEBHOOK_RETRY_MS = '0,60,60';
delete process.env.PEERMEET_REQUIRE_TOKEN;
delete process.env.METERED_API_KEY;
delete process.env.DEEPGRAM_API_KEY;
delete process.env.GEMINI_API_KEY; // no AI: reports use the labelled fallback

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { io: ioc } = require(path.resolve(__dirname, '..', '..', 'client', 'node_modules', 'socket.io-client'));

const SECRET = process.env.PEERMEET_SHARED_SECRET;
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

let port;
let roomManager;
const hook = { calls: [], failFirst: 0, onboardingSeen: false };

function startHookServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hook.calls.push({ url: req.url, headers: req.headers, body });
        // Only the report endpoints are made to fail; the pre-call endpoints answer normally.
        if (hook.failFirst > 0 && /peer-reports|peer-safety/.test(req.url)) {
          hook.failFirst -= 1;
          res.writeHead(503);
          return res.end('{}');
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        // Answers the pre-call endpoints the way the backend does for two people who both said Yes.
        if (req.url.endsWith('/session-consent/check')) return res.end('{"all_yes":true,"missing":[]}');
        if (req.url.endsWith('/onboarding/status')) return res.end(JSON.stringify({ seen: hook.onboardingSeen === true }));
        res.end('{"ok":true}');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

async function startServer(hookPort) {
  process.env.MIRRACLE_WEBHOOK_URL = `http://127.0.0.1:${hookPort}`;
  const modulePath = path.resolve(__dirname, '..', 'src', 'index.js');
  require(modulePath);
  roomManager = require(path.resolve(__dirname, '..', 'src', 'roomManager.js'));
  await new Promise((r) => setTimeout(r, 150));
  for (const h of process._getActiveHandles()) {
    if (h && typeof h.address === 'function') {
      const a = h.address();
      if (a && a.port && a.port !== hookPort && a.family) {
        port = a.port;
        break;
      }
    }
  }
  if (!port) throw new Error('could not find server port');
}


/**
 * Test helper: behave like a person who says Yes, is Ready and has working devices, so tests that are
 * about something else (tokens, chat, reports) can get a live call. Pre-call tests turn this off.
 */
function enableAutoLive(s) {
  s.on('precall:state', (st) => {
    // A returning person (refresh, dropped connection) in a session that already started turns media on again.
    if (st.phase === 'live') return s.emit('session:media-ready', { roomId: st.roomId });
    if (st.phase !== 'precall' || !st.partner.present) return;
    if (st.me.consent === null) s.emit('precall:consent', { roomId: st.roomId, answer: true, version: st.consentVersion });
    else if (st.me.consent === true && !st.me.ready) s.emit('precall:ready', { roomId: st.roomId, devicesOk: true });
  });
  s.on('session:go', ({ roomId }) => s.emit('session:media-ready', { roomId }));
  return s;
}
const connect = ({ auto = true } = {}) => {
  const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  return auto ? enableAutoLive(s) : s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitConnect(s) {
  return new Promise((resolve, reject) => {
    if (s.connected) return resolve();
    s.once('connect', resolve);
    s.once('connect_error', reject);
  });
}
function waitEvent(s, ev, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}
/** true when the event does NOT arrive within ms */
function never(s, ev, ms = 400) {
  return new Promise((resolve) => {
    const h = () => resolve(false);
    s.once(ev, h);
    setTimeout(() => {
      s.off(ev, h);
      resolve(true);
    }, ms);
  });
}
const uid = () => Math.random().toString(36).slice(2, 10);

function mint(studentId, name, room, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { student_id: studentId, name, room, aud: 'peermeet', jti: uid(), iat: now, exp: now + 300, ...over };
  for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
  return jwt.sign(claims, SECRET, { algorithm: 'HS256' });
}

async function newRoom(roomId, hostPid, hostToken) {
  const A = connect();
  await waitConnect(A);
  A.emit('create-room', { roomId, participantId: hostPid, token: hostToken, keepPrivate: false });
  await waitEvent(A, 'room-created');
  return A;
}

// ── tokens and restricted rooms ──────────────────────────────────────────────
async function testTokenForAnotherRoomIsRefused() {
  const roomId = `room-${uid()}`;
  const A = connect();
  await waitConnect(A);
  const denied = waitEvent(A, 'auth-error');
  A.emit('create-room', { roomId, participantId: 'p-host-1', token: mint('s1', 'Ann', 'some-other-room') });
  const p = await denied;
  record('A token minted for a different room is refused', p.reason === 'wrong-room' && !roomManager.roomExists(roomId), JSON.stringify(p));
  A.disconnect();
}

async function testDashboardRoomRefusesAnonymousGuests() {
  const roomId = `dash-${uid()}`;
  const A = await newRoom(roomId, 'p-host-2', mint('s-a', 'Ann', roomId));
  record('A room created with a token is restricted', roomManager.isRoomRestricted(roomId) === true);

  const anon = connect();
  await waitConnect(anon);
  const d1 = waitEvent(anon, 'auth-error');
  anon.emit('join-room', { roomId, participantId: 'p-anon-2' });
  record('Anonymous guest cannot join a dashboard room', (await d1).reason === 'token-required');

  const wrong = connect();
  await waitConnect(wrong);
  const d2 = waitEvent(wrong, 'auth-error');
  wrong.emit('join-room', { roomId, participantId: 'p-wrong-2', token: mint('s-x', 'Xan', 'another-room') });
  record('A token for another room cannot join either', (await d2).reason === 'wrong-room');

  const garbage = connect();
  await waitConnect(garbage);
  const d3 = waitEvent(garbage, 'auth-error');
  garbage.emit('join-room', { roomId, participantId: 'p-garb-2', token: 'not.a.jwt' });
  record('A garbage token is refused as invalid', (await d3).reason === 'invalid-token');

  const noRoomClaim = connect();
  await waitConnect(noRoomClaim);
  const d4 = waitEvent(noRoomClaim, 'auth-error');
  noRoomClaim.emit('join-room', { roomId, participantId: 'p-old-2', token: mint('s-o', 'Old', undefined) });
  record('An old-style token with no room claim is refused', (await d4).reason === 'invalid-token');

  const noExp = connect();
  await waitConnect(noExp);
  const d5 = waitEvent(noExp, 'auth-error');
  noExp.emit('join-room', { roomId, participantId: 'p-noexp-2', token: mint('s-n', 'NoExp', roomId, { exp: undefined }) });
  record('A token that never expires is refused', (await d5).reason === 'invalid-token');

  const noAud = connect();
  await waitConnect(noAud);
  const d6 = waitEvent(noAud, 'auth-error');
  noAud.emit('join-room', { roomId, participantId: 'p-noaud-2', token: mint('s-u', 'NoAud', roomId, { aud: undefined }) });
  record('A token with the wrong audience is refused', (await d6).reason === 'invalid-token');

  const good = connect();
  await waitConnect(good);
  const ready = waitEvent(good, 'ready');
  good.emit('join-room', { roomId, participantId: 'p-good-2', token: mint('s-b', 'Bea', roomId) });
  record('The right person with the right token joins', Boolean((await ready).initiatorId));
  record('Refused sockets never took a slot', roomManager.getRoomSize(roomId) === 2);

  [A, anon, wrong, garbage, noRoomClaim, noExp, noAud, good].forEach((s) => s.disconnect());
  await sleep(80);
}

async function testReturningParticipantsAreNotLockedOut() {
  const roomId = `back-${uid()}`;
  const A = await newRoom(roomId, 'p-back-a', mint('s-a', 'Ann', roomId));
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-back-b', token: mint('s-b', 'Bob', roomId) });
  await ready;

  // B drops, then returns with an EXPIRED token (their 10 minutes ran out during the call)
  B.disconnect();
  await sleep(200);
  const expired = mint('s-b', 'Bob', roomId, { iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 1800 });
  const B2 = connect();
  await waitConnect(B2);
  const ready2 = waitEvent(B2, 'ready');
  B2.emit('join-room', { roomId, participantId: 'p-back-b', token: expired });
  record('A returning participant with an expired token gets back in', Boolean((await ready2).initiatorId));
  record('...and keeps the identity they verified earlier', roomManager.getIdentityForParticipant(roomId, 'p-back-b')?.studentId === 's-b');

  // and with no token at all (page refresh lost it)
  B2.disconnect();
  await sleep(200);
  const B3 = connect();
  await waitConnect(B3);
  const ready3 = waitEvent(B3, 'ready');
  B3.emit('join-room', { roomId, participantId: 'p-back-b' });
  record('...also after a refresh that lost the token', Boolean((await ready3).initiatorId));

  // but a stranger using the same expired token and a different participant id is still refused
  const stranger = connect();
  await waitConnect(stranger);
  const d = waitEvent(stranger, 'auth-error');
  stranger.emit('join-room', { roomId, participantId: 'p-stranger', token: expired });
  record('A stranger with an expired token is still refused', (await d).reason === 'invalid-token');
  const wrongRoom = connect();
  await waitConnect(wrongRoom);
  const d2 = waitEvent(wrongRoom, 'auth-error');
  wrongRoom.emit('join-room', { roomId, participantId: 'p-back-b', token: mint('s-b', 'Bob', 'other-room-1') });
  record('Even a returning participant cannot present a token for another room', (await d2).reason === 'wrong-room');

  [A, B3, stranger, wrongRoom].forEach((x) => x.disconnect());
  await sleep(80);
}

async function testIdsAreValidated() {
  const A = connect();
  await waitConnect(A);
  for (const [roomId, pid] of [
    ['has space', 'p-valid-3'],
    ['../../etc', 'p-valid-3'],
    ['room-ok-3', 'x'.repeat(200)],
    ['room-ok-3', 'ab'],
    ['ab', 'p-valid-3'],
  ]) {
    const nf = waitEvent(A, 'room-not-found');
    A.emit('create-room', { roomId, participantId: pid });
    await nf;
  }
  record('Malformed room or participant ids are refused', !roomManager.roomExists('has space') && !roomManager.roomExists('room-ok-3'));
  A.disconnect();
}

// ── signal relay ─────────────────────────────────────────────────────────────
async function testSignalRelayStaysInsideTheRoom() {
  const roomId = `sig-${uid()}`;
  const A = await newRoom(roomId, 'p-sig-a', null);
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-sig-b' });
  await ready;
  const outsider = connect();
  await waitConnect(outsider);

  const toA = waitEvent(A, 'return-signal');
  B.emit('signal', { signal: { type: 'offer', sdp: 'x' }, to: A.id });
  record('A member can signal their partner', (await toA).from === B.id);

  const leak = never(A, 'return-signal');
  outsider.emit('signal', { signal: { type: 'offer' }, to: A.id });
  record('An outsider cannot inject a signal into a call', await leak);

  const stray = never(outsider, 'return-signal');
  A.emit('signal', { signal: { type: 'offer' }, to: outsider.id });
  record('A member cannot signal a socket outside the room', await stray);

  const roomName = never(A, 'return-signal');
  outsider.emit('signal', { signal: { type: 'offer' }, to: roomId });
  record('Signalling a room name is ignored', await roomName);

  [A, B, outsider].forEach((s) => s.disconnect());
  await sleep(80);
}

// ── interview setup is host-only ─────────────────────────────────────────────
async function testOnlyTheHostConfiguresTheInterview() {
  const roomId = `host-${uid()}`;
  const A = await newRoom(roomId, 'p-host-a', null);
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-host-b' });
  await ready;

  const hijack = never(A, 'interview:role', 500);
  B.emit('interview:configure', { roomId, config: { domain: 'X', whoStarts: 'interviewer' } });
  record('The second person cannot set up the interview or take the interviewer role', await hijack);
  record('No interview state was created by the guest', !roomManager.getInterview(roomId)?.configured);

  const roleA = waitEvent(A, 'interview:role');
  const roleB = waitEvent(B, 'interview:role');
  A.emit('interview:configure', { roomId, config: { domain: 'SQL', whoStarts: 'interviewer', durationMinutes: 10 } });
  const [ra, rb] = [await roleA, await roleB];
  record('The host can set it up and both are told their roles', ra.role === 'interviewer' && rb.role === 'candidate');

  const started = waitEvent(A, 'interview:started');
  A.emit('interview:start', { roomId });
  await started;
  const deadline1 = roomManager.getInterview(roomId).deadline;
  await sleep(2200); // past the per-event rate limit, so only the "already started" guard can stop it
  A.emit('interview:start', { roomId });
  await sleep(300);
  record('Starting twice does not reset the interview', roomManager.getInterview(roomId).deadline === deadline1);

  [A, B].forEach((s) => s.disconnect());
  await sleep(80);
}

// ── chat and media state ─────────────────────────────────────────────────────
async function testChatStaysBetweenThePair() {
  const roomId = `chat-${uid()}`;
  const A = connect();
  await waitConnect(A);
  A.emit('create-room', { roomId, participantId: 'p-ch-a', keepPrivate: true });
  await waitEvent(A, 'room-created');
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-ch-b' });
  await ready;
  const outsider = connect();
  await waitConnect(outsider);

  const gotB = waitEvent(B, 'chat:message');
  const ackA = await emitAck(A, 'chat:message', { roomId, text: '  <img src=x onerror=alert(1)> hello \u0000  ' });
  const msg = await gotB;
  record('A message reaches the partner, trimmed, as plain text', ackA.ok === true && msg.text === '<img src=x onerror=alert(1)> hello' && msg.mine === false);
  record('The sender is shown by their public name (anonymous stays anonymous)', msg.from === 'Anonymous Candidate');

  const leak = never(outsider, 'chat:message');
  const sneaky = await emitAck(outsider, 'chat:message', { roomId, text: 'hi' });
  record('An outsider cannot post into the room', sneaky.ok === false && sneaky.error === 'not-in-room' && (await leak));

  const empty = await emitAck(A, 'chat:message', { roomId, text: '   ' });
  record('An empty message is refused', empty.ok === false && empty.error === 'empty');
  const long = await emitAck(A, 'chat:message', { roomId, text: 'x'.repeat(5000) });
  record('A very long message is cut to 500 characters', long.ok === true && long.message.text.length === 500);

  // rate limit: 10 per 5 seconds
  let limited = 0;
  for (let i = 0; i < 15; i++) {
    const r = await emitAck(A, 'chat:message', { roomId, text: `m${i}` });
    if (r.error === 'slow-down') limited += 1;
  }
  record('Flooding the chat is slowed down', limited >= 1, `limited=${limited}`);

  // history is replayed to someone who reconnects, with "mine" resolved for THEM
  B.disconnect();
  await sleep(200);
  const B2 = connect();
  await waitConnect(B2);
  const hist = waitEvent(B2, 'chat:history');
  B2.emit('join-room', { roomId, participantId: 'p-ch-b' });
  const h = await hist;
  record('A reconnecting person gets the chat back', h.messages.length >= 2 && h.messages[0].text.startsWith('<img') && h.messages.every((m) => m.mine === false));

  // media state goes to the partner only
  const state = waitEvent(A, 'media-state');
  B2.emit('media-state', { roomId, audio: false, video: true });
  const st = await state;
  record('Mic and camera state reach the partner', st.audio === false && st.video === true);
  const none = never(outsider, 'media-state');
  outsider.emit('media-state', { roomId, audio: false });
  record('...and nobody else', await none);

  [A, B2, outsider].forEach((x) => x.disconnect());
  await sleep(80);
}

// ── reporting from inside the meeting ────────────────────────────────────────
function emitAck(socket, event, payload, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), ms);
    socket.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

async function testInMeetingReport() {
  hook.calls = [];
  hook.failFirst = 0;
  const roomId = `rep-${uid()}`;
  const A = await newRoom(roomId, 'p-rep-a', mint('student-A', 'Ann', roomId));
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-rep-b', token: mint('student-B', 'Bob', roomId) });
  await ready;
  for (let i = 0; i < 250; i++) {
    roomManager.appendTranscriptHistory(roomId, {
      id: `l${i}`, speakerId: 's', speakerParticipantId: i % 2 ? 'p-rep-a' : 'p-rep-b', text: `line ${i}`, timestamp: i,
    });
  }

  roomManager.addChatMessage(roomId, 'p-rep-a', 'a chat line in the evidence');
  // B reports. B tries to pose as someone else in the payload: it must be ignored.
  const res = await emitAck(B, 'report-user', {
    roomId, reason: 'harassment', details: 'rude', block: true, reporter_student_id: 'student-A', reporterStudentId: 'student-A',
  });
  record('A signed-in participant can report from the meeting', res.ok === true, JSON.stringify(res));
  const call = hook.calls.find((c) => c.url === '/internal/peer-safety/report');
  const payload = call && JSON.parse(call.body);
  record('The report goes to the safety endpoint, signed', Boolean(call && call.headers['x-peer-signature'] && call.headers['x-peer-timestamp']));
  record('The reporter comes from the verified token, not the browser payload', payload && payload.reporter_student_id === 'student-B');
  record('Block and reason are passed along', payload && payload.block === true && payload.reason === 'harassment');
  const spoken = payload ? payload.evidence.transcript.filter((l) => !l.startsWith('Chat,')) : [];
  const chat = payload ? payload.evidence.transcript.filter((l) => l.startsWith('Chat,')) : [];
  record('Evidence is the last 200 transcript lines captured on the server', spoken.length === 200 && spoken[199].endsWith('line 249'));
  record('Chat messages are part of the evidence', chat.length === 1 && chat[0] === 'Chat, Other person: a chat line in the evidence');
  record('Evidence labels who said what without names', payload && /^(Reporter|Other person): /.test(payload.evidence.transcript[0]) && !payload.evidence.transcript.join('').includes('Ann') && !payload.evidence.transcript.join('').includes('Bob'));

  // a second report within 10s is slowed down
  const again = await emitAck(B, 'report-user', { roomId, reason: 'spam' });
  record('Report spam from one socket is rate limited', again.ok === false && again.error === 'slow-down');

  // someone outside the room cannot report into it
  const outsider = connect();
  await waitConnect(outsider);
  const out = await emitAck(outsider, 'report-user', { roomId, reason: 'spam' });
  record('An outsider cannot file a report for a room', out.ok === false && out.error === 'not-in-room');

  // an anonymous guest in an open room cannot be attributed
  const openRoom = `open-${uid()}`;
  const G1 = await newRoom(openRoom, 'p-g1', null);
  const G2 = connect();
  await waitConnect(G2);
  const r2 = waitEvent(G2, 'ready');
  G2.emit('join-room', { roomId: openRoom, participantId: 'p-g2' });
  await r2;
  const anon = await emitAck(G2, 'report-user', { roomId: openRoom, reason: 'spam' });
  record('An anonymous guest is told to use the dashboard to report', anon.ok === false && anon.error === 'login-required');

  [A, B, outsider, G1, G2].forEach((x) => x.disconnect());
  await sleep(80);
}

// ── leaving ──────────────────────────────────────────────────────────────────
async function testLeavingFreesTheSlotButDroppingDoesNot() {
  const roomId = `leave-${uid()}`;
  const A = await newRoom(roomId, 'p-lv-a', null);
  const B = connect();
  await waitConnect(B);
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-lv-b' });
  await ready;

  // B drops (no leave-room): the slot stays reserved, a stranger gets "room full".
  B.disconnect();
  await sleep(200);
  const C = connect();
  await waitConnect(C);
  const full = waitEvent(C, 'room-full');
  C.emit('join-room', { roomId, participantId: 'p-lv-c' });
  await full;
  record('A dropped connection keeps the slot (so a rejoin works)', roomManager.getRoomSize(roomId) === 2);

  // B comes back and then deliberately LEAVES: the partner is told and the slot is freed.
  const B2 = connect();
  await waitConnect(B2);
  const ready2 = waitEvent(B2, 'ready');
  B2.emit('join-room', { roomId, participantId: 'p-lv-b' });
  await ready2;
  const left = waitEvent(A, 'user-left');
  B2.emit('leave-room', { roomId });
  await left;
  record('The partner is told when someone leaves on purpose', true);
  await sleep(100);
  record('Leaving frees the slot', roomManager.getRoomSize(roomId) === 1);

  const D = connect();
  await waitConnect(D);
  const readyD = waitEvent(D, 'ready');
  D.emit('join-room', { roomId, participantId: 'p-lv-d' });
  record('A new person can take the freed slot', Boolean((await readyD).initiatorId));

  [A, B2, C, D].forEach((x) => x.disconnect());
  await sleep(80);
}

// ── the report webhook ───────────────────────────────────────────────────────
async function runInterview({ roomId, tokenA, tokenB, aPrivate, bPrivate }) {
  const A = connect();
  const B = connect();
  await waitConnect(A);
  await waitConnect(B);
  A.emit('create-room', { roomId, participantId: 'p-wh-a', token: tokenA, keepPrivate: aPrivate });
  await waitEvent(A, 'room-created');
  const ready = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-wh-b', token: tokenB, keepPrivate: bPrivate });
  await ready;
  const roleA = waitEvent(A, 'interview:role');
  A.emit('interview:configure', { roomId, config: { domain: 'SQL', whoStarts: 'interviewer', durationMinutes: 10 } });
  await roleA;
  const started = waitEvent(A, 'interview:started');
  A.emit('interview:start', { roomId });
  await started;
  // The candidate (B) said enough to be judged, so the report goes down the normal path rather than "too short".
  roomManager.appendTranscriptLine(roomId, {
    speakerId: 'p-wh-b',
    text: 'I would add an index on the join column and then check the query plan to confirm the planner uses it, because a full scan gets slower as the table grows.',
  });
  return { A, B };
}

/** Only the report deliveries (the pre-call calls to the same stub are not what these tests are about). */
const reportCalls = () => hook.calls.filter((c) => /peer-reports/.test(c.url));
async function waitForHook(n, ms = 4000) {
  const end = Date.now() + ms;
  while (reportCalls().length < n && Date.now() < end) await sleep(40);
}

async function testWebhookIsSignedAndRetried() {
  hook.calls = [];
  hook.failFirst = 1; // first delivery gets a 503, the retry succeeds
  const roomId = `wh-${uid()}`;
  const { A, B } = await runInterview({
    roomId,
    tokenA: mint('student-A', 'Ann', roomId),
    tokenB: mint('student-B', 'Bob', roomId),
    aPrivate: false,
    bPrivate: true,
  });
  // A is the interviewer, B the candidate. A ends the interview; B's report is posted about B.
  A.emit('interview:end', { roomId });
  await waitForHook(2);

  record('A failed delivery (503) is retried', reportCalls().length === 2, `calls=${reportCalls().length}`);
  const last = reportCalls()[reportCalls().length - 1];
  const payload = JSON.parse(last.body);
  record('Report payload names the candidate, partner, phase and that it is final', payload.student_id === 'student-B' && payload.partner_student_id === 'student-A' && payload.phase === 1 && payload.final === true && payload.role === 'candidate', JSON.stringify({ ...payload, report: undefined }));
  record('Fallback report is flagged unavailable', payload.unavailable === true);
  record('Partner privacy is passed along (the interviewer chose to be visible)', payload.partner_private === false);

  const ts = last.headers['x-peer-timestamp'];
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${last.body}`).digest('hex');
  record('The body is signed with the timestamp', last.headers['x-peer-signature'] === expected);
  record('Bearer secret is sent too', last.headers.authorization === `Bearer ${SECRET}`);

  [A, B].forEach((s) => s.disconnect());
  await sleep(80);
}

async function testSwitchRolesReportIsNotFinalAndOnlyOnce() {
  hook.calls = [];
  hook.failFirst = 0;
  const roomId = `sw-${uid()}`;
  const { A, B } = await runInterview({
    roomId,
    tokenA: mint('student-A', 'Ann', roomId),
    tokenB: mint('student-B', 'Bob', roomId),
    aPrivate: true,
    bPrivate: false,
  });
  const switched = waitEvent(A, 'interview:roles-switched');
  A.emit('interview:switch-roles', { roomId });
  await switched;
  await waitForHook(1);
  await sleep(200);
  const payload = JSON.parse(reportCalls()[0].body);
  record('A role-switch report is phase 1 and NOT final', payload.phase === 1 && payload.final === false);
  record('Exactly one report is sent for the switch', reportCalls().length === 1, `calls=${reportCalls().length}`);
  record('Roles really switched and the phase advanced', roomManager.getInterview(roomId).phase === 1);
  record('The partner who asked for privacy is marked private', payload.partner_private === true);

  [A, B].forEach((s) => s.disconnect());
  await sleep(80);
}

(async () => {
  let hookServer;
  try {
    const hookPort = await startHookServer();
    await startServer(hookPort);
    console.log(`\n=== PeerMeet security tests — server on port ${port} ===\n`);
    await testTokenForAnotherRoomIsRefused();
    await testDashboardRoomRefusesAnonymousGuests();
    await testReturningParticipantsAreNotLockedOut();
    await testIdsAreValidated();
    await testSignalRelayStaysInsideTheRoom();
    await testOnlyTheHostConfiguresTheInterview();
    await testLeavingFreesTheSlotButDroppingDoesNot();
    await testChatStaysBetweenThePair();
    await testInMeetingReport();
    await testWebhookIsSignedAndRetried();
    await testSwitchRolesReportIsNotFinalAndOnlyOnce();
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log(`\n=== ${passed}/${results.length} passed, ${failed} failed ===`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('Test harness error:', err);
    process.exit(1);
  } finally {
    if (hookServer) hookServer.close();
  }
})();
