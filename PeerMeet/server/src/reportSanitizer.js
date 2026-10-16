'use strict';

/**
 * The report comes from an AI model, so nothing about its shape or content can be trusted: it goes to
 * both participants' browsers and to the dashboard database. This clamps every field to the type,
 * range and length the product expects. Text is returned as plain text (the client must still render
 * it as text, never as HTML).
 */

const MAX_TEXT = 600;
const MAX_ITEMS = 20;
const MAX_TIMELINE = 50;
const SCORE_FIELDS = [
  'overall_score',
  'technical_score',
  'communication_score',
  'confidence_score',
  'problem_solving_score',
];

function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  // Strip control characters (keep tab/newline), then cap the length.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanScore(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function cleanList(value, max = MAX_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => cleanText(v)).filter(Boolean).slice(0, max);
}

function cleanTimeline(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, MAX_TIMELINE)
    .map((item) => {
      const out = {};
      for (const [key, v] of Object.entries(item).slice(0, 12)) {
        const k = cleanText(key, 40);
        if (!k) continue;
        if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
        else if (typeof v === 'boolean') out[k] = v;
        else out[k] = cleanText(typeof v === 'string' ? v : '', 300);
      }
      return out;
    });
}

/** @returns {object|null} a safe copy of the report, or null if there is nothing usable */
function sanitizeReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const out = {};
  for (const field of SCORE_FIELDS) out[field] = cleanScore(report[field]);
  out.topics_covered = cleanList(report.topics_covered);
  out.strengths = cleanList(report.strengths);
  out.weaknesses = cleanList(report.weaknesses);
  out.suggestions = cleanList(report.suggestions);
  out.question_timeline = cleanTimeline(report.question_timeline);
  out.final_recommendation = cleanText(report.final_recommendation, 80) || null;
  if (report.unavailable === true) out.unavailable = true;
  if (report.insufficient === true) out.insufficient = true;
  return out;
}

module.exports = { sanitizeReport, cleanText, cleanScore };
