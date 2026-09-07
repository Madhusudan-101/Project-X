/**
 * PeerMeet server integration test — real HTTP + real socket.io + real
 * roomManager. Boots the server code (not a mock) on an ephemeral port,
 * connects two independent socket.io-client instances simulating two
 * separate students, and verifies every claim the integration relies on:
 *
 *   1. Two clients sharing a room ID land in the same server-side room.
 *   2. Real `partnerDisplayName` is emitted on ready/user-joined.
 *   3. Privacy flag → peer sees "Anonymous Candidate".
 *   4. Non-private + valid JWT → peer sees the real display name.
 *   5. Non-private + no token → peer sees a neutral "Participant" label.
 *   6. A third client trying to join a full room is rejected with room-full.
 *   7. A duplicate-tab (same participantId, second live socket) is rejected
 *      with the specific `reason=duplicate-session`.
 *
 * The FastAPI matchmaking flow lives in a separate Python test — this file
 * tests the room-and-privacy contract PeerMeet's signaling exposes to
 * whatever produced the shared room ID, so it independently proves the
 * "same room ID → both sides paired" claim end-to-end at the socket layer.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // let the OS pick; we read the port back after listen
process.env.PEERMEET_SHARED_SECRET =
  process.env.PEERMEET_SHARED_SECRET || 'test-shared-secret';
// Disable outbound Metered/Deepgram/Gemini calls by clearing their keys.
delete process.env.METERED_API_KEY;
delete process.env.DEEPGRAM_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.MIRRACLE_WEBHOOK_URL;

const path = require('path');
// The PeerMeet server hardcodes require paths relative to its own src/,
// but socket.io-client is only installed under PeerMeet/client. Point
// require to it explicitly.
const clientModulePath = path.resolve(
  __dirname,
  '..',
  '..',
  'client',
  'node_modules',
  'socket.io-client'
);
const { io: ioc } = require(clientModulePath);
const jwt = require('jsonwebtoken');
// Also load the real roomManager so we can assert server-side state
// (participant count, identity attachment) after each socket handshake.
const roomManager = require(path.resolve(__dirname, '..', 'src', 'roomManager.js'));

let httpServer;
let port;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  const line = `  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`;
  // eslint-disable-next-line no-console
  console.log(line);
}

function connect(overrideUrl) {
  return ioc(overrideUrl || `http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

function waitEvent(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function waitConnect(socket, ms = 3000) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    const t = setTimeout(() => reject(new Error('connect timeout')), ms);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function mintToken(studentId, name) {
  return jwt.sign(
    { student_id: studentId, name, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 },
    process.env.PEERMEET_SHARED_SECRET,
    { algorithm: 'HS256' }
  );
}

async function startServer() {
  // Require inside the async so all env is set first.
  // eslint-disable-next-line global-require
  const modulePath = path.resolve(__dirname, '..', 'src', 'index.js');
  // Boot the real server. It calls listen() on module load and prints a
  // banner; we then read the port back off the underlying http server.
  require(modulePath);
  // Give the server a tick to listen.
  await new Promise((r) => setTimeout(r, 100));
  // Find the running http server. The module doesn't export it, so use
  // the trick: probe port allocation via a health request. Simpler: since
  // we set PORT=0, we need to intercept the http.Server. Grab it via
  // Object.values on require.cache.
  const cached = require.cache[require.resolve(modulePath)];
  const exportsObj = cached && cached.exports;
  // The server also isn't exported. Fallback: walk active handles.
  for (const h of process._getActiveHandles()) {
    if (h && typeof h.address === 'function') {
      const a = h.address();
      if (a && a.port && a.family) {
        port = a.port;
        httpServer = h;
        break;
      }
    }
  }
  if (!port) throw new Error('Could not discover server port after boot');
}

async function testTwoClientsSameRoom() {
  const roomId = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const partA = 'participant-A-' + Date.now();
  const partB = 'participant-B-' + Date.now();

  const A = connect();
  const B = connect();
  await waitConnect(A);
  await waitConnect(B);

  const tokenA = mintToken('student-uuid-A', 'Alice Anderson');
  const tokenB = mintToken('student-uuid-B', 'Bob Baker');

  // A tries join first → will be told room-not-found because empty; falls
  // back to create-room (mimicking real client flow).
  A.emit('join-room', { roomId, participantId: partA, token: tokenA, keepPrivate: false });
  await waitEvent(A, 'room-not-found');
  A.emit('create-room', { roomId, participantId: partA, token: tokenA, keepPrivate: false });
  await waitEvent(A, 'room-created');

  // B joins → ready fires on B, user-joined fires on A. Both carry
  // partnerDisplayName.
  const readyPromise = waitEvent(B, 'ready');
  const userJoinedPromise = waitEvent(A, 'user-joined');
  B.emit('join-room', { roomId, participantId: partB, token: tokenB, keepPrivate: true });

  const readyPayload = await readyPromise;
  const userJoinedPayload = await userJoinedPromise;

  record(
    'Two clients with same room ID land in the same room (socket handshake)',
    Boolean(readyPayload && readyPayload.initiatorId),
    `ready.initiatorId=${readyPayload && readyPayload.initiatorId}`
  );

  // Server-side room state: the SHARED room manager must contain exactly
  // this one room with exactly 2 participants, both with unique
  // participantIds, and identities correctly attached from the JWTs.
  const roomSize = roomManager.getRoomSize(roomId);
  const roleA = roomManager.getRole(roomId, partA); // No interview started so role is null; use identity check.
  const identityA = roomManager.getIdentityForParticipant(roomId, partA);
  const identityB = roomManager.getIdentityForParticipant(roomId, partB);
  record(
    'roomManager.getRoomSize == 2 (both slots present server-side)',
    roomSize === 2,
    `getRoomSize=${roomSize}`
  );
  record(
    'Identity attached to A from JWT (student_id + name preserved)',
    identityA && identityA.studentId === 'student-uuid-A' && identityA.studentName === 'Alice Anderson',
    `identityA=${JSON.stringify(identityA)}`
  );
  record(
    'Identity attached to B from JWT',
    identityB && identityB.studentId === 'student-uuid-B' && identityB.studentName === 'Bob Baker',
    `identityB=${JSON.stringify(identityB)}`
  );

  // A is NOT private, B IS private.
  // ⇒ B (peer of A) should see "Alice Anderson".
  // ⇒ A (peer of B) should see "Anonymous Candidate".
  record(
    'ready.partnerDisplayName reflects PEER identity (non-private) — B sees Alice',
    readyPayload && readyPayload.partnerDisplayName === 'Alice Anderson',
    `got=${readyPayload && readyPayload.partnerDisplayName}`
  );
  record(
    'user-joined.partnerDisplayName respects peer privacy — A sees Anonymous',
    userJoinedPayload && userJoinedPayload.partnerDisplayName === 'Anonymous Candidate',
    `got=${userJoinedPayload && userJoinedPayload.partnerDisplayName}`
  );

  A.disconnect();
  B.disconnect();
  await new Promise((r) => setTimeout(r, 100));
}

async function testAnonymousPeerLabel() {
  const roomId = `anon-${Date.now().toString(36)}`;
  const A = connect();
  const B = connect();
  await waitConnect(A);
  await waitConnect(B);

  // A: no token, no privacy → anon.
  A.emit('join-room', { roomId, participantId: 'p-A2', token: null, keepPrivate: false });
  await waitEvent(A, 'room-not-found');
  A.emit('create-room', { roomId, participantId: 'p-A2', token: null, keepPrivate: false });
  await waitEvent(A, 'room-created');

  const readyP = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-B2', token: null, keepPrivate: false });
  const r = await readyP;

  record(
    'Anonymous peer without privacy flag → default label',
    r.partnerDisplayName === 'Participant',
    `got=${r.partnerDisplayName}`
  );

  A.disconnect();
  B.disconnect();
  await new Promise((r) => setTimeout(r, 100));
}

async function testThirdClientRejected() {
  const roomId = `full-${Date.now().toString(36)}`;
  const A = connect();
  const B = connect();
  const C = connect();
  await waitConnect(A);
  await waitConnect(B);
  await waitConnect(C);

  A.emit('join-room', { roomId, participantId: 'p-A3', keepPrivate: false });
  await waitEvent(A, 'room-not-found');
  A.emit('create-room', { roomId, participantId: 'p-A3', keepPrivate: false });
  await waitEvent(A, 'room-created');

  const readyB = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-B3', keepPrivate: false });
  await readyB;

  const roomFullC = waitEvent(C, 'room-full');
  C.emit('join-room', { roomId, participantId: 'p-C3', keepPrivate: false });
  const payload = await roomFullC;

  record(
    'Third joiner is rejected with room-full',
    payload && payload.roomId === roomId,
    `payload=${JSON.stringify(payload)}`
  );

  A.disconnect();
  B.disconnect();
  C.disconnect();
  await new Promise((r) => setTimeout(r, 100));
}

async function testDuplicateSession() {
  const roomId = `dup-${Date.now().toString(36)}`;
  const A = connect();
  await waitConnect(A);
  A.emit('join-room', { roomId, participantId: 'p-Adup' });
  await waitEvent(A, 'room-not-found');
  A.emit('create-room', { roomId, participantId: 'p-Adup' });
  await waitEvent(A, 'room-created');

  // A' — same participantId, different socket (duplicate tab simulation).
  const Aprime = connect();
  await waitConnect(Aprime);
  const rejection = waitEvent(Aprime, 'room-full');
  Aprime.emit('join-room', { roomId, participantId: 'p-Adup' });
  const payload = await rejection;

  record(
    'Duplicate tab with same participantId is rejected as duplicate-session',
    payload && payload.reason === 'duplicate-session',
    `payload=${JSON.stringify(payload)}`
  );

  A.disconnect();
  Aprime.disconnect();
  await new Promise((r) => setTimeout(r, 100));
}

async function testReconnectPartnerAware() {
  // A + B are in a room; A drops and rejoins with the same participantId →
  // A should be treated as reconnected and B should get a fresh user-joined
  // with the correct partnerDisplayName.
  const roomId = `reco-${Date.now().toString(36)}`;
  const A = connect();
  const B = connect();
  await waitConnect(A);
  await waitConnect(B);

  const tokenB = mintToken('student-uuid-Br', 'Reconn Bob');
  A.emit('join-room', { roomId, participantId: 'p-Ar' });
  await waitEvent(A, 'room-not-found');
  A.emit('create-room', { roomId, participantId: 'p-Ar' });
  await waitEvent(A, 'room-created');

  const readyB = waitEvent(B, 'ready');
  B.emit('join-room', { roomId, participantId: 'p-Br', token: tokenB, keepPrivate: false });
  await readyB;

  // A drops.
  A.disconnect();
  await new Promise((r) => setTimeout(r, 250));

  // A rejoins with same participantId; server should recognize reconnect.
  const A2 = connect();
  await waitConnect(A2);

  const userJoinedOnB = waitEvent(B, 'user-joined');
  const readyOnA2 = waitEvent(A2, 'ready');
  A2.emit('join-room', { roomId, participantId: 'p-Ar' });

  const uj = await userJoinedOnB;
  const rd = await readyOnA2;
  record(
    'Reconnect: reclaimed same slot, ready fires on rejoined client',
    Boolean(rd.initiatorId),
    `initiatorId=${rd.initiatorId}`
  );
  record(
    'Reconnect: partner receives user-joined with correct name',
    uj.partnerDisplayName === 'Participant', // A had no token, keepPrivate=false → default
    `got=${uj.partnerDisplayName}`
  );

  A2.disconnect();
  B.disconnect();
  await new Promise((r) => setTimeout(r, 100));
}

(async () => {
  try {
    await startServer();
    // eslint-disable-next-line no-console
    console.log(`\n=== PeerMeet integration tests — server on port ${port} ===\n`);

    await testTwoClientsSameRoom();
    await testAnonymousPeerLabel();
    await testThirdClientRejected();
    await testDuplicateSession();
    await testReconnectPartnerAware();

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    // eslint-disable-next-line no-console
    console.log(`\n=== ${passed}/${results.length} passed, ${failed} failed ===`);
    if (failed) process.exit(1);
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Test harness error:', err);
    process.exit(1);
  }
})();
