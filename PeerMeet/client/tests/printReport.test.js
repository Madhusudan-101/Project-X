import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, buildPrintableHtml } from '../src/utils/printReport.js';

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("it's & <b>"), 'it&#39;s &amp; &lt;b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('no field of a hostile report becomes live HTML', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = buildPrintableHtml({
    final_recommendation: evil,
    overall_score: evil, // a string where a number belongs
    topics_covered: [evil],
    strengths: [evil],
    weaknesses: [evil],
    suggestions: [evil],
    question_timeline: [{ question: evil, assessment: evil }],
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
  // the only script-capable thing allowed is none: the page forbids scripts outright
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
});

test('numbers show, junk scores become a dash, missing lists do not crash', () => {
  const html = buildPrintableHtml({ overall_score: 81, technical_score: 'abc', strengths: 'not a list' });
  assert.match(html, /class="v">81</);
  assert.match(html, /class="v">—</);
  assert.doesNotThrow(() => buildPrintableHtml(null));
  assert.doesNotThrow(() => buildPrintableHtml({}));
});

test('the report is framed as practice feedback, not a hiring decision', () => {
  const html = buildPrintableHtml({ final_recommendation: 'Hire' });
  assert.match(html, /Practice feedback: Hire/);
  assert.match(html, /not a hiring decision/);
});
