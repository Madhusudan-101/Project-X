/**
 * PeerMeet tab-opening helper — single source of truth for the
 * "pre-open a tab inside the user gesture, then navigate it once the
 * async work finishes" pattern.
 *
 * Why not `noopener,noreferrer` on the pre-open?
 * ─────────────────────────────────────────────
 * `window.open(url, name, "noopener,noreferrer")` returns `null` in
 * Chromium and Firefox. The tab still opens, but the caller receives no
 * Window handle, so the "navigate the reserved tab on match" path becomes
 * impossible and the fallback opens a SECOND real tab — the user sees a
 * blank tab plus a PeerMeet tab. That was the exact regression the
 * previous version of this file was written to prevent.
 *
 * Why write HTML into the reserved tab?
 * ─────────────────────────────────────
 * A previous version left the reserved tab on literal `about:blank` for
 * the entire duration of the async wait. For Join-with-ID (~200 ms until
 * navigate) that flashed for one frame and worked fine. For Find-Partner-
 * Now (potentially minutes waiting for a second candidate to enter the
 * queue) the user saw a completely blank tab the whole time and closed
 * it, thinking the flow had broken. Writing a styled "Preparing your
 * Peer Interview…" screen into the reserved tab makes the intermediate
 * state look intentional, and the same tab then gets `location.replace`'d
 * to PeerMeet once the async work resolves.
 *
 * How is `opener` isolation preserved without `noopener`?
 * ──────────────────────────────────────────────────────
 * PeerMeet's client [PeerMeet/client/src/pages/Home.jsx] sets
 * `window.opener = null` on load, cutting the reference from the PeerMeet
 * side. Same security posture `noopener` would have given, without the
 * regression it causes on the opener.
 *
 * Contract
 * ────────
 * `reservePeerMeetTab({ title, message? })` MUST be called synchronously
 * inside a user gesture (click, form-submit). Then:
 *   - call `handle.navigate(url)` once the final PeerMeet URL is ready;
 *   - or call `handle.abort()` if the async work failed / was cancelled.
 * Either terminal call is idempotent. A single user click produces
 * exactly ONE PeerMeet tab, or exactly zero if the pop-up blocker refused
 * the initial open (in which case `navigate` cleanly falls back to a
 * single fresh `window.open` inside the resolving user-gesture window).
 */

export interface ReserveOptions {
  /** Short heading shown in the reserved tab while the async work runs.
   * Kept generic ("Preparing your Peer Interview") when unset. */
  title?: string;
  /** One-sentence subtitle below the heading. */
  message?: string;
}

export interface PeerMeetTabHandle {
  /** Navigate the reserved tab to `url`. Falls back to a fresh
   * `window.open` if the reserved tab was blocked / never opened / was
   * manually closed by the user. Only opens ONE tab in every case. */
  navigate(url: string): void;
  /** Close the reserved tab; safe to call after navigate(). */
  abort(): void;
  /** True iff the browser actually gave us a tab (pop-up blocker
   * didn't refuse). The `navigate` fallback handles both cases so
   * callers rarely need to check this. */
  isAvailable(): boolean;
}

function renderPlaceholderHtml({ title, message }: Required<ReserveOptions>): string {
  // Kept dependency-free and inline: the reserved tab is a fresh
  // browsing context with no build pipeline. Colors mirror the dashboard's
  // neutral surface tokens closely enough to read as "part of the flow"
  // in either light or dark preference.
  const safeTitle = title.replace(/</g, "&lt;");
  const safeMessage = message.replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0b0d12;
      color: #e6e8ee;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    @media (prefers-color-scheme: light) {
      body { background: #f7f8fb; color: #1b1e26; }
      .card { background: #ffffff; border-color: #e5e7eb; }
      .subtitle { color: #4b5563; }
    }
    .card {
      max-width: 460px;
      width: 100%;
      border: 1px solid #22262f;
      border-radius: 16px;
      padding: 32px 28px;
      background: #12141b;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    }
    .spinner {
      width: 32px; height: 32px;
      margin: 0 auto 18px auto;
      border-radius: 50%;
      border: 3px solid rgba(120, 130, 200, 0.25);
      border-top-color: #7c86ff;
      animation: spin 900ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 18px; margin: 0 0 8px 0; font-weight: 600; letter-spacing: -0.01em; }
    p.subtitle { margin: 0; font-size: 13px; color: #a0a6b8; line-height: 1.5; }
    .footnote { margin-top: 22px; font-size: 11px; color: #6b7280; }
  </style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <h1>${safeTitle}</h1>
    <p class="subtitle">${safeMessage}</p>
    <div class="footnote">This tab will switch to Peer Interview automatically.</div>
  </main>
</body>
</html>`;
}

export function reservePeerMeetTab(options: ReserveOptions = {}): PeerMeetTabHandle {
  const title = options.title ?? "Preparing your Peer Interview";
  const message =
    options.message ??
    "Hold on while we get your room ready. This usually takes a couple of seconds.";

  let win: Window | null = null;
  try {
    // Intentionally no `noopener` — see file header.
    win = window.open("about:blank", "_blank");
  } catch {
    win = null;
  }

  // Write a real, styled document into the reserved tab so the user sees
  // an intentional "preparing…" screen instead of `about:blank`. `document.write`
  // is a legitimate use here — the target is our own reserved tab, whose
  // origin (about:blank) is same-origin as us, and this is the only write
  // (we do NOT `.write()` after page load). Wrapped in try/catch because a
  // pop-up-blocked tab can hand back a Window whose document is not yet
  // ready, and a heavily-locked-down environment can refuse the write.
  if (win) {
    try {
      const doc = win.document;
      doc.open();
      doc.write(renderPlaceholderHtml({ title, message }));
      doc.close();
    } catch {
      /* best-effort — the tab will just remain on about:blank if this write fails; navigate() will still take over when the async work resolves */
    }
  }

  let settled = false;

  return {
    isAvailable() {
      return !!win && !win.closed;
    },
    navigate(url: string) {
      if (settled) return;
      settled = true;
      if (win && !win.closed) {
        try {
          win.location.replace(url);
          return;
        } catch {
          // location.replace can throw in unusual edge cases (sandboxed
          // parent, extension environments). Close the reserved tab so
          // we don't leave a stale placeholder, and fall through to a
          // fresh window.open — still only ONE final tab.
          try {
            win.close();
          } catch {
            /* best-effort */
          }
        }
      }
      // Reserved tab was blocked, closed, or replace() threw. This is the
      // ONE terminal open() call, so there's no risk of a duplicate tab.
      window.open(url, "_blank");
    },
    abort() {
      if (settled) return;
      settled = true;
      if (win && !win.closed) {
        try {
          win.close();
        } catch {
          /* best-effort — cross-origin close can be blocked */
        }
      }
      win = null;
    },
  };
}
