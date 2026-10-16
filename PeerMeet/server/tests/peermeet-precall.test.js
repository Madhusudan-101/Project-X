/**
 * PeerMeet pre-call tests: real HTTP, real socket.io, real roomManager, a stub standing in for the backend.
 * Covers the Ready screen and everything it gates: nothing is paired (no video, no captions, no AI) until
 * both people said Yes and clicked Ready; a No cancels without a reason; timeouts; leaving and refreshing;
 * the partner card; consent stored on the backend before it counts; the setup lock; the one-time interviewer
 * message; the "partner did not show" button; and an honest "too short to judge" report.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.PEERMEET_SHARED_SECRET = 'test-shared-secret';
process.env.PEERMEET_WEBHOOK_RETRY_MS = '0';
process.env.PEERMEET_PRECALL_TIMEOUT_MS = '1500';
delete process.env.PEERMEET_REQUIRE_TOKEN;
delete process.env.METERED_API_KEY;
delete process.env.DEEPGRAM_API_KEY;
delete process.env.GEMINI_API_KEY;

const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { io: ioc } = require(path.resolve(__dirname, '..', '..', 'client', 'node_modules', 'socket.io-client'));

const SECRET = process.env.PEERMEET_SHARED_SECRET;
const VERSION = '2026-10-session-v1';
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

let port;
let roomManager;
// What the backend stub does. Tests change `respond` per path suffix.
const backend = { calls: [], respond: {} };

function startBackendStub() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        backend.calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
        const key = Object.keys(backend.respond).find((k) => req.url.endsWith(k));
        const r = key ? backend.respond[key] : null;
        const status = r?.status ?? 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        if (r?.body !== undefined) return res.end(JSON.stringify(r.body));
        if (req.url.endsWith('/session-consent/check')) return res.end('{"all_yes":true,"missing":[]}');
        if (req.url.endsWith('/onboarding/status')) return res.end('{"seen":false}');
        res.end('{"ok":true}');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}
const callsTo = (suffix) => backend.calls.filter((c) => c.url.endsWith(suffix));

async function startServer(stubPort) {
  process.env.MIRRACLE_WEBHOOK_URL = `http://127.0.0.1:${stubPort}`;
  const modulePath = path.resolve(__dirname, '..', 'src', 'index.js');
  require(modulePath);
  roomManager = require(path.resolve(__dirname, '..', 'src', 'roomManager.js'));
  await new Promise((r) => setTimeout(r, 150));
  for (const h of process._getActiveHandles()) {
    if (h && typeof h.address === 'function') {
      const a = h.address();
      if (a && a.port && a.port !== stubPort && a.family) {
        port = a.port;
        break;
      }
    }
  }
  if (!port) throw new Error('could not find server port');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const sockets = [];

function connect() {
  const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.events = [];
  s.last = null;
  for (const ev of ['precall:state', 'precall:error', 'session:go', 'session:cancelled', 'ready', 'user-joined', 'return-signal',
    'interview:error', 'interview:role', 'interview:started', 'interview:turn-report', 'onboarding:interviewer',
    'no-show:marked', 'no-show:error', 'transcription:error', 'transcription:started', 'user-left']) {
    s.on(ev, (payload) => {
      s.events.push({ ev, payload });
      if (ev === 'precall:state') s.last = payload;
    });
  }
  sockets.push(s);
  return s;
}
const count = (s, ev) => s.events.filter((e) => e.ev === ev).length;
const lastOf = (s, ev) => [...s.events].reverse().find((e) => e.ev === ev)?.payload;
async function until(fn, ms = 3000, label = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}
const quiet = async (fn, ms = 350) => {
  await sleep(ms);
  return fn();
};
async function open(s) {
  if (!s.connected) await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
}

function mint(studentId, name, room, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ student_id: studentId, name, room, aud: 'peermeet', jti: uid(), iat: now, exp: now + 300, ...extra }, SECRET, { algorithm: 'HS256' });
}

/** Two people in a room. Anonymous by default; pass tokens to make them dashboard people. */
async function pair({ tokenA, tokenB, privA = false, privB = false } = {}) {
  const roomId = `pre-${uid()}`;
  const pidA = `pa-${uid()}`;
  const pidB = `pb-${uid()}`;
  const A = connect();
  const B = connect();
  await open(A);
  await open(B);
  A.emit('create-room', { roomId, participantId: pidA, token: tokenA ? tokenA(roomId) : undefined, keepPrivate: privA });
  await until(() => count(A, 'precall:state') >= 1, 3000, 'room created');
  B.emit('join-room', { roomId, participantId: pidB, token: tokenB ? tokenB(roomId) : undefined, keepPrivate: privB });
  await until(() => B.last?.partner?.present && A.last?.partner?.present, 3000, 'both present');
  return { roomId, A, B, pidB };
}
const yes = (s, roomId) => s.emit('precall:consent', { roomId, answer: true, version: VERSION });
const ready = (s, roomId, devicesOk = true) => s.emit('precall:ready', { roomId, devicesOk });

