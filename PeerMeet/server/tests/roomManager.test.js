'use strict';
/**
 * Unit tests for roomManager (pure in-memory state, no sockets).
 * Run: node --test tests/roomManager.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const rm = require('../src/roomManager');

// Socket ids are reused across tests, so drop every room a test left behind.
test.afterEach(() => {
  for (const sid of ['sA', 'sB', 'sA2', 'sB2', 'sA3', 'sB-tab2', 'sC']) {
    while (Object.keys(rm.leaveRoom(sid)).length) { /* keep removing until no room holds it */ }
  }
});

let n = 0;
const newRoom = () => `room-${++n}-${Math.random().toString(36).slice(2, 7)}`;

function pair({ aIdentity = null, bIdentity = null, aPrivate = false, bPrivate = false } = {}) {
  const roomId = newRoom();
  rm.createRoom(roomId, 'pA', 'sA', aIdentity, aPrivate);
  const res = rm.joinRoom(roomId, 'pB', 'sB', undefined, bIdentity, bPrivate);
  assert.equal(res.success, true);
  return roomId;
}

test('create + join pairs two participants and reports each other as partner', () => {
  const roomId = newRoom();
  rm.createRoom(roomId, 'pA', 'sA');
  assert.equal(rm.roomExists(roomId), true);
  assert.equal(rm.getRoomSize(roomId), 1);
  const res = rm.joinRoom(roomId, 'pB', 'sB');
  assert.deepEqual(res, { success: true, reconnected: false, partnerId: 'sA', partnerParticipantId: 'pA' });
  assert.equal(rm.getRoomSize(roomId), 2);
  assert.equal(rm.getPartner(roomId, 'sA'), 'sB');
  assert.equal(rm.getPartner(roomId, 'sB'), 'sA');
});

test('joining a missing room reports notFound', () => {
  assert.deepEqual(rm.joinRoom('nope', 'p', 's'), { success: false, notFound: true });
  assert.equal(rm.roomExists('nope'), false);
  assert.equal(rm.getRoomSize('nope'), 0);
  assert.equal(rm.getPartner('nope', 's'), undefined);
});

test('a third participant is rejected as full and does not change the room', () => {
  const roomId = pair();
  assert.deepEqual(rm.joinRoom(roomId, 'pC', 'sC'), { success: false, isFull: true });
  assert.equal(rm.getRoomSize(roomId), 2);
  assert.equal(rm.getParticipantIdForSocket(roomId, 'sC'), null);
});

test('reconnect with the same participantId reclaims the slot (page refresh)', () => {
  const roomId = pair();
  rm.leaveRoom('sB');
  const res = rm.joinRoom(roomId, 'pB', 'sB2', () => false);
  assert.equal(res.success, true);
  assert.equal(res.reconnected, true);
  assert.equal(res.partnerId, 'sA');
  assert.equal(rm.getRoomSize(roomId), 2);
  assert.equal(rm.getSocketIdForParticipant(roomId, 'pB'), 'sB2');
});

test('same participantId on a still-live socket is a duplicate tab, not a reconnect', () => {
  const roomId = pair();
  const res = rm.joinRoom(roomId, 'pB', 'sB-tab2', (sid) => sid === 'sB');
  assert.deepEqual(res, { success: false, duplicateSession: true });
  assert.equal(rm.getSocketIdForParticipant(roomId, 'pB'), 'sB', 'original tab keeps its slot');
});

test('without a liveness probe a same-id rejoin is treated as a reconnect', () => {
  const roomId = pair();
  assert.equal(rm.joinRoom(roomId, 'pB', 'sB2').reconnected, true);
});

test('room survives while one participant is connected and is deleted when both are gone', () => {
  const roomId = pair();
  assert.deepEqual(rm.leaveRoom('sA'), { roomId, partnerId: 'sB' });
  assert.equal(rm.roomExists(roomId), true);
  assert.equal(rm.getSocketIdForParticipant(roomId, 'pA'), null);
  assert.equal(rm.getPartner(roomId, 'sB'), undefined, 'a disconnected partner has no live socket');
  rm.leaveRoom('sB');
  assert.equal(rm.roomExists(roomId), false);
});

test('leaving with an unknown socket is a no-op', () => {
  assert.deepEqual(rm.leaveRoom('ghost-socket'), {});
});

