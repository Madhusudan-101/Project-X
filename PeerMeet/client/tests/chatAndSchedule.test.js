import test from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialChat, canSend, describeChatError, MAX_CHAT_LENGTH } from '../src/utils/chatState.js';
import { parseUntil, endCountdown, nextWarning } from '../src/utils/scheduledEnd.js';

const msg = (id, text = id) => ({ id, text, at: 1 });

test('chat: messages are added once, in order, and mine/theirs is kept', () => {
  let s = chatReducer(initialChat, { type: 'received', message: msg('a'), panelOpen: true });
  s = chatReducer(s, { type: 'sent', message: msg('b') });
  s = chatReducer(s, { type: 'received', message: msg('a'), panelOpen: true }); // duplicate
  assert.deepEqual(s.messages.map((m) => [m.id, m.mine]), [['a', false], ['b', true]]);
});

test('chat: unread counts only messages that arrive while the panel is closed, and clears on read', () => {
  let s = chatReducer(initialChat, { type: 'received', message: msg('a'), panelOpen: false });
  s = chatReducer(s, { type: 'received', message: msg('b'), panelOpen: false });
  s = chatReducer(s, { type: 'received', message: msg('c'), panelOpen: true });
  assert.equal(s.unread, 2);
  s = chatReducer(s, { type: 'received', message: msg('b'), panelOpen: false }); // a repeat is not new
  assert.equal(s.unread, 2);
  s = chatReducer(s, { type: 'read' });
  assert.equal(s.unread, 0);
});

test('chat: history replaces the log (reconnect), is deduplicated and bounded', () => {
  let s = chatReducer(initialChat, { type: 'received', message: msg('old'), panelOpen: true });
  const many = Array.from({ length: 300 }, (_, i) => ({ ...msg(`m${i}`), mine: i % 2 === 0 }));
  s = chatReducer(s, { type: 'history', messages: [...many, msg('m5')] });
  assert.equal(s.messages.length, 200);
  assert.equal(s.messages[199].id, 'm299');
  assert.equal(s.messages.some((m) => m.id === 'old'), false);
  assert.equal(s.messages[199].mine, false);
  assert.equal(chatReducer(s, { type: 'reset' }), initialChat);
  assert.equal(chatReducer(s, { type: 'unknown' }), s);
});

test('chat: what can be sent, and why a send fails', () => {
  assert.equal(canSend('hi'), true);
  assert.equal(canSend('   '), false);
  assert.equal(canSend(null), false);
  assert.equal(canSend('x'.repeat(MAX_CHAT_LENGTH)), true);
  assert.equal(canSend('x'.repeat(MAX_CHAT_LENGTH + 1)), false);
  for (const e of ['slow-down', 'not-in-room', 'empty', 'weird']) assert.ok(describeChatError(e).length > 5);
});

test('scheduled end: only sane values are accepted', () => {
  const now = Date.UTC(2030, 0, 1, 12);
  assert.equal(parseUntil(String(now + 30 * 60000), now), now + 30 * 60000);
  assert.equal(parseUntil('nope', now), null);
  assert.equal(parseUntil(null, now), null);
  assert.equal(parseUntil('0', now), null);
  assert.equal(parseUntil(String(1000), now), null); // 1970
  assert.equal(parseUntil(String(now + 48 * 3600 * 1000), now), null); // days away
});

test('scheduled end: countdown labels', () => {
  const now = 1_900_000_000_000;
  assert.equal(endCountdown(null, now), null);
  assert.deepEqual(endCountdown(now + 90_000, now), { minutesLeft: 2, over: false, label: '2 min left' });
  assert.equal(endCountdown(now + 30_000, now).label, '1 min left');
  assert.deepEqual(endCountdown(now - 1, now), { minutesLeft: 0, over: true, label: 'Scheduled time is up' });
});

test('scheduled end: each warning fires once, in order, and never after a later one', () => {
  const until = 1_900_000_000_000;
  assert.equal(nextWarning(until, until - 20 * 60000, null), null);
  const five = nextWarning(until, until - 4 * 60000, null);
  assert.equal(five.key, 'five');
  assert.equal(nextWarning(until, until - 3 * 60000, 'five'), null); // not again
  const one = nextWarning(until, until - 30_000, 'five');
  assert.equal(one.key, 'one');
  assert.equal(nextWarning(until, until - 10_000, 'one'), null);
  const over = nextWarning(until, until + 1000, 'one');
  assert.equal(over.key, 'over');
  assert.equal(nextWarning(until, until + 60000, 'over'), null);
  // joining late (inside the last minute) skips the five-minute warning
  assert.equal(nextWarning(until, until - 30_000, null).key, 'one');
  assert.match(over.text, /You can keep talking/);
  assert.equal(nextWarning(null, until, null), null);
});