async function goLive({ roomId, A, B }) {
  yes(A, roomId); yes(B, roomId);
  await until(() => A.last?.me.consent === true && B.last?.me.consent === true, 3000, 'consents');
  ready(A, roomId); ready(B, roomId);
  await until(() => count(A, 'session:go') && count(B, 'session:go'), 3000, 'session:go');
  A.emit('session:media-ready', { roomId });
  B.emit('session:media-ready', { roomId });
  await until(() => count(A, 'user-joined') && count(B, 'ready'), 3000, 'paired');
}

// ── nothing is sent between people until both are ready ──────────────────────
async function testNothingFlowsUntilBothReady() {
  const { roomId, A, B } = await pair();
  record('Both people see the Ready screen first (phase precall)', A.last.phase === 'precall' && B.last.phase === 'precall');
  record('No video pairing on join', count(A, 'user-joined') === 0 && count(B, 'ready') === 0);

  B.emit('signal', { signal: { type: 'offer', sdp: 'x' }, to: A.id });
  record('Video signals are not relayed before both are ready', await quiet(() => count(A, 'return-signal') === 0));

  yes(A, roomId);
  ready(A, roomId);
  await until(() => B.last.partner.ready === true, 3000, 'partner ready shown');
  record('One person ready does not start anything', (await quiet(() => count(A, 'session:go') === 0 && count(B, 'session:go') === 0)));
  record('The partner can see you are ready', B.last.partner.ready === true && A.last.me.ready === true);

  yes(B, roomId);
  await until(() => B.last.me.consent === true, 3000, 'B consent');
  ready(B, roomId);
  await until(() => count(A, 'session:go') && count(B, 'session:go'), 3000, 'go');
  record('Both ready: the session starts for both', A.last.phase === 'live' && B.last.phase === 'live' && roomManager.isSessionStarted(roomId));
  record('Still no video until both browsers have their camera on', count(B, 'ready') === 0);

  A.emit('session:media-ready', { roomId });
  await quiet(() => null, 150);
  record('One camera on is not enough to pair', count(B, 'ready') === 0 && count(A, 'user-joined') === 0);
  B.emit('session:media-ready', { roomId });
  await until(() => count(B, 'ready') && count(A, 'user-joined'), 3000, 'paired');
  record('Once both cameras are on, they are paired', Boolean(lastOf(B, 'ready').initiatorId));
  const sig = new Promise((res) => A.once('return-signal', res));
  B.emit('signal', { signal: { type: 'offer', sdp: 'x' }, to: A.id });
  record('Signals flow after the session started', Boolean(await Promise.race([sig, sleep(1500).then(() => null)])));
  [A, B].forEach((s) => s.disconnect());
}

