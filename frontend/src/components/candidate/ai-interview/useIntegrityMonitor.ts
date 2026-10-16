import { useEffect, useRef, useState } from "react";

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
export function useIntegrityMonitor(active: boolean): IntegrityState {
  const [tabSwitches, setTabSwitches] = useState(0);
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    setTabSwitches(0);
    setAway(false);
    awayRef.current = false;

    const leave = () => {
      if (awayRef.current) return; // blur and visibilitychange often fire together
      awayRef.current = true;
      setAway(true);
      setTabSwitches((n) => n + 1);
    };
    const back = () => {
      if (document.hidden || !document.hasFocus()) return;
      awayRef.current = false;
      setAway(false);
    };
    const onVisibility = () => (document.hidden ? leave() : back());

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [active]);

  return { tabSwitches, away };
}
