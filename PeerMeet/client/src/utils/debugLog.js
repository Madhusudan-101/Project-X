/**
 * debugLog.js
 *
 * Thin wrapper so verbose connection/media tracing (WebRTC, transcription,
 * media devices) only prints during local development, not in every user's
 * production console. `console.error`/`console.warn` call sites are left
 * untouched everywhere — those are meaningful failures worth keeping visible
 * in production too (e.g. for a user reporting a broken call).
 */
export const debugLog = import.meta.env.DEV ? console.log.bind(console) : () => {};