async function testReadyNeedsYesAndWorkingDevices() {
  const { roomId, A, B } = await pair();
  ready(A, roomId);
  await until(() => count(A, 'precall:error') === 1, 2000, 'error');
  record('Ready without a Yes is refused', lastOf(A, 'precall:error').reason === 'consent-required' && A.last.me.ready === false);
  yes(A, roomId);
  await until(() => A.last.me.consent === true, 2000, 'consent');
  await sleep(350);
  ready(A, roomId, false);
  await until(() => count(A, 'precall:error') === 2, 2000, 'device error');
  record('Ready with a broken camera or microphone is refused', lastOf(A, 'precall:error').reason === 'devices-not-ready' && A.last.me.ready === false);
  [A, B].forEach((s) => s.disconnect());
}

async function testDoubleClickOnReadyIsHarmless() {
  const { roomId, A, B } = await pair();
  yes(A, roomId); yes(B, roomId);
  await until(() => A.last.me.consent && B.last.me.consent, 2000, 'consents');
  for (let i = 0; i < 4; i += 1) { ready(A, roomId); ready(B, roomId); await sleep(320); }
  await until(() => count(A, 'session:go') >= 1, 2000, 'go');
  await sleep(300);
  record('Clicking Ready many times starts the session once', count(A, 'session:go') === 1 && count(B, 'session:go') === 1);
  [A, B].forEach((s) => s.disconnect());
}

// ── consent ──────────────────────────────────────────────────────────────────
async function testANoCancelsWithoutAReason() {
  const { roomId, A, B, pidB } = await pair();
  A.emit('precall:consent', { roomId, answer: false, version: VERSION });
  await until(() => count(A, 'session:cancelled') && count(B, 'session:cancelled'), 3000, 'cancelled');
  record('The person who said No is told it is cancelled', lastOf(A, 'session:cancelled').self === true);
  record('The partner is told the session was cancelled and given NO reason', JSON.stringify(lastOf(B, 'session:cancelled')) === '{}');
  yes(B, roomId);
  ready(B, roomId);
  await sleep(400);
  record('Nobody can carry on in a cancelled session', count(B, 'session:go') === 0 && !roomManager.isSessionStarted(roomId));
  B.disconnect();
  await sleep(200);
  const C = connect();
  await open(C);
  C.emit('join-room', { roomId, participantId: pidB }); // the partner comes back after the cancel
  await until(() => count(C, 'session:cancelled'), 2000, 'late join');
  record('A cancelled session cannot be re-entered', count(C, 'session:cancelled') === 1 && count(C, 'precall:state') === 0);
  [A, B, C].forEach((s) => s.disconnect());
}

async function testOnlyANewestWordingCounts() {
  const { roomId, A, B } = await pair();
  A.emit('precall:consent', { roomId, answer: true, version: 'old-wording' });
  await until(() => count(A, 'precall:error') === 1, 2000, 'error');
  record('A Yes to old wording is refused', lastOf(A, 'precall:error').reason === 'outdated-wording' && A.last.me.consent === null);
  [A, B].forEach((s) => s.disconnect());
}

async function testYesIsStoredOnTheBackendFirst() {
  backend.calls = [];
  backend.respond = {};
  const { roomId, A, B } = await pair({
    tokenA: (r) => mint('stu-a', 'Ann Archer', r),
    tokenB: (r) => mint('stu-b', 'Bob Brown', r),
  });
  yes(A, roomId);
  await until(() => A.last.me.consent === true, 3000, 'consent');
  const saved = callsTo('/session-consent')[0]?.body;
  record('A Yes is stored on the backend with person, session, answer and wording version',
    saved && saved.student_id === 'stu-a' && saved.room_id === roomId && saved.answer === true && saved.version === VERSION, JSON.stringify(saved));

  backend.respond['/session-consent'] = { status: 500, body: { detail: 'down' } };
  await sleep(550);
  yes(B, roomId);
  await until(() => count(B, 'precall:error') === 1, 3000, 'not saved');
  record('A Yes that could not be saved does NOT count', lastOf(B, 'precall:error').reason === 'consent-not-saved' && B.last.me.consent === null);
  ready(B, roomId);
  await until(() => count(B, 'precall:error') === 2, 2000, 'ready refused');
  record('...so Ready stays refused', lastOf(B, 'precall:error').reason === 'consent-required');
  backend.respond = {};
  [A, B].forEach((s) => s.disconnect());
}

