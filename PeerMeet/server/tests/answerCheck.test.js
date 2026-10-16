'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MIN_ANSWER_WORDS, countWords, candidateWordCount, hasEnoughToJudge, buildInsufficientReport } = require('../src/answerCheck');

const line = (speakerId, text) => ({ speakerId, text });
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('counts words, not punctuation or filler symbols', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords('...  --  ?'), 0);
  assert.equal(countWords("I don't know"), 4); // "don" and "t" count apart: short answers stay short
  assert.equal(countWords('Indexes speed up reads, 100x faster.'), 6);
});

test('only the candidate\'s words count, not the interviewer\'s', () => {
  const buf = [line('i', words(100)), line('c', 'yes'), line('c', 'no')];
  assert.equal(candidateWordCount(buf, 'c'), 2);
  assert.equal(candidateWordCount(buf, 'nobody'), 0);
  assert.equal(candidateWordCount(null, 'c'), 0);
});

test('silent, one-word and "I don\'t know" rounds are not judged', () => {
  assert.equal(hasEnoughToJudge([], 'c'), false);
  assert.equal(hasEnoughToJudge([line('i', words(200))], 'c'), false); // only the interviewer spoke
  assert.equal(hasEnoughToJudge([line('c', 'yes')], 'c'), false);
  assert.equal(hasEnoughToJudge([line('c', "I don't know")], 'c'), false);
});

test('a real answer is judged, right at the threshold', () => {
  assert.equal(hasEnoughToJudge([line('c', words(MIN_ANSWER_WORDS - 1))], 'c'), false);
  assert.equal(hasEnoughToJudge([line('c', words(MIN_ANSWER_WORDS))], 'c'), true);
  assert.equal(hasEnoughToJudge([line('c', words(10)), line('c', words(15))], 'c'), true); // spread over lines
});

test('the too-short report has no scores and invents nothing', () => {
  const r = buildInsufficientReport(['SQL']);
  for (const k of ['overall_score', 'technical_score', 'communication_score', 'confidence_score', 'problem_solving_score']) assert.equal(r[k], null);
  assert.deepEqual([r.strengths, r.weaknesses, r.question_timeline], [[], [], []]);
  assert.equal(r.insufficient, true);
  assert.match(r.suggestions[0], /too short to judge/);
  assert.equal(r.final_recommendation, 'Not enough to judge');
});
