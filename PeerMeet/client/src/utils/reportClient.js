/**
 * Reporting the other person from inside a meeting.
 *
 * The server decides who the reporter is (from their verified sign-in) and who the partner was
 * (from the room), so this only sends the room, a reason and the optional details.
 */

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or abuse' },
  { id: 'inappropriate_content', label: 'Inappropriate content or behaviour' },
  { id: 'impersonation', label: 'Pretending to be someone else' },
  { id: 'cheating_or_sharing_questions', label: 'Cheating or sharing interview questions' },
  { id: 'spam', label: 'Spam or off-topic' },
  { id: 'no_show', label: 'Did not take part properly' },
  { id: 'other', label: 'Something else' },
];

export const MAX_DETAILS = 1000;
const ACK_TIMEOUT_MS = 12000;

/** Why a report could not be sent, in words a person can act on. */
export const REPORT_ERRORS = {
  'login-required':
    'Reports from a meeting need you to be signed in. Open the meeting from your Mirracle dashboard, or report this person from your interview history afterwards.',
  'slow-down': 'You just sent a report. Please wait a few seconds before sending another.',
  'not-in-room': 'You are not in this meeting any more.',
  'not-delivered': 'We could not save your report right now. Please try again in a moment.',
  timeout: 'The report took too long to send. Please try again.',
};

export function validateReport({ reason, details }) {
  if (!REPORT_REASONS.some((r) => r.id === reason)) return 'Choose a reason.';
  if (String(details || '').length > MAX_DETAILS) return `Keep the details under ${MAX_DETAILS} characters.`;
  return null;
}

/** @returns {Promise<{ok: true} | {ok: false, error: string, message: string}>} */
export function submitReport(socket, { roomId, reason, details, block }) {
  const invalid = validateReport({ reason, details });
  if (invalid) return Promise.resolve({ ok: false, error: 'invalid', message: invalid });
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'timeout', message: REPORT_ERRORS.timeout }),
      ACK_TIMEOUT_MS
    );
    socket.emit(
      'report-user',
      { roomId, reason, details: String(details || '').trim(), block: !!block },
      (res) => {
        clearTimeout(timer);
        if (res && res.ok) return resolve({ ok: true });
        const error = res?.error || 'not-delivered';
        resolve({ ok: false, error, message: REPORT_ERRORS[error] || REPORT_ERRORS['not-delivered'] });
      }
    );
  });
}