test('getRoomIdForSocket / getParticipantIdForSocket resolve both ways', () => {
  const roomId = pair();
  assert.equal(rm.getRoomIdForSocket('sB'), roomId);
  assert.equal(rm.getParticipantIdForSocket(roomId, 'sB'), 'pB');
  assert.equal(rm.getSocketIdForParticipant(roomId, 'pA'), 'sA');
  assert.equal(rm.getSocketIdForParticipant(roomId, 'unknown'), null);
  assert.equal(rm.getSocketIdForParticipant(roomId, null), null);
  assert.equal(rm.getRoomIdForSocket('nobody'), undefined);
});

// ── privacy / identity ──────────────────────────────────────────────
test('display names: real name, anonymous when private, neutral when no identity', () => {
  const roomId = pair({ aIdentity: { studentId: 's1', studentName: 'Asha' }, bIdentity: { studentId: 's2', studentName: 'Ben' }, bPrivate: true });
  assert.equal(rm.getPublicDisplayName(roomId, 'pA'), 'Asha');
  assert.equal(rm.getPublicDisplayName(roomId, 'pB'), 'Anonymous Candidate');
  assert.equal(rm.getIdentityForParticipant(roomId, 'pB').studentName, 'Ben', 'identity is still kept for the backend webhook');
  const anon = pair();
  assert.equal(rm.getPublicDisplayName(anon, 'pA'), 'Participant');
  assert.equal(rm.getPublicDisplayName('missing', 'pA'), 'Participant');
  assert.equal(rm.getPublicDisplayName(anon, 'ghost'), 'Participant');
  assert.equal(rm.getIdentityForParticipant(anon, 'pA'), null);
});

test('an anonymous reconnect never blanks an attached identity; a fresh identity is adopted once', () => {
  const roomId = pair({ aIdentity: { studentId: 's1', studentName: 'Asha' } });
  rm.leaveRoom('sA');
  rm.joinRoom(roomId, 'pA', 'sA2', () => false, null);
  assert.equal(rm.getIdentityForParticipant(roomId, 'pA').studentName, 'Asha');
  rm.leaveRoom('sA2');
  rm.joinRoom(roomId, 'pA', 'sA3', () => false, { studentId: 'evil', studentName: 'Imposter' });
  assert.equal(rm.getIdentityForParticipant(roomId, 'pA').studentName, 'Asha', 'identity cannot be swapped on reconnect');
});

test('privacy toggle can be updated on reconnect', () => {
  const roomId = pair({ aIdentity: { studentId: 's1', studentName: 'Asha' } });
  assert.equal(rm.getPublicDisplayName(roomId, 'pA'), 'Asha');
  rm.leaveRoom('sA');
  rm.joinRoom(roomId, 'pA', 'sA2', () => false, null, true);
  assert.equal(rm.getPublicDisplayName(roomId, 'pA'), 'Anonymous Candidate');
});

// ── interview configuration ─────────────────────────────────────────
test('configureInterview: creator is interviewer by default; roles bound to participantIds', () => {
  const roomId = pair();
  const iv = rm.configureInterview(roomId, { domain: 'DSA', difficulty: 'Hard', experience: '2y', durationMinutes: 30, whoStarts: 'interviewer' }, 'pA');
  assert.equal(iv.configured, true);
  assert.equal(iv.configuredBy, 'pA');
  assert.deepEqual(iv.roles, { interviewerId: 'pA', candidateId: 'pB' });
  assert.equal(rm.getRole(roomId, 'pA'), 'interviewer');
  assert.equal(rm.getRole(roomId, 'pB'), 'candidate');
  assert.equal(rm.getRole(roomId, 'stranger'), null);
});

test('configureInterview: whoStarts=candidate flips roles but keeps the host as configuredBy', () => {
  const roomId = pair();
  const iv = rm.configureInterview(roomId, { whoStarts: 'candidate' }, 'pA');
  assert.deepEqual(iv.roles, { interviewerId: 'pB', candidateId: 'pA' });
  assert.equal(iv.configuredBy, 'pA');
});

test('configureInterview with no partner yet leaves the other role empty; unknown room returns null', () => {
  const roomId = newRoom();
  rm.createRoom(roomId, 'pA', 'sA');
  assert.deepEqual(rm.configureInterview(roomId, {}, 'pA').roles, { interviewerId: 'pA', candidateId: null });
  assert.equal(rm.configureInterview('nope', {}, 'pA'), null);
});

