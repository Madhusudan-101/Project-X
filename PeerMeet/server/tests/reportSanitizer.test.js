'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeReport, cleanScore } = require('../src/reportSanitizer');

test('keeps a well-formed report', () => {
  const r = sanitizeReport({
    overall_score: 72.46,
    strengths: ['clear'],
    topics_covered: ['sql'],
    final_recommendation: 'Maybe',
  });
  assert.equal(r.overall_score, 72.5);
  assert.deepEqual(r.strengths, ['clear']);
  assert.equal(r.final_recommendation, 'Maybe');
  assert.equal(r.technical_score, null);
});

test('scores are clamped to 0-100 and junk becomes null', () => {
  assert.equal(cleanScore(250), 100);
  assert.equal(cleanScore(-4), 0);
  assert.equal(cleanScore('88'), 88);
  assert.equal(cleanScore('abc'), null);
  assert.equal(cleanScore(NaN), null);
  assert.equal(cleanScore(null), null);
  assert.equal(cleanScore({}), null);
  assert.equal(cleanScore(''), null);
});

test('lists are capped, trimmed, and only keep strings', () => {
  const many = Array.from({ length: 80 }, (_, i) => `item ${i}`);
  const r = sanitizeReport({ strengths: [...many, 5, null, { a: 1 }, '   '], weaknesses: 'not a list' });
  assert.equal(r.strengths.length, 20);
  assert.deepEqual(r.weaknesses, []);
});

test('long text is cut and control characters are removed', () => {
  const r = sanitizeReport({ strengths: ['a'.repeat(5000) + '\u0000\u0007'], final_recommendation: 'x'.repeat(500) });
  assert.equal(r.strengths[0].length, 600);
  assert.ok(!/[\u0000\u0007]/.test(r.strengths[0]));
  assert.equal(r.final_recommendation.length, 80);
});

test('markup is not interpreted here (it is plain text; the client must render it as text)', () => {
  const r = sanitizeReport({ strengths: ['<img src=x onerror=alert(1)>'] });
  assert.equal(r.strengths[0], '<img src=x onerror=alert(1)>');
});

test('timeline keeps only plain objects with bounded values', () => {
  const r = sanitizeReport({
    question_timeline: [
      { question: 'Q1', score: 8, nested: { evil: 1 }, ok: true },
      'string',
      null,
      ...Array.from({ length: 100 }, () => ({ q: 'x' })),
    ],
  });
  assert.equal(r.question_timeline.length, 50);
  assert.equal(r.question_timeline[0].question, 'Q1');
  assert.equal(r.question_timeline[0].score, 8);
  assert.equal(r.question_timeline[0].ok, true);
  assert.equal(r.question_timeline[0].nested, '');
});

test('unusable input returns null, and the unavailable flag survives', () => {
  assert.equal(sanitizeReport(null), null);
  assert.equal(sanitizeReport('x'), null);
  assert.equal(sanitizeReport([]), null);
  assert.equal(sanitizeReport({ unavailable: true }).unavailable, true);
  assert.equal(sanitizeReport({}).unavailable, undefined);
});
