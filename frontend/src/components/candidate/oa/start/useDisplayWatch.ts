import { useEffect, useRef, useState } from "react";
import { readIsExtended } from "./display-check";

/**
 * While the test runs: is a second display attached right now? Calls `onExtended` once each time one
 * appears (single -> multiple). Chrome fires `screen` "change" when displays change; a slow poll covers
 * the rest. Returns the current state so the page can show a banner until the display is removed.
 */
export function useDisplayWatch({
  enabled,
  onExtended,
}: {
  enabled: boolean;
  onExtended: () => void;
}): boolean {
  const [extended, setExtended] = useState(false);
  const cb = useRef(onExtended);
  cb.current = onExtended;

  useEffect(() => {
    if (!enabled) return;
    let prev = readIsExtended() === true;
    setExtended(prev);
    const check = () => {
      const now = readIsExtended() === true;
      if (now && !prev) cb.current();
      prev = now;
      setExtended(now);
    };
    const timer = window.setInterval(check, 4000);
    const screenTarget = window.screen as unknown as EventTarget;
    screenTarget.addEventListener?.("change", check);
    return () => {
      window.clearInterval(timer);
      screenTarget.removeEventListener?.("change", check);
    };
  }, [enabled]);

  return extended;
}