test('config is sanitised: clamps strings, rejects unknown enums, bounds duration', () => {
  const roomId = pair();
  const cfg = rm.configureInterview(roomId, {
    domain: '  ' + 'x'.repeat(500) + '  ', difficulty: 'Nightmare', experience: '', durationMinutes: 99999, whoStarts: 'nobody',
  }, 'pA').config;
  assert.equal(cfg.domain.length, 60);
  assert.equal(cfg.difficulty, 'Adaptive');
  assert.equal(cfg.experience, 'Unknown');
  assert.equal(cfg.durationMinutes, 180);
  assert.equal(cfg.whoStarts, 'interviewer');
  for (const bad of [-5, 0, NaN, 'abc', null, undefined, Infinity]) {
    const c = rm.configureInterview(roomId, { durationMinutes: bad }, 'pA').config;
    assert.ok(c.durationMinutes === 0 || c.durationMinutes === 180, `durationMinutes=${String(bad)} -> ${c.durationMinutes}`);
  }
  assert.equal(rm.configureInterview(roomId, null, 'pA').config.domain, 'General');
  assert.equal(rm.configureInterview(roomId, { domain: { evil: true } }, 'pA').config.domain, 'General');
});

test('startInterview flips the flag; missing room returns null', () => {
  const roomId = pair();
  assert.equal(rm.getInterview(roomId).started, false);
  assert.equal(rm.startInterview(roomId).started, true);
  assert.equal(rm.startInterview('nope'), null);
  assert.equal(rm.getInterview('nope'), undefined);
});

// ── role switching ──────────────────────────────────────────────────
test('switchInterviewRoles swaps roles, advances phase, resets per-phase state but keeps askedQuestions', () => {
  const roomId = pair();
  rm.configureInterview(roomId, {}, 'pA');
  const iv = rm.getInterview(roomId);
  iv.askedQuestions.push('Q1');
  iv.evaluation = { score: 7 };
  rm.appendTranscriptLine(roomId, { speakerId: 'pB', text: 'answer', timestamp: 1 });
  rm.mergeTracking(roomId, { topics_covered: ['arrays'], remaining_topics: ['graphs'], difficulty: 'Easy', coverage: [{ area: 'a', percent: 50 }], strategy: { action: 'x' } });
  rm.recordSummarySignals(roomId, { strong_areas: ['s'], weak_areas: ['w'] });

  const after = rm.switchInterviewRoles(roomId);
  assert.deepEqual(after.roles, { interviewerId: 'pB', candidateId: 'pA' });
  assert.equal(after.phase, 1);
  assert.deepEqual(after.transcriptBuffer, []);
  assert.equal(after.evaluation, null);
  assert.deepEqual([after.topicsCovered, after.remainingTopics, after.coverage, after.strengthsLog, after.weaknessLog], [[], [], [], [], []]);
  assert.equal(after.strategy, null);
  assert.deepEqual(after.askedQuestions, ['Q1']);

  assert.deepEqual(rm.switchInterviewRoles(roomId).roles, { interviewerId: 'pA', candidateId: 'pB' }, 'switching back');
});

test('switchInterviewRoles is a no-op before roles exist', () => {
  const roomId = pair();
  assert.equal(rm.switchInterviewRoles(roomId), null);
  assert.equal(rm.switchInterviewRoles('nope'), null);
});

// ── tracking / copilot ──────────────────────────────────────────────
test('mergeTracking dedupes topics case-insensitively and trims remaining to uncovered ones', () => {
  const roomId = pair();
  rm.mergeTracking(roomId, { topics_covered: ['Arrays', 'arrays', 'Graphs'], remaining_topics: ['graphs', 'DP', null, ''], difficulty: 'Easy' });
  rm.mergeTracking(roomId, { topics_covered: ['ARRAYS', 'Trees'], remaining_topics: ['dp', 'trees', 'Heaps'], difficulty: 'Hard' });
  const t = rm.getTrackingSnapshot(roomId);
  assert.deepEqual(t.topicsCovered, ['Arrays', 'Graphs', 'Trees']);
  assert.deepEqual(t.remainingTopics, ['dp', 'Heaps']);
  assert.deepEqual(t.difficultyProgression, ['Easy', 'Hard']);
});

test('mergeTracking tolerates missing/garbage input', () => {
  const roomId = pair();
  assert.doesNotThrow(() => rm.mergeTracking(roomId, null));
  assert.doesNotThrow(() => rm.mergeTracking(roomId, {}));
  assert.doesNotThrow(() => rm.mergeTracking('nope', { topics_covered: ['x'] }));
  assert.deepEqual(rm.getTrackingSnapshot(roomId).topicsCovered, []);
  assert.equal(rm.getTrackingSnapshot('nope'), null);
});

