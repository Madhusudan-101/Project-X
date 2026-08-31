/**
 * InterviewCountdown.jsx
 *
 * Renders a synced countdown to the interview deadline (an absolute timestamp
 * from the server). Turns amber and surfaces a warning when <= 2 minutes
 * remain. The server is the source of truth for auto-ending; this is display
 * + an early heads-up only.
 */

import React, { useEffect, useState } from 'react';
import { HiClock } from 'react-icons/hi2';

const WARNING_THRESHOLD_MS = 2 * 60 * 1000;

function formatRemaining(ms) {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function InterviewCountdown({ deadline }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;

  const remaining = deadline - now;
  const isWarning = remaining <= WARNING_THRESHOLD_MS && remaining > 0;
  const isExpired = remaining <= 0;

  const tone = isExpired
    ? 'text-red-300 border-red-500/40 bg-red-500/10'
    : isWarning
    ? 'text-amber-300 border-amber-500/40 bg-amber-500/10 animate-pulse'
    : 'text-slate-200 border-white/10 bg-white/5';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${tone}`}>
        <HiClock className="text-sm" />
        {isExpired ? 'Time up' : `${formatRemaining(remaining)} remaining`}
      </div>
      {isWarning && (
        <span className="text-[11px] text-amber-300">
          2 minutes left — wrap up soon
        </span>
      )}
    </div>
  );
}

export default InterviewCountdown;
