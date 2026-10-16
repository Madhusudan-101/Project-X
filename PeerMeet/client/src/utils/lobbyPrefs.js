/**
 * The camera and microphone a person picked on the Ready screen, remembered for this tab and this room
 * only (sessionStorage), so a refresh in the middle of a call opens the same devices again.
 */

const keyFor = (roomId) => `peermeet:lobby:${roomId}`;

function safeStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** @returns {{ cameraId: string|null, micId: string|null } | null} */
export function loadLobby(roomId, storage = safeStorage()) {
  if (!storage || !roomId) return null;
  try {
    const raw = storage.getItem(keyFor(roomId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return {
      cameraId: typeof v.cameraId === 'string' ? v.cameraId : null,
      micId: typeof v.micId === 'string' ? v.micId : null,
    };
  } catch {
    return null;
  }
}

export function saveLobby(roomId, prefs, storage = safeStorage()) {
  if (!storage || !roomId) return;
  try {
    storage.setItem(
      keyFor(roomId),
      JSON.stringify({
        cameraId: prefs.cameraId || null,
        micId: prefs.micId || null,
        at: Date.now(),
      })
    );
  } catch {
    /* storage unavailable: the default devices are used after a refresh */
  }
}

export function clearLobby(roomId, storage = safeStorage()) {
  try {
    storage?.removeItem(keyFor(roomId));
  } catch {
    /* ignore */
  }
}

/** Constraints for getUserMedia from the lobby choices. `ideal`, so an unplugged device falls back. */
export function constraintsFor(prefs) {
  return {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(prefs?.cameraId ? { deviceId: { ideal: prefs.cameraId } } : { facingMode: 'user' }),
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      ...(prefs?.micId ? { deviceId: { ideal: prefs.micId } } : {}),
    },
  };
}

/** A 0..1 loudness from analyser time-domain bytes (128 = silence). */
export function meterLevel(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < bytes.length; i++) peak = Math.max(peak, Math.abs(bytes[i] - 128));
  return Math.min(1, peak / 64);
}

export function detectBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

const STEPS = {
  chrome: [
    'Click the camera icon on the right of the address bar (or the lock icon on the left).',
    'Set Camera and Microphone to Allow.',
    'Click Try again below. If it still fails, reload this page.',
  ],
  edge: [
    'Click the lock icon on the left of the address bar.',
    'Set Camera and Microphone to Allow.',
    'Click Try again below. If it still fails, reload this page.',
  ],
  firefox: [
    'Click the camera icon on the left of the address bar and remove the blocked entries.',
    'Click Try again below and choose Allow when Firefox asks.',
  ],
  safari: [
    'Open Safari > Settings > Websites > Camera, and set this site to Allow. Do the same for Microphone.',
    'Reload this page, then click Try again below.',
  ],
  other: [
    'Open your browser’s site settings for this page and allow the camera and the microphone.',
    'Reload this page, then click Try again below.',
  ],
};

export function permissionHelp(browser) {
  return STEPS[browser] || STEPS.other;
}

/** @returns {'denied'|'missing'|'busy'|'insecure'|'other'} */
export function classifyMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    case 'SecurityError':
      return 'insecure';
    default:
      return 'other';
  }
}

export const MEDIA_PROBLEM_TEXT = {
  denied: 'Your browser is blocking the camera or microphone for this page.',
  missing: 'No camera or microphone was found. Plug one in, or pick another device below.',
  busy: 'Your camera or microphone is being used by another app. Close it and try again.',
  insecure: 'This page must be opened over a secure (https) connection to use the camera.',
  other: 'We could not start your camera or microphone.',
};
