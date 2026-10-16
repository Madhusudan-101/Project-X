/**
 * ReportDialog.jsx
 *
 * "Report this person" from inside a meeting. Accessible modal: role=dialog, labelled, Escape closes,
 * focus moves in and returns. The person being reported is never notified in the call.
 */

import React, { useEffect, useRef, useState } from 'react';
import { HiXMark, HiFlag } from 'react-icons/hi2';
import {
  MAX_DETAILS,
  REPORT_REASONS,
  submitReport,
  validateReport,
} from '../utils/reportClient.js';

function ReportDialog({ socket, roomId, onClose, onSubmitted }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const firstRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    firstRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [busy, onClose]);

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validateReport({ reason, details });
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    const res = await submitReport(socket, { roomId, reason, details, block });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setDone(true);
    onSubmitted?.({ block });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="glass-strong rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 id="report-title" className="text-lg font-bold text-white flex items-center gap-2">
            <HiFlag aria-hidden="true" /> Report this person
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
            <HiXMark className="text-xl" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div role="status">
            <p className="text-slate-200 text-sm mb-4">
              Thank you. Your report was sent to the Mirracle team, who review every report. The other
              person is not told that you reported them.
              {block ? ' You will not be matched with them again.' : ''}
            </p>
            <button onClick={onClose} className="btn-primary w-full">Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="text-slate-400 text-sm mb-4">
              Tell us what happened. The other person is not told, and reports are reviewed by people.
              Reporting does not end your call, and you can leave at any time without penalty.
              Please only report real problems: false reports can lead to penalties.
            </p>

            <fieldset className="mb-4">
              <legend className="text-sm text-white font-medium mb-2">What happened?</legend>
              <div className="space-y-2">
                {REPORT_REASONS.map((r, i) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      type="radio"
                      name="report-reason"
                      value={r.id}
                      checked={reason === r.id}
                      onChange={() => setReason(r.id)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label htmlFor="report-details" className="text-sm text-white font-medium">
              {reason === 'other' ? 'Details (required)' : 'Details (optional)'}
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={MAX_DETAILS}
              rows={3}
              className="w-full mt-1 mb-1 rounded-lg bg-white/5 border border-white/10 p-2 text-sm text-white"
            />
            <p className="text-xs text-slate-500 mb-4">{details.length}/{MAX_DETAILS}</p>

            <label className="flex items-start gap-2 text-sm text-slate-200 mb-4">
              <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} className="mt-1" />
              <span>Also block this person and leave the call, so we never match you again.</span>
            </label>

            <p className="text-xs text-slate-500 mb-4">
              The last part of the call&apos;s live transcript is attached to your report so the team can see
              what happened. No audio or video is stored.
            </p>

            {error && (
              <p role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={busy || !reason} className="btn-primary flex-1">
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ReportDialog;
