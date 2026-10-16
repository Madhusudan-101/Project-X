/**
 * CandidateNote.jsx: a short note for the person being interviewed.
 */

import React from 'react';

function CandidateNote() {
  return (
    <div className="w-full flex justify-center px-4 pt-2">
      <p className="glass rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 max-w-6xl w-full" role="note">
        <span className="font-semibold text-white">Tip:</span> answer properly and out loud. One-word or silent answers
        only produce a feedback report saying your answer was too short to judge.
      </p>
    </div>
  );
}

export default CandidateNote;
