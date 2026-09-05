/**
 * WaitingScreen.jsx
 *
 * Shown to the initiator while waiting for a second participant to join.
 *
 * Features:
 *   - Animated waiting indicator
 *   - Room ID display
 *   - Copy meeting ID button with feedback
 */

import React, { useState, useCallback } from 'react';
import { HiClipboard, HiClipboardDocumentCheck } from 'react-icons/hi2';
import { MdPeopleOutline } from 'react-icons/md';
import { useToast } from '../context/ToastContext.jsx';

function WaitingScreen({ roomId, reconnecting = false }) {
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();

  const heading = reconnecting
    ? 'Waiting for your peer to rejoin…'
    : 'Waiting for your interview partner…';
  const subheading = reconnecting
    ? 'Your peer stepped away. The interview clock is paused until they return.'
    : 'Share the Room ID below so your peer can join. The interview clock will start the moment they do.';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      addToast('Meeting ID copied to clipboard!', 'success', 3000);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = roomId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      addToast('Meeting ID copied!', 'success', 3000);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomId, addToast]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center glass-dark rounded-2xl overflow-hidden animate-fade-in">
      {/* Subtle grid backdrop, faded toward the edges — matches the modal's
          "signal room" aesthetic without extra libraries. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage:
            'radial-gradient(120% 80% at 50% 40%, black, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(120% 80% at 50% 40%, black, transparent 70%)',
        }}
      />

      {/* Status pill */}
      <div className="relative mb-4 inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
        {reconnecting ? 'Peer left — waiting' : 'Room open'}
      </div>

      {/* Animated icon */}
      <div className="relative mb-6">
        {/* Outer pulse rings */}
        <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping-slow scale-150" />
        <div className="absolute inset-0 rounded-full bg-violet-500/10 animate-ping-slow scale-200" style={{ animationDelay: '0.5s' }} />

        {/* Icon container */}
        <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-violet-600/30 to-purple-800/30 border border-violet-500/40 flex items-center justify-center shadow-glow">
          <MdPeopleOutline className="text-4xl text-violet-300" />
        </div>
      </div>

      {/* Text */}
      <h2 className="text-xl font-semibold text-white mb-2 text-center px-4">
        {heading}
      </h2>
      <p className="text-sm text-slate-400 mb-8 text-center px-6 max-w-sm">
        {subheading}
      </p>

      {/* Meeting ID card */}
      <div className="glass-strong rounded-2xl p-4 flex flex-col items-center gap-3 min-w-[260px] max-w-[320px]">
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
          Meeting ID
        </span>

        <div className="flex items-center gap-2 w-full">
          <code
            className="flex-1 bg-dark-700/80 text-violet-200 rounded-xl px-3 py-2 text-sm font-mono tracking-widest text-center border border-violet-500/20 truncate"
            aria-label="Meeting ID"
          >
            {roomId}
          </code>

          <button
            id="btn-copy-meeting-id"
            onClick={handleCopy}
            title="Copy meeting ID"
            aria-label="Copy meeting ID"
            className={`
              flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center
              transition-all duration-200 active:scale-95
              ${copied
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'glass text-slate-300 hover:text-white hover:bg-white/10'
              }
            `}
          >
            {copied ? (
              <HiClipboardDocumentCheck className="text-lg" />
            ) : (
              <HiClipboard className="text-lg" />
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500 text-center">
          The room supports 2 participants
        </p>
      </div>

      {/* Animated dots */}
      <div className="flex gap-1.5 mt-8">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-violet-500/60 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default WaitingScreen;
