import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLobby, saveLobby, clearLobby, constraintsFor, meterLevel, detectBrowser,
  permissionHelp, classifyMediaError, MEDIA_PROBLEM_TEXT,
} from '../src/utils/lobbyPrefs.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('the chosen devices are remembered per room', () => {
  const s = memory();
  assert.equal(loadLobby('room-1', s), null);
  saveLobby('room-1', { cameraId: 'cam', micId: 'mic' }, s);
  assert.deepEqual(loadLobby('room-1', s), { cameraId: 'cam', micId: 'mic' });
  assert.equal(loadLobby('room-2', s), null);
  clearLobby('room-1', s);
  assert.equal(loadLobby('room-1', s), null);
});

test('half-written or junk storage is ignored, and no consent is ever kept in it', () => {
  const s = memory();
  saveLobby('r', { cameraId: 'c', transcriptionConsent: true }, s);
  assert.deepEqual(loadLobby('r', s), { cameraId: 'c', micId: null });
  assert.doesNotMatch(s.getItem('peermeet:lobby:r'), /consent|accepted/i); // the server keeps the answer, not the browser
  s.setItem('peermeet:lobby:bad', '{not json');
  assert.equal(loadLobby('bad', s), null);
  assert.equal(loadLobby('r', null), null);
  assert.doesNotThrow(() => saveLobby('r', {}, null));
});

test('a throwing storage does not break the lobby', () => {
  const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(loadLobby('r', boom), null);
  assert.doesNotThrow(() => saveLobby('r', {}, boom));
  assert.doesNotThrow(() => clearLobby('r', boom));
});

test('chosen devices are asked for as ideal, so an unplugged one falls back', () => {
  const c = constraintsFor({ cameraId: 'cam', micId: 'mic' });
  assert.deepEqual(c.video.deviceId, { ideal: 'cam' });
  assert.deepEqual(c.audio.deviceId, { ideal: 'mic' });
  const d = constraintsFor(null);
  assert.equal(d.video.facingMode, 'user');
  assert.equal(d.audio.deviceId, undefined);
});

test('mic level: silence is 0, loud is capped at 1', () => {
  assert.equal(meterLevel(new Uint8Array(32).fill(128)), 0);
  assert.equal(meterLevel(new Uint8Array(32).fill(255)), 1);
  const half = new Uint8Array(32).fill(128); half[3] = 160;
  assert.equal(meterLevel(half), 0.5);
  assert.equal(meterLevel(null), 0);
  assert.equal(meterLevel(new Uint8Array(0)), 0);
});

test('browser detection and permission help are specific', () => {
  assert.equal(detectBrowser('Mozilla/5.0 Chrome/120 Safari/537'), 'chrome');
  assert.equal(detectBrowser('Mozilla/5.0 Chrome/120 Safari/537 Edg/120'), 'edge');
  assert.equal(detectBrowser('Mozilla/5.0 Firefox/121'), 'firefox');
  assert.equal(detectBrowser('Mozilla/5.0 Version/17 Safari/605'), 'safari');
  assert.equal(detectBrowser(''), 'other');
  for (const b of ['chrome', 'edge', 'firefox', 'safari', 'other']) assert.ok(permissionHelp(b).length >= 2);
  assert.match(permissionHelp('safari').join(' '), /Safari/);
  assert.deepEqual(permissionHelp('nonsense'), permissionHelp('other'));
});

test('media errors become one of a few causes, each with words', () => {
  assert.equal(classifyMediaError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyMediaError({ name: 'NotFoundError' }), 'missing');
  assert.equal(classifyMediaError({ name: 'OverconstrainedError' }), 'missing');
  assert.equal(classifyMediaError({ name: 'NotReadableError' }), 'busy');
  assert.equal(classifyMediaError({ name: 'SecurityError' }), 'insecure');
  assert.equal(classifyMediaError(new Error('x')), 'other');
  assert.equal(classifyMediaError(null), 'other');
  for (const k of ['denied', 'missing', 'busy', 'insecure', 'other']) assert.ok(MEDIA_PROBLEM_TEXT[k]);
});