async function testRecordingNeedsTheBackendsStoredYesForBoth() {
  backend.calls = [];
  backend.respond = {};
  const both = {
    tokenA: (r) => mint('stu-a', 'Ann', r),
    tokenB: (r) => mint('stu-b', 'Bob', r),
  };
  const room = await pair(both);
  const { roomId, A, B } = room;
  A.emit('transcription:start', { roomId, mimeType: 'audio/webm' });
  await until(() => count(A, 'transcription:error') === 1, 2000, 'early start');
  record('Captions cannot start on the Ready screen', /not agreed/.test(lastOf(A, 'transcription:error').message));
  A.emit('interview:configure', { roomId, config: { domain: 'SQL', whoStarts: 'interviewer' } });
  await until(() => count(A, 'interview:error') === 1, 2000, 'early configure');
  record('The AI interview cannot be set up on the Ready screen', lastOf(A, 'interview:error').reason === 'consent-required' && !roomManager.getInterview(roomId)?.configured);

  backend.respond['/session-consent/check'] = { body: { all_yes: false, missing: ['stu-b'] } };
  await goLive(room);
  await sleep(1100);
  A.emit('transcription:start', { roomId, mimeType: 'audio/webm' });
  await until(() => count(A, 'transcription:error') === 2, 2000, 'backend says no');
  record('If the backend has no stored Yes for both, captions stay off', /not agreed/.test(lastOf(A, 'transcription:error').message));
  A.emit('interview:configure', { roomId, config: { domain: 'SQL', whoStarts: 'interviewer' } });
  await until(() => count(A, 'interview:error') === 2, 2000, 'backend says no (AI)');
  record('...and the AI interview cannot be set up', lastOf(A, 'interview:error').reason === 'consent-required' && !roomManager.getInterview(roomId)?.configured);
  const asked = callsTo('/session-consent/check').at(-1)?.body;
  record('The backend is asked about exactly these two people and this session', asked && asked.room_id === roomId && asked.student_ids.sort().join() === 'stu-a,stu-b', JSON.stringify(asked));

  backend.respond = {};
  await sleep(1100);
  A.emit('transcription:start', { roomId, mimeType: 'audio/webm' });
  await sleep(500);
  const late = A.events.filter((e) => e.ev === 'transcription:error').pop();
  record('With a stored Yes for both, captions are allowed past the consent gate', count(A, 'transcription:error') === 2 || !/not agreed/.test(late.payload.message), late?.payload.message);
  [A, B].forEach((s) => s.disconnect());
}

// ── timeout, leaving, refreshing ─────────────────────────────────────────────
async function testSomeoneWhoNeverClicksReadyEndsItWithAClearReason() {
  const { roomId, A, B } = await pair();
  record('The Ready screen carries a deadline', typeof A.last.deadlineAt === 'number' && A.last.deadlineAt > Date.now());
  yes(A, roomId);
  await until(() => A.last.me.consent === true, 2000, 'consent');
  ready(A, roomId);
  await until(() => count(A, 'session:cancelled') && count(B, 'session:cancelled'), 4000, 'timeout');
  record('Both are told it timed out', lastOf(A, 'session:cancelled').reason === 'timeout' && lastOf(B, 'session:cancelled').reason === 'timeout');
  record('Nothing started', count(A, 'session:go') === 0 && !roomManager.isSessionStarted(roomId));
  [A, B].forEach((s) => s.disconnect());
}

