export interface BrowserSupport {
  /** Things that make the interview impossible. */
  problems: string[];
  /** Things that may cause trouble but do not block it. */
  warnings: string[];
}

export interface SupportEnv {
  hasGetUserMedia: boolean;
  hasPeerConnection: boolean;
  hasAudioContext: boolean;
  userAgent: string;
  secure: boolean;
}

/** Pure: decides from a description of the browser, so it can be tested without one. */
export function checkBrowserSupport(env: SupportEnv): BrowserSupport {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!env.secure) problems.push("This page must be opened over a secure (https) connection.");
  if (!env.hasGetUserMedia)
    problems.push("This browser cannot use a camera and microphone. Use Chrome, Edge or Safari.");
  if (!env.hasPeerConnection)
    problems.push("This browser does not support live video calls. Use Chrome, Edge or Safari.");
  if (!env.hasAudioContext) problems.push("This browser cannot play call audio. Update it.");
  if (/Android|iPhone|iPad|iPod/i.test(env.userAgent))
    warnings.push("A laptop or desktop is strongly recommended. Phones may drop the call.");
  return { problems, warnings };
}

/** Reads the real browser. Anything missing counts as unsupported. */
export function detectBrowserSupport(): BrowserSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return { problems: [], warnings: [] };
  const w = window as unknown as Record<string, unknown>;
  return checkBrowserSupport({
    hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
    hasPeerConnection: typeof w.RTCPeerConnection === "function",
    hasAudioContext:
      typeof w.AudioContext === "function" || typeof w.webkitAudioContext === "function",
    userAgent: navigator.userAgent,
    secure: window.isSecureContext !== false,
  });
}
