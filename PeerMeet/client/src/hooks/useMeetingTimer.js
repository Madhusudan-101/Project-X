/**
 * useMeetingTimer.js
 *
 * Tracks elapsed time since the meeting first became "live" (both
 * participants present). Pause-friendly: false → true after the very
 * first start resumes from the elapsed value rather than resetting to
 * zero, so a partner's transient disconnect + rejoin does not restart
 * the meeting clock.
 * Returns a formatted string like "12:34" or "1:23:45".
 */

import { useState, useEffect, useRef } from 'react';

export function useMeetingTimer(isRunning) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef(null);
  // Only the FIRST transition into `isRunning=true` resets to zero.
  // Subsequent restarts resume from wherever the elapsed value was paused.
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (isRunning) {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        setSeconds(0);
      }
      intervalRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  /**
   * Format seconds into HH:MM:SS or MM:SS
   */
  const formatted = formatDuration(seconds);

  return { seconds, formatted };
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