test('follow-up suggestions are deduped so the AI never repeats a probe', () => {
  const roomId = pair();
  rm.recordSuggestedFollowUps(roomId, { followUpQuestions: [{ question: 'Why?' }, { question: 'why?' }, { question: '' }] });
  rm.recordSuggestedFollowUps(roomId, { followUpQuestions: [{ question: 'How?' }] });
  rm.recordSuggestedFollowUps(roomId, {});
  assert.deepEqual(rm.getInterview(roomId).suggestedFollowUps, ['Why?', 'How?']);
});

test('copilot summary: coverage percent prefers AI breakdown, falls back to covered/total ratio, zero-safe', () => {
  const roomId = pair();
  assert.equal(rm.getCopilotSummary(roomId).overallCoveragePercent, 0);
  rm.mergeTracking(roomId, { topics_covered: ['a'], remaining_topics: ['b', 'c', 'd'] });
  assert.equal(rm.getCopilotSummary(roomId).overallCoveragePercent, 25);
  rm.mergeTracking(roomId, { coverage: [{ area: 'x', percent: 40 }, { area: 'y', percent: 80 }, { area: 'z' }] });
  assert.equal(rm.getCopilotSummary(roomId).overallCoveragePercent, 40);
  rm.getInterview(roomId).evaluation = { score: 8, confidence: 'high', difficulty: 'Medium' };
  const s = rm.getCopilotSummary(roomId);
  assert.deepEqual([s.latestScore, s.latestConfidence, s.latestDifficulty], [8, 'high', 'Medium']);
  assert.equal(rm.getCopilotSummary('nope'), null);
});

test('summary signals accumulate strengths/weaknesses without duplicates', () => {
  const roomId = pair();
  rm.recordSummarySignals(roomId, { strong_areas: ['Recursion'], weak_areas: ['DP'], weaknessSignals: ['hesitates'] });
  rm.recordSummarySignals(roomId, { strong_areas: ['recursion', 'Hashing'], weak_areas: ['dp'] });
  rm.recordSummarySignals(roomId, null);
  const iv = rm.getInterview(roomId);
  assert.deepEqual(iv.strengthsLog, ['Recursion', 'Hashing']);
  assert.deepEqual(iv.weaknessLog, ['DP', 'hesitates']);
});

test('transcript history is capped at 500 lines, newest kept', () => {
  const roomId = pair();
  for (let i = 0; i < 620; i++) rm.appendTranscriptHistory(roomId, { id: String(i), text: 't' + i });
  const h = rm.getTranscriptHistory(roomId);
  assert.equal(h.length, 500);
  assert.equal(h[0].id, '120');
  assert.equal(h[499].id, '619');
  assert.deepEqual(rm.getTranscriptHistory('nope'), []);
  assert.doesNotThrow(() => rm.appendTranscriptHistory('nope', { id: 'x' }));
});

test('per-phase transcript buffer is independent of the full-call history', () => {
  const roomId = pair();
  rm.appendTranscriptLine(roomId, { speakerId: 'pA', text: 'hi', timestamp: 1 });
  rm.appendTranscriptHistory(roomId, { id: '1', text: 'hi' });
  rm.configureInterview(roomId, {}, 'pA');
  rm.switchInterviewRoles(roomId);
  assert.equal(rm.getInterview(roomId).transcriptBuffer.length, 0);
  assert.equal(rm.getTranscriptHistory(roomId).length, 1);
});

test('the first person is the host, and a room made with an identity is restricted', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', { studentId: 's1', studentName: 'Ann', room: r }, false);
  assert.equal(rm.getHostParticipantId(r), 'pA');
  assert.equal(rm.isRoomRestricted(r), true);
  const open = newRoom();
  rm.createRoom(open, 'pB', 'sB', null, false);
  assert.equal(rm.isRoomRestricted(open), false);
});

test('releaseParticipant frees the slot (a dropped connection does not)', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  rm.joinRoom(r, 'pB', 'sB', () => true, null, false);
  rm.leaveRoom('sB'); // dropped: slot stays
  assert.equal(rm.getRoomSize(r), 2);
  rm.joinRoom(r, 'pB', 'sB2', () => false, null, false); // rejoin reclaims it
  const out = rm.releaseParticipant('sB2'); // deliberate leave
  assert.equal(out.partnerId, 'sA');
  assert.equal(rm.getRoomSize(r), 1);
  assert.equal(rm.joinRoom(r, 'pC', 'sC', () => true, null, false).success, true);
});

