import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { peerSafetyService, type SafetyStatus } from "@/services/api/candidate/peerSafety";

/** Shown instead of a silent failure when peer interviews are paused on this account. */
export function suspensionMessage(s: SafetyStatus | null): string | null {
  if (!s?.suspended) return null;
  const until = s.suspended_until
    ? ` until ${new Date(s.suspended_until).toLocaleDateString()}`
    : "";
  return `Peer interviews are paused on your account${until} while a report is reviewed. You can still use the rest of Mirracle.`;
}

export function PeerSuspensionNotice() {
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  useEffect(() => {
    let live = true;
    peerSafetyService
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const message = suspensionMessage(status);
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