async function testPartnerLeavesOnTheReadyScreen() {
  const { roomId, A, B } = await pair();
  yes(B, roomId);
  await until(() => B.last.me.consent, 2000, 'consent');
  await sleep(350);
  ready(B, roomId);
  await until(() => A.last.partner.ready === true, 2000, 'partner ready');
  B.emit('leave-room', { roomId });
  await until(() => A.last.partner.present === false, 2000, 'partner left');
  record('The other person sees that their partner left', A.last.partner.present === false && A.last.partner.ready === false);
  record('The deadline stops while alone', A.last.deadlineAt === null);
  const B2 = connect();
  await open(B2);
  B2.emit('join-room', { roomId, participantId: 'pb-new' });
  await until(() => A.last.partner.present === true, 2000, 'new partner');
  record('Someone new can take the place', A.last.partner.present === true && A.last.partner.ready === false);
  [A, B, B2].forEach((s) => s.disconnect());
}

async function testRefreshKeepsYesButNotReady() {
  const roomId = `pre-${uid()}`;
  const A = connect();
  await open(A);
  A.emit('create-room', { roomId, participantId: 'pa-ref' });
  const B = connect();
  await open(B);
  await until(() => A.last, 2000, 'room');
  B.emit('join-room', { roomId, participantId: 'pb-ref' });
  await until(() => B.last?.partner?.present, 2000, 'present');
  yes(B, roomId);
  await until(() => B.last.me.consent, 2000, 'consent');
  await sleep(350);
  ready(B, roomId);
  await until(() => B.last.me.ready, 2000, 'ready');
  B.disconnect();
  await until(() => A.last.partner.present === false, 2000, 'dropped');
  const B2 = connect();
  await open(B2);
  B2.emit('join-room', { roomId, participantId: 'pb-ref' });
  await until(() => B2.last, 2000, 'back');
  record('After a refresh the Yes is remembered', B2.last.me.consent === true);
  record('...but they must check their devices and click Ready again', B2.last.me.ready === false && A.last.partner.ready === false);
  record('Still on the Ready screen, not live', B2.last.phase === 'precall');
  [A, B2].forEach((s) => s.disconnect());
}

// ── the partner card ─────────────────────────────────────────────────────────
async function testThePartnerSeesFirstNameAndCollegeOnly() {
  const { A, B } = await pair({
    tokenA: (r) => mint('stu-a', 'Ann Archer', r, { first_name: 'Ann', college_branch: 'Alpha College, CSE' }),
    tokenB: (r) => mint('stu-b', 'Bob Brown', r, { first_name: 'Bob', college_branch: null }),
  });
  const card = B.last.partner.card;
  record('The partner card is first name and college/branch', card.anonymous === false && card.firstName === 'Ann' && card.collegeBranch === 'Alpha College, CSE', JSON.stringify(card));
  const everything = JSON.stringify(B.events.map((e) => e.payload));
  record('No surname, email or ids reach the partner on this screen', !/Archer|stu-a|@/.test(everything));
  record('Your own card is not sent back to you as the partner card', A.last.partner.card.firstName === 'Bob');
  [A, B].forEach((s) => s.disconnect());
}

async function testAPrivatePartnerStaysAnonymousOnTheCard() {
  const { A, B } = await pair({
    tokenA: (r) => mint('stu-a', 'Ann Archer', r, { first_name: 'Ann', college_branch: 'Alpha College, CSE' }),
    tokenB: (r) => mint('stu-b', 'Bob Brown', r, { first_name: 'Bob' }),
    privA: true,
  });
  record('A private person shows no name or college', JSON.stringify(B.last.partner.card) === '{"anonymous":true}', JSON.stringify(B.last.partner.card));
  [A, B].forEach((s) => s.disconnect());
}

