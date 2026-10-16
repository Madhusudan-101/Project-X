import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_QUESTION, NO_SHOW_GRACE_MINUTES, describePrecall, formatCountdown, noShowAvailableAt, parseStart, precallErrorText,
} from '../src/utils/precall.js';

const st = (over = {}) => ({
  phase: 'precall',
  me: { consent: null, ready: false },
  partner: { present: true, ready: false, card: null },
  ...over,
});

test('the consent question is the one the product specified, word for word', () => {
  assert.equal(CONSENT_QUESTION, 'This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?');
});

test('Ready needs a Yes from the server AND working devices, and only once', () => {
  assert.equal(describePrecall({ state: null, devicesReady: true }).canReady, false);
  assert.equal(describePrecall({ state: st(), devicesReady: true }).canReady, false); // no answer yet
  assert.equal(describePrecall({ state: st({ me: { consent: false, ready: false } }), devicesReady: true }).canReady, false); // said No
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: false }).canReady, false); // devices not working
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: true }).canReady, true);
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: true } }), devicesReady: true }).canReady, false); // already ready
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: true, readyClicked: true }).canReady, false); // double click
  assert.equal(describePrecall({ state: st({ phase: 'live', me: { consent: true, ready: false } }), devicesReady: true }).canReady, false);
});

test('the question can be answered once, and only on the Ready screen', () => {
  assert.equal(describePrecall({ state: st(), devicesReady: false }).canAnswer, true);
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: false }).canAnswer, false);
  assert.equal(describePrecall({ state: st({ me: { consent: false, ready: false } }), devicesReady: false }).canAnswer, false);
  assert.equal(describePrecall({ state: null, devicesReady: false }).canAnswer, false);
});

test('what is blocking Ready is named in order', () => {
  assert.equal(describePrecall({ state: null, devicesReady: true }).blocker, 'connecting');
  assert.equal(describePrecall({ state: st(), devicesReady: true }).blocker, 'answer');
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: false }).blocker, 'devices');
  assert.equal(describePrecall({ state: st({ me: { consent: true, ready: false } }), devicesReady: true }).blocker, null);
});

test('partner line: waiting, getting ready, ready', () => {
  const line = (partner) => describePrecall({ state: st({ partner }), devicesReady: true }).partnerLine;
  assert.equal(line({ present: false, ready: false }), 'waiting');
  assert.equal(line({ present: true, ready: false }), 'getting-ready');
  assert.equal(line({ present: true, ready: true }), 'ready');
});

test('no-show: only for scheduled meetings, only after the grace window from the scheduled start', () => {
  const start = 1_800_000_000_000;
  assert.equal(noShowAvailableAt({ isScheduled: false, startMs: start, openedAt: 5 }), null);
  assert.equal(noShowAvailableAt({ isScheduled: true, startMs: start, openedAt: start + 999999 }), start + NO_SHOW_GRACE_MINUTES * 60000);
  // no known start (older link): at least the grace window of actually waiting here
  assert.equal(noShowAvailableAt({ isScheduled: true, startMs: null, openedAt: 1000 }), 1000 + NO_SHOW_GRACE_MINUTES * 60000);
});

test('parseStart accepts a sensible time and refuses nonsense', () => {
  const now = 1_800_000_000_000;
  assert.equal(parseStart(String(now - 5000), now), now - 5000);
  assert.equal(parseStart('abc', now), null);
  assert.equal(parseStart('0', now), null);
  assert.equal(parseStart(String(now + 3 * 24 * 3600 * 1000), now), null);
  assert.equal(parseStart(null, now), null);
});

test('countdown formats minutes and seconds and never goes negative', () => {
  assert.equal(formatCountdown(125000), '2:05');
  assert.equal(formatCountdown(59001), '1:00');
  assert.equal(formatCountdown(-5), '0:00');
});

test('every server refusal has plain words, and an unknown one still does', () => {
  for (const r of ['consent-not-saved', 'consent-required', 'devices-not-ready', 'outdated-wording', 'cancelled']) {
    assert.match(precallErrorText(r), /\w/);
    assert.doesNotMatch(precallErrorText(r), /—/);
  }
  assert.match(precallErrorText('something-new'), /Something went wrong/);
});