test('when the host leaves on purpose the partner becomes host', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  rm.joinRoom(r, 'pB', 'sB', () => true, null, false);
  rm.releaseParticipant('sA');
  assert.equal(rm.getHostParticipantId(r), 'pB');
});

test('the last person leaving deletes the room', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  rm.releaseParticipant('sA');
  assert.equal(rm.roomExists(r), false);
});

test('unknown participants count as private', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  assert.equal(rm.isParticipantPrivate(r, 'nobody'), true);
  assert.equal(rm.isParticipantPrivate(r, 'pA'), false);
});

test('a Yes is per person and everyone must say Yes before the AI interview', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  rm.joinRoom(r, 'pB', 'sB', () => true, null, false);
  assert.equal(rm.hasTranscriptionConsent(r, 'pA'), false); // nobody answered yet
  assert.equal(rm.setSessionConsent(r, 'pA', true).ok, true);
  assert.equal(rm.hasTranscriptionConsent(r, 'pA'), true);
  assert.equal(rm.hasTranscriptionConsent(r, 'pB'), false);
  assert.equal(rm.everyoneConsentedToTranscription(r), false);
  rm.setSessionConsent(r, 'pB', true);
  assert.equal(rm.everyoneConsentedToTranscription(r), true);
  assert.equal(rm.hasTranscriptionConsent(r, 'nobody'), false);
  assert.equal(rm.everyoneConsentedToTranscription('no-such-room'), false);
});

test('a lone person saying Yes is not "everyone"', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  rm.setSessionConsent(r, 'pA', true);
  assert.equal(rm.everyoneConsentedToTranscription(r), false);
});

test('an answer cannot be flipped, and a No blocks Ready', () => {
  const r = pair();
  assert.equal(rm.setSessionConsent(r, 'pA', false).ok, true);
  assert.equal(rm.setSessionConsent(r, 'pA', true).reason, 'already-answered');
  assert.equal(rm.setReady(r, 'pA', true).reason, 'consent-required');
  assert.equal(rm.setSessionConsent(r, 'pA', 'yes').ok, false); // only true or false
});

test('the session starts only when both are present, said Yes and are ready', () => {
  const r = pair();
  assert.equal(rm.setReady(r, 'pA', true).reason, 'consent-required');
  rm.setSessionConsent(r, 'pA', true);
  rm.setSessionConsent(r, 'pB', true);
  assert.equal(rm.setReady(r, 'pA', false).reason, 'devices-not-ready');
  assert.deepEqual(rm.setReady(r, 'pA', true), { ok: true, started: false, justStarted: false, justAdmitted: false });
  assert.equal(rm.isSessionStarted(r), false);
  assert.deepEqual(rm.setReady(r, 'pA', true), { ok: true, started: false, justStarted: false, justAdmitted: false }); // double click
  assert.equal(rm.setReady(r, 'pB', true).justStarted, true);
  assert.equal(rm.isSessionStarted(r), true);
  assert.equal(rm.setReady(r, 'pB', true).justStarted, false); // already started: no second start
  assert.equal(rm.setSessionConsent(r, 'pA', true).reason, 'already-started');
});

test('someone who arrives after the session started goes through Yes and Ready on their own', () => {
  const r = pair();
  rm.setSessionConsent(r, 'pA', true);
  rm.setSessionConsent(r, 'pB', true);
  rm.setReady(r, 'pA', true);
  rm.setReady(r, 'pB', true);
  rm.releaseParticipant('sB'); // B left on purpose
  assert.equal(rm.isPairAdmitted(r), false);
  rm.joinRoom(r, 'pC', 'sC', undefined, null, false);
  assert.equal(rm.getPrecallSnapshot(r, 'pC').phase, 'precall'); // not live just because the session was
  assert.equal(rm.getPrecallSnapshot(r, 'pA').phase, 'live');
  assert.equal(rm.setReady(r, 'pC', true).reason, 'consent-required');
  assert.equal(rm.everyoneConsentedToTranscription(r), false); // C never said Yes: no captions or AI
  rm.setSessionConsent(r, 'pC', true);
  assert.equal(rm.setReady(r, 'pC', true).justAdmitted, true);
  assert.equal(rm.isPairAdmitted(r), true);
  assert.equal(rm.setMediaReady(r, 'pC').partner, null); // A already did: A's media-ready was recorded earlier
});