// ── setup is once, by the starter, and locks ─────────────────────────────────
async function testSetupIsOnceByTheStarterAndLocks() {
  backend.calls = [];
  backend.respond = {};
  const room = await pair({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  const { roomId, A, B } = room;
  await goLive(room);
  await sleep(1100);
  B.emit('interview:configure', { roomId, config: { domain: 'Hacked', whoStarts: 'interviewer' } });
  await until(() => count(B, 'interview:error') === 1, 2000, 'guest refused');
  record('The non-starter is rejected by the server', lastOf(B, 'interview:error').reason === 'not-host' && !roomManager.getInterview(roomId)?.configured);

  A.emit('interview:configure', { roomId, config: { domain: 'SQL', difficulty: 'Hard', experience: 'Fresher', durationMinutes: 15, whoStarts: 'candidate' } });
  await until(() => count(A, 'interview:role') && count(B, 'interview:role'), 3000, 'roles');
  record('The starter submits setup; both are told their roles',
    lastOf(A, 'interview:role').role === 'candidate' && lastOf(B, 'interview:role').role === 'interviewer');
  record('Both are told AI assistance is active', lastOf(A, 'interview:role').aiAssisted === true && lastOf(B, 'interview:role').aiAssisted === true);

  await sleep(1100);
  A.emit('interview:configure', { roomId, config: { domain: 'Changed', whoStarts: 'interviewer' } });
  await until(() => count(A, 'interview:error') === 1, 2000, 'second submit');
  record('A second submit is rejected', lastOf(A, 'interview:error').reason === 'setup-locked');
  record('...and nothing was changed', roomManager.getInterview(roomId).config.domain === 'SQL');

  A.emit('interview:start', { roomId });
  await until(() => count(A, 'interview:started') && count(B, 'interview:started'), 3000, 'started');
  await sleep(1100);
  A.emit('interview:configure', { roomId, config: { domain: 'After start', whoStarts: 'interviewer' } });
  await until(() => count(A, 'interview:error') === 2, 2000, 'edit after start');
  record('An edit after the session began is rejected', lastOf(A, 'interview:error').reason === 'already-started');
  record('...and the setup is intact', roomManager.getInterview(roomId).config.domain === 'SQL' && roomManager.getInterview(roomId).config.whoStarts === 'candidate');
  [A, B].forEach((s) => s.disconnect());
}

async function testConfigureThenStartBackToBackStillStarts() {
  const room = await pair({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  await goLive(room);
  await sleep(1100);
  // the browser sends both at once, without waiting for the roles to come back
  room.A.emit('interview:configure', { roomId: room.roomId, config: { domain: 'SQL', whoStarts: 'interviewer', durationMinutes: 10 } });
  room.A.emit('interview:start', { roomId: room.roomId });
  await until(() => count(room.A, 'interview:started') && count(room.B, 'interview:started'), 4000, 'started');
  record('Setup then start, sent together, still starts the interview for both', roomManager.getInterview(room.roomId).started === true);
  [room.A, room.B].forEach((s) => s.disconnect());
}

async function testTheInterviewCannotStartWithoutSetupOrConsent() {
  const { roomId, A, B } = await pair();
  A.emit('interview:start', { roomId });
  await sleep(400);
  record('Hitting start directly on the Ready screen does nothing', count(A, 'interview:started') === 0 && !roomManager.getInterview(roomId)?.started);
  await goLive({ roomId, A, B });
  await sleep(1100);
  A.emit('interview:start', { roomId });
  await sleep(400);
  record('Start without setup does nothing', count(A, 'interview:started') === 0);
  [A, B].forEach((s) => s.disconnect());
}

// ── one-time interviewer message ─────────────────────────────────────────────
async function startInterviewFor(opts) {
  const room = await pair(opts);
  await goLive(room);
  await sleep(1100);
  room.A.emit('interview:configure', { roomId: room.roomId, config: { domain: 'SQL', whoStarts: 'interviewer', durationMinutes: 10 } });
  await until(() => count(room.A, 'interview:role'), 3000, 'roles');
  room.A.emit('interview:start', { roomId: room.roomId });
  await until(() => count(room.A, 'interview:started'), 3000, 'started');
  return room;
}

async function testInterviewerMessageShowsOnceThenNeverAgain() {
  backend.calls = [];
  backend.respond = {};
  const first = await startInterviewFor({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  await until(() => count(first.A, 'onboarding:interviewer') === 1, 3000, 'message');
  record('A first-time interviewer gets the one-time message', count(first.A, 'onboarding:interviewer') === 1);
  record('The candidate never gets it', await quiet(() => count(first.B, 'onboarding:interviewer') === 0));
  record('It was asked about per person', callsTo('/onboarding/status').some((c) => c.body.student_id === 'stu-a'));
  record('Nothing is marked seen until they click', callsTo('/onboarding/seen').length === 0);
  first.A.emit('onboarding:interviewer-dismiss', { roomId: first.roomId });
  await until(() => callsTo('/onboarding/seen').length === 1, 3000, 'seen saved');
  record('Clicking "Got it" saves it for that person', callsTo('/onboarding/seen')[0].body.student_id === 'stu-a');
  const bDismiss = callsTo('/onboarding/seen').length;
  first.B.emit('onboarding:interviewer-dismiss', { roomId: first.roomId });
  await sleep(300);
  record('Dismissals are saved against the person who clicked', callsTo('/onboarding/seen').slice(bDismiss).every((c) => c.body.student_id === 'stu-b'));
  [first.A, first.B].forEach((s) => s.disconnect());
  await sleep(100);

  backend.respond['/onboarding/status'] = { body: { seen: true } };
  const second = await startInterviewFor({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  record('A second session does not show it again', await quiet(() => count(second.A, 'onboarding:interviewer') === 0, 600));
  backend.respond = {};
  [second.A, second.B].forEach((s) => s.disconnect());
}

async function testRoleSwitchShowsItToTheNewInterviewerOnlyIfNew() {
  backend.calls = [];
  backend.respond = {};
  const room = await startInterviewFor({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  await until(() => count(room.A, 'onboarding:interviewer') === 1, 3000, 'first');
  await sleep(3100);
  room.A.emit('interview:switch-roles', { roomId: room.roomId });
  await until(() => count(room.B, 'onboarding:interviewer') === 1, 5000, 'B new interviewer');
  record('When roles switch, the new interviewer gets it if it is their first time', count(room.B, 'onboarding:interviewer') === 1 && count(room.A, 'onboarding:interviewer') === 1);
  [room.A, room.B].forEach((s) => s.disconnect());
}

// ── "partner did not show" ───────────────────────────────────────────────────
async function aloneWithIdentity() {
  const roomId = `pre-${uid()}`;
  const A = connect();
  await open(A);
  A.emit('create-room', { roomId, participantId: `pa-${uid()}`, token: mint('stu-a', 'Ann', roomId) });
  await until(() => A.last, 2000, 'room');
  return { roomId, A };
}

async function testPartnerDidNotShow() {
  backend.calls = [];
  backend.respond = {};
  const { roomId, A } = await aloneWithIdentity();
  A.emit('no-show:mark', { roomId });
  await until(() => count(A, 'no-show:marked'), 3000, 'marked');
  const sent = callsTo('/no-show')[0]?.body;
  record('The waiting person can mark it; the backend is told who and which session', sent && sent.room_id === roomId && sent.reporter_student_id === 'stu-a', JSON.stringify(sent));
  record('The room is closed afterwards', !roomManager.roomExists(roomId));
  A.disconnect();

  backend.respond['/no-show'] = { status: 409, body: { detail: 'Please wait 4 more minute(s) before marking this.' } };
  const early = await aloneWithIdentity();
  early.A.emit('no-show:mark', { roomId: early.roomId });
  await until(() => count(early.A, 'no-show:error'), 3000, 'too early');
  record('Too early: the backend decides and its words are shown', /wait 4 more/.test(lastOf(early.A, 'no-show:error').message) && count(early.A, 'no-show:marked') === 0);
  record('...and the room stays open', roomManager.roomExists(early.roomId));
  early.A.disconnect();
  backend.respond = {};

  const room = await pair({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  backend.calls = [];
  room.A.emit('no-show:mark', { roomId: room.roomId });
  await until(() => count(room.A, 'no-show:error'), 3000, 'partner there');
  record('Not possible once the partner is in the room', /already here/.test(lastOf(room.A, 'no-show:error').message) && callsTo('/no-show').length === 0);
  [room.A, room.B].forEach((s) => s.disconnect());

  const anon = connect();
  await open(anon);
  const anonRoom = `pre-${uid()}`;
  anon.emit('create-room', { roomId: anonRoom, participantId: 'pa-anon' });
  await until(() => anon.last, 2000, 'anon room');
  anon.emit('no-show:mark', { roomId: anonRoom });
  await until(() => count(anon, 'no-show:error'), 2000, 'anon');
  record('An anonymous room has no scheduled meeting to mark', /scheduled/.test(lastOf(anon, 'no-show:error').message));
  anon.disconnect();
}

// ── answers too short to judge ───────────────────────────────────────────────
async function testShortAnswersGetAnHonestReportNotAScore() {
  backend.calls = [];
  backend.respond = {};
  const room = await startInterviewFor({ tokenA: (r) => mint('stu-a', 'Ann', r), tokenB: (r) => mint('stu-b', 'Bob', r) });
  await sleep(3100);
  room.A.emit('interview:end', { roomId: room.roomId });
  await until(() => count(room.B, 'interview:turn-report'), 5000, 'report');
  const report = lastOf(room.B, 'interview:turn-report').report;
  record('A silent round gets "too short to judge", flagged as such', report.insufficient === true && /too short to judge/i.test(report.suggestions[0]));
  record('No score is invented', ['overall_score', 'technical_score', 'communication_score', 'confidence_score', 'problem_solving_score'].every((k) => report[k] === null));
  record('No strengths or weaknesses are invented', report.strengths.length === 0 && report.weaknesses.length === 0);
  await until(() => callsTo('/peer-reports').length === 1, 4000, 'webhook');
  const sent = callsTo('/peer-reports')[0].body;
  record('It is stored as insufficient, not as an AI failure', sent.insufficient === true && sent.unavailable === false && sent.report.overall_score === null);
  [room.A, room.B].forEach((s) => s.disconnect());
}

(async () => {
  const stubPort = await startBackendStub();
  await startServer(stubPort);
  console.log(`\n=== PeerMeet pre-call tests — server on port ${port} ===\n`);
  const tests = [
    testNothingFlowsUntilBothReady,
    testReadyNeedsYesAndWorkingDevices,
    testDoubleClickOnReadyIsHarmless,
    testANoCancelsWithoutAReason,
    testOnlyANewestWordingCounts,
    testYesIsStoredOnTheBackendFirst,
    testRecordingNeedsTheBackendsStoredYesForBoth,
    testSomeoneWhoNeverClicksReadyEndsItWithAClearReason,
    testPartnerLeavesOnTheReadyScreen,
    testRefreshKeepsYesButNotReady,
    testThePartnerSeesFirstNameAndCollegeOnly,
    testAPrivatePartnerStaysAnonymousOnTheCard,
    testSetupIsOnceByTheStarterAndLocks,
    testConfigureThenStartBackToBackStillStarts,
    testTheInterviewCannotStartWithoutSetupOrConsent,
    testInterviewerMessageShowsOnceThenNeverAgain,
    testRoleSwitchShowsItToTheNewInterviewerOnlyIfNew,
    testPartnerDidNotShow,
    testShortAnswersGetAnHonestReportNotAScore,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      record(`${t.name} (harness)`, false, err.message);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed, ${failed} failed ===`);
  sockets.forEach((s) => s.close());
  process.exit(failed ? 1 : 0);
})();
