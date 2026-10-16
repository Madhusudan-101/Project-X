/**
 * The "Get ready" screen: wording and the small rules behind it, kept apart from the component so they
 * can be tested without a browser.
 */

// Shown word for word, and stored with the answer. If you change it, change the version on the backend
// (SESSION_CONSENT_VERSION in backend/app/services/peer_precall.py) and on the PeerMeet server.
export const CONSENT_QUESTION =
  'This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?';

export const RESPECT_POINTS = [
  'Be kind and respectful. Give honest, useful feedback.',
  'This is practice. Do not share real interview questions from any company.',
  'You can report your partner at any time. Reports are reviewed by people.',
];

// How long after the scheduled start a waiting person may say "my partner did not show".
// Keep in step with NO_SHOW_GRACE on the backend, which makes the final call.
export const NO_SHOW_GRACE_MINUTES = 10;

/** Plain words for each reason the server can refuse a step on this screen. */
export const PRECALL_ERRORS = {
  'consent-not-saved': 'We could not save your answer. Please try again.',
  'consent-required': 'Please answer Yes to continue.',
  'devices-not-ready': 'Your camera and microphone need to work before you can be ready.',
  'outdated-wording': 'The wording changed. Please reload this page.',
  'already-answered': 'You already answered.',
  cancelled: 'This session was cancelled.',
  'not-in-room': 'You are not in this session any more.',
};

export const precallErrorText = (reason) => PRECALL_ERRORS[reason] || 'Something went wrong. Please try again.';

/** m:ss for a number of milliseconds (never negative). */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Parse the `start` value from the link (ms since epoch). Anything odd means "unknown". */
export function parseStart(raw, now = Date.now()) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1577836800000) return null;
  if (Math.abs(n - now) > 24 * 60 * 60 * 1000) return null;
  return n;
}

/**
 * When may a person who is waiting alone mark "partner did not show"? Only for scheduled meetings, only
 * once the grace window after the scheduled start has passed, and not before they have waited here a while
 * (a person who opens the page late has not "waited"). null means: not available for this meeting.
 */
export function noShowAvailableAt({ isScheduled, startMs, openedAt, graceMinutes = NO_SHOW_GRACE_MINUTES }) {
  if (!isScheduled) return null;
  const grace = graceMinutes * 60 * 1000;
  return startMs ? startMs + grace : openedAt + grace;
}

/**
 * What the screen should show and allow, from the server's state plus what the browser knows.
 * `readyClicked` is local: it stops a double click from sending twice while the server catches up.
 */
export function describePrecall({ state, devicesReady, readyClicked = false }) {
  const me = state?.me || { consent: null, ready: false };
  const partner = state?.partner || { present: false, ready: false, card: null };
  const answered = me.consent !== null && me.consent !== undefined;
  const saidYes = me.consent === true;
  const iAmReady = me.ready === true;
  const canAnswer = Boolean(state) && !answered && state.phase === 'precall';
  const canReady = Boolean(state) && state.phase === 'precall' && saidYes && Boolean(devicesReady) && !iAmReady && !readyClicked;

  let blocker = null;
  if (!state) blocker = 'connecting';
  else if (!saidYes) blocker = 'answer';
  else if (!devicesReady) blocker = 'devices';

  let partnerLine;
  if (!partner.present) partnerLine = 'waiting';
  else if (partner.ready) partnerLine = 'ready';
  else partnerLine = 'getting-ready';

  return { answered, saidYes, iAmReady, canAnswer, canReady, blocker, partnerLine, partner };
}
