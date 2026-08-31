/**
 * DisclosureBanner.jsx
 *
 * Persistent, non-dismissible banner shown to BOTH participants whenever the
 * AI interview assistant is active. This is the disclosure mechanism: the
 * candidate is always aware that an AI is assisting the interviewer.
 */

import React from 'react';
import { HiSparkles } from 'react-icons/hi2';

function DisclosureBanner({ role, phase }) {
  const roleLabel =
    role === 'interviewer'
      ? 'You are the interviewer'
      : role === 'candidate'
      ? 'You are the candidate'
      : null;

  return (
    <div className="w-full flex justify-center px-4 pt-2">
      <div className="glass rounded-xl border border-violet-500/30 px-4 py-2 flex items-center gap-3 text-sm max-w-6xl w-full">
        <HiSparkles className="text-violet-300 text-lg flex-shrink-0" />
        <span className="text-slate-200">
          <span className="font-semibold text-violet-300">AI-assisted interview.</span>{' '}
          An AI assistant is helping the interviewer with questions and evaluation.
          Both participants are aware of this.
        </span>
        {roleLabel && (
          <span className="ml-auto text-[11px] px-2 py-1 rounded-full border border-white/10 bg-white/5 text-slate-300 whitespace-nowrap">
            {roleLabel}
            {typeof phase === 'number' ? ` · Round ${phase + 1}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export default DisclosureBanner;
