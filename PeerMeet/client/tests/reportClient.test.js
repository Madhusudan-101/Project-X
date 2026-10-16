import test from 'node:test';
import assert from 'node:assert/strict';
import { submitReport, validateReport, REPORT_REASONS, REPORT_ERRORS } from '../src/utils/reportClient.js';

/** A fake socket whose server answers with `reply` (or never answers). */
const fakeSocket = (reply) => ({
  sent: [],
  emit(event, payload, ack) {
    this.sent.push({ event, payload });
    if (reply !== undefined) setImmediate(() => ack(reply));
  },
});

test('every reason the backend knows is offered', () => {
  assert.deepEqual(
    REPORT_REASONS.map((r) => r.id).sort(),
    ['cheating_or_sharing_questions', 'harassment', 'impersonation', 'inappropriate_content', 'no_show', 'other', 'spam']
  );
});

test('a reason is required and details are bounded', () => {
  assert.ok(validateReport({ reason: '', details: '' }));
  assert.ok(validateReport({ reason: 'bogus', details: '' }));
  assert.ok(validateReport({ reason: 'spam', details: 'x'.repeat(1001) }));
  assert.equal(validateReport({ reason: 'spam', details: 'x'.repeat(1000) }), null);
});

test('sends only the room, reason, trimmed details and block (never who the reporter is)', async () => {
  const s = fakeSocket({ ok: true });
  const res = await submitReport(s, { roomId: 'r1', reason: 'harassment', details: '  rude  ', block: 1, reporter_student_id: 'forged' });
  assert.deepEqual(res, { ok: true });
  assert.equal(s.sent[0].event, 'report-user');
  assert.deepEqual(s.sent[0].payload, { roomId: 'r1', reason: 'harassment', details: 'rude', block: true });
});

test('invalid input never reaches the socket', async () => {
  const s = fakeSocket({ ok: true });
  const res = await submitReport(s, { roomId: 'r1', reason: '', details: '' });
  assert.equal(res.ok, false);
  assert.equal(s.sent.length, 0);
});

test('server refusals become messages a person can act on', async () => {
  for (const error of ['login-required', 'slow-down', 'not-in-room', 'not-delivered']) {
    const res = await submitReport(fakeSocket({ ok: false, error }), { roomId: 'r', reason: 'spam' });
    assert.equal(res.ok, false);
    assert.equal(res.error, error);
    assert.equal(res.message, REPORT_ERRORS[error]);
  }
  const unknown = await submitReport(fakeSocket({ ok: false, error: 'weird' }), { roomId: 'r', reason: 'spam' });
  assert.equal(unknown.message, REPORT_ERRORS['not-delivered']);
  const empty = await submitReport(fakeSocket(undefined === 0 ? 0 : null), { roomId: 'r', reason: 'spam' });
  assert.equal(empty.ok, false);
});