test('a partner who is not connected cannot be waited into starting', () => {
  const r = pair();
  rm.setSessionConsent(r, 'pA', true);
  rm.setSessionConsent(r, 'pB', true);
  rm.leaveRoom('sB'); // dropped, slot kept
  rm.setReady(r, 'pA', true);
  assert.equal(rm.setReady(r, 'pB', true).justStarted, false); // pB has no live connection
  assert.equal(rm.isSessionStarted(r), false);
});

test('leaving or dropping on the Ready screen clears ready', () => {
  const r = pair();
  rm.setSessionConsent(r, 'pB', true);
  rm.setReady(r, 'pB', true);
  assert.equal(rm.getPrecallSnapshot(r, 'pA').partner.ready, true);
  rm.leaveRoom('sB');
  const snap = rm.getPrecallSnapshot(r, 'pA');
  assert.equal(snap.partner.present, false);
  assert.equal(snap.partner.ready, false);
  assert.equal(rm.precallNeedsTimer(r), false);
});

test('cancelling the session ends the pre-call for good', () => {
  const r = pair();
  rm.cancelSession(r);
  assert.equal(rm.isSessionCancelled(r), true);
  assert.equal(rm.getPrecallSnapshot(r, 'pA').phase, 'cancelled');
  rm.setSessionConsent(r, 'pA', true);
  assert.equal(rm.setReady(r, 'pA', true).reason, 'cancelled');
});

test('the partner card shows first name and college only, and nothing for a private person', () => {
  const id = { studentId: 's1', studentName: 'Ann Archer', firstName: 'Ann', collegeBranch: 'Alpha, CSE' };
  const r = pair({ aIdentity: id, bIdentity: { studentId: 's2', studentName: 'Bob Brown' } });
  assert.deepEqual(rm.getPrecallSnapshot(r, 'pB').partner.card, { anonymous: false, firstName: 'Ann', collegeBranch: 'Alpha, CSE' });
  assert.deepEqual(rm.getPrecallSnapshot(r, 'pA').partner.card, { anonymous: false, firstName: 'Bob', collegeBranch: null });
  const p = pair({ aIdentity: id, aPrivate: true });
  assert.deepEqual(rm.getPrecallSnapshot(p, 'pB').partner.card, { anonymous: true });
  const anon = pair();
  assert.deepEqual(rm.getPrecallSnapshot(anon, 'pB').partner.card, { anonymous: true });
});

test('media-ready pairs only after the session started, once each', () => {
  const r = pair();
  assert.equal(rm.setMediaReady(r, 'pA'), null); // not started
  rm.setSessionConsent(r, 'pA', true);
  rm.setSessionConsent(r, 'pB', true);
  rm.setReady(r, 'pA', true);
  rm.setReady(r, 'pB', true);
  assert.equal(rm.setMediaReady(r, 'pA').partner, null); // partner not on yet
  assert.equal(rm.setMediaReady(r, 'pA'), null); // repeat changes nothing
  assert.equal(rm.setMediaReady(r, 'pB').partner, 'sA');
});

test('chat messages: trimmed plain text, capped, only from people in the room, history bounded', () => {
  const r = newRoom();
  rm.createRoom(r, 'pA', 'sA', null, false);
  const m = rm.addChatMessage(r, 'pA', '  hi \u0007there  ');
  assert.equal(m.text, 'hi there');
  assert.equal(m.fromParticipantId, 'pA');
  assert.equal(rm.addChatMessage(r, 'pA', '   '), null);
  assert.equal(rm.addChatMessage(r, 'pA', null), null);
  assert.equal(rm.addChatMessage(r, 'stranger', 'hello'), null);
  assert.equal(rm.addChatMessage('no-such-room', 'pA', 'hello'), null);
  assert.equal(rm.addChatMessage(r, 'pA', 'x'.repeat(900)).text.length, 500);
  for (let i = 0; i < 300; i++) rm.addChatMessage(r, 'pA', `m${i}`);
  assert.equal(rm.getChatHistory(r).length, 200);
  assert.equal(rm.getChatHistory(r)[199].text, 'm299');
  assert.deepEqual(rm.getChatHistory('no-such-room'), []);
});
