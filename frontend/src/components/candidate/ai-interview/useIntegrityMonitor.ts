import { useEffect, useRef, useState } from "react";

/** What the candidate did, so the caller can report the right signal. */
export type LeaveKind = "tab_hidden" | "window_blur";

export interface IntegrityState {
  /** Times the candidate left this tab or window during the interview. */
  tabSwitches: number;
  /** True while the tab is hidden or the window has lost focus. */
  away: boolean;
}

/**
 * Detects the candidate leaving the interview tab. It only observes; what to
 * show the candidate is up to the caller. Counting starts when `active` turns true.
 */
export function useIntegrityMonitor(
  active: boolean,
  onLeave?: (kind: LeaveKind) => void,
): IntegrityState {
  const [tabSwitches, setTabSwitches] = useState(0);
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  });

  useEffect(() => {
    if (!active) return;
    setTabSwitches(0);
    setAway(false);
    awayRef.current = false;

    const leave = (kind: LeaveKind) => {
      if (awayRef.current) return; // blur and visibilitychange often fire together
      awayRef.current = true;
      setAway(true);
      setTabSwitches((n) => n + 1);
      onLeaveRef.current?.(kind);
    };
    const back = () => {
      if (document.hidden || !document.hasFocus()) return;
      awayRef.current = false;
      setAway(false);
    };
    const onVisibility = () => (document.hidden ? leave("tab_hidden") : back());
    const onBlur = () => leave("window_blur");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
    };
  }, [active]);

  return { tabSwitches, away };
}
