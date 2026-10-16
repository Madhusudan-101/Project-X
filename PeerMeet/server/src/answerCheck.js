'use strict';

/**
 * Is there enough candidate speech to judge? A one-word, empty or silent round must not get a score:
 * it gets an honest "too short to judge" report instead, without calling the AI at all.
 */

// Total spoken words (across the whole round) below which we do not score.
const MIN_ANSWER_WORDS = 25;

const countWords = (text) => (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;

/** Words the candidate spoke in this round. `buffer` lines carry the speaker's participantId. */
function candidateWordCount(buffer, candidateId) {
  if (!Array.isArray(buffer) || !candidateId) return 0;
  return buffer.filter((l) => l && l.speakerId === candidateId).reduce((sum, l) => sum + countWords(l.text), 0);
}

function hasEnoughToJudge(buffer, candidateId) {
  return candidateWordCount(buffer, candidateId) >= MIN_ANSWER_WORDS;
}

/** The honest result for a round that was too short to judge: no scores, nothing invented. */
function buildInsufficientReport(topicsCovered = []) {
  return {
    overall_score: null,
    technical_score: null,
    communication_score: null,
    confidence_score: null,
    problem_solving_score: null,
    topics_covered: topicsCovered,
    strengths: [],
    weaknesses: [],
    question_timeline: [],
    suggestions: [
      'Your answers were too short to judge, so this round has no score. Answer out loud, in full sentences, and explain your thinking.',
    ],
    final_recommendation: 'Not enough to judge',
    insufficient: true,
  };
}

module.exports = { MIN_ANSWER_WORDS, countWords, candidateWordCount, hasEnoughToJudge, buildInsufficientReport };
