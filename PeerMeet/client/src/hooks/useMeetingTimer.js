/**
 * useMeetingTimer.js
 *
 * Tracks elapsed time since the meeting connected.
 * Returns a formatted string like "12:34" or "1:23:45".
 */

import { useState, useEffect, useRef } from 'react';

export function useMeetingTimer(isRunning) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      // Reset and start
      setSeconds(0);
      intervalRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      // Stop
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
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
