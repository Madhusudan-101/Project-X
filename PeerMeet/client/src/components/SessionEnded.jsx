/**
 * SessionEnded.jsx: shown when the session ends before it started (a No, a timeout, or a no-show).
 * It never says why a partner said No: the server does not send that, and neither does this screen.
 */

import React from 'react';
import Navbar from './Navbar.jsx';

const COPY = {
  declined: {
    title: 'Session cancelled',
    body: 'You chose not to continue, so the session was cancelled. Nothing was recorded.',
  },
  cancelled: {
    title: 'Session cancelled',
    body: 'This session was cancelled before it started. Nothing was recorded. You can look for another partner.',
  },
  timeout: {
    title: 'Not ready in time',
    body: 'You were not both ready in time, so the session was closed. Nothing was recorded. You can try again.',
  },
  'no-show': {
    title: 'Marked as a no-show',
    body: 'We have recorded that your partner did not come. It will not count against you. You can look for another partner.',
  },
};

function SessionEnded({ kind = 'cancelled', backHref, backLabel, onBack }) {
  const copy = COPY[kind] || COPY.cancelled;
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center pt-16 px-4">
        <div className="glass-strong rounded-3xl p-8 md:p-10 max-w-md w-full text-center" role="status">
          <h1 className="text-2xl font-bold text-white mb-2">{copy.title}</h1>
          <p className="text-slate-300 text-sm mb-6">{copy.body}</p>
          {backHref ? (
            <a href={backHref} className="btn-primary w-full inline-block">{backLabel || 'Back to my dashboard'}</a>
          ) : (
            <button type="button" onClick={onBack} className="btn-primary w-full">{backLabel || 'Back to the home page'}</button>
          )}
        </div>
      </main>
    </div>
  );
}

export default SessionEnded;
