/**
 * InterviewReport.jsx
 *
 * Shows the feedback report to the participant who was just interviewed.
 * This report is DISCLOSED to its own subject — the point of a mock interview
 * is that the person practicing sees their feedback.
 *
 * PDF export uses a print window (no extra dependencies).
 */

import React, { useCallback } from 'react';
import { HiXMark, HiArrowDownTray } from 'react-icons/hi2';
import { printReport } from '../utils/printReport.js';
import { useDialogBehavior } from '../hooks/useDialogBehavior.js';

function recommendationTone(rec) {
  const r = (rec || '').toLowerCase();
  if (r.includes('hire') && !r.includes('maybe')) return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  if (r.includes('maybe')) return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
  if (r.includes('reject')) return 'text-red-300 border-red-500/40 bg-red-500/10';
  return 'text-slate-300 border-white/20 bg-white/5';
}

function StatCard({ label, value }) {
  return (
    <div className="glass-dark rounded-xl p-3 text-center">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
    </div>
  );
}

function InterviewReport({ report, isFinal, onClose }) {
  const closeRef = useDialogBehavior(onClose);
  const handleDownloadPdf = useCallback(() => {
    printReport(report);
  }, [report]);

  if (!report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-report-title"
        className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 id="interview-report-title" className="text-lg font-bold text-white">
            {isFinal ? 'Final Interview Report' : 'Your Feedback Report'}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close report" className="text-slate-400 hover:text-white">
            <HiXMark className="text-xl" aria-hidden="true" />
          </button>
        </div>
        <p className="text-slate-400 text-sm mb-4">
          This is your performance feedback from the round you were just interviewed in.
        </p>

        {report.unavailable && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
            The AI assistant couldn't generate detailed feedback for this session. Your transcript was still recorded — scores below are unavailable.
          </p>
        )}

        <div className={`inline-block px-4 py-1.5 rounded-full border text-sm font-semibold mb-4 ${recommendationTone(report.final_recommendation)}`}>
          {report.final_recommendation || 'No recommendation'}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
          <StatCard label="Overall" value={report.overall_score} />
          <StatCard label="Technical" value={report.technical_score} />
          <StatCard label="Communication" value={report.communication_score} />
          <StatCard label="Confidence" value={report.confidence_score} />
          <StatCard label="Problem Solving" value={report.problem_solving_score} />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <h3 className="text-xs font-semibold text-emerald-300 mb-1">Strengths</h3>
            <ul className="list-disc list-inside space-y-0.5">
              {(report.strengths || []).map((s, i) => (
                <li key={i} className="text-sm text-slate-300">{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-red-300 mb-1">Areas to improve</h3>
            <ul className="list-disc list-inside space-y-0.5">
              {(report.weaknesses || []).map((s, i) => (
                <li key={i} className="text-sm text-slate-300">{s}</li>
              ))}
            </ul>
          </div>
        </div>

        {report.topics_covered?.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-slate-300 mb-1">Topics covered</h3>
            <div className="flex flex-wrap gap-1.5">
              {report.topics_covered.map((t, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border border-violet-500/30 text-violet-300 bg-violet-500/10">{t}</span>
              ))}
            </div>
          </div>
        )}

        {report.suggestions?.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-slate-300 mb-1">Suggestions</h3>
            <ul className="list-disc list-inside space-y-0.5">
              {report.suggestions.map((s, i) => (
                <li key={i} className="text-sm text-slate-300">{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="glass flex-1 py-3 rounded-xl text-sm text-slate-300 hover:text-white">
            Close
          </button>
          <button onClick={handleDownloadPdf} className="btn-primary flex-1 py-3 text-sm">
            <HiArrowDownTray className="text-base" />
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default InterviewReport;
