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
