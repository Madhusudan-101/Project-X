/**
 * InterviewerOnboarding.jsx: shown once, the first time a person is ever made interviewer.
 * It only closes on an explicit click of "Got it". Escape and clicking outside do nothing, so it cannot be
 * dismissed by accident (the server remembers the click for that person across devices and sessions).
 */

import React, { useEffect, useRef } from 'react';

function InterviewerOnboarding({ onDismiss }) {
  const buttonRef = useRef(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        className="glass-strong rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <h2 id="onboarding-title" className="text-lg font-bold text-white mb-3">You are the interviewer</h2>
        <div id="onboarding-body" className="text-sm text-slate-200 space-y-3">
          <p>
            You&apos;ll get live suggested questions and live scoring of your partner&apos;s answers. Treat them as a
            guide, not a script. Your job is to actually run a good interview.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-slate-300">
            <li>Glance at the suggestions. Pick the interesting one instead of reading them all mechanically.</li>
            <li>Ask it naturally, in your own words.</li>
            <li>Use the topic map to notice if the conversation is stuck on one topic for too long.</li>
          </ul>
        </div>
        <button ref={buttonRef} type="button" onClick={onDismiss} className="btn-primary w-full mt-5">
          Got it
        </button>
      </div>
    </div>
  );
}

export default InterviewerOnboarding;
