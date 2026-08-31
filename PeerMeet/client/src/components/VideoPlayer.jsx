/**
 * VideoPlayer.jsx
 *
 * Renders a video stream in a styled card.
 *
 * Features:
 *   - Attaches stream to <video> via ref (avoids React re-render issues)
 *   - Shows avatar/initial when camera is off
 *   - Muted indicator overlay
 *   - Camera off indicator overlay
 *   - Participant name label
 *   - Fullscreen support
 *   - Participant join animation
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HiMicrophone } from 'react-icons/hi2';
import { HiSpeakerXMark } from 'react-icons/hi2';
import { MdVideocam, MdVideocamOff, MdFullscreen, MdFullscreenExit } from 'react-icons/md';
import { debugLog } from '../utils/debugLog.js';


function VideoPlayer({
  stream,
  muted = false,
  label = 'Participant',
  isAudioEnabled = true,
  isVideoEnabled = true,
  isLocal = false,
  isScreenShare = false,
  className = '',
  animate = false,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);

  // ─── Attach stream to <video> element ─────────────────────────────────────
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (!stream) {
      videoEl.srcObject = null;
      return;
    }

    videoEl.srcObject = stream;

    // Pinpoints where a black tile actually breaks: a stream that arrived but
    // carries no video track, versus one that renders no frames because no
    // media is flowing over the connection (track present but `muted`).
    const videoTrack = stream.getVideoTracks()[0];
    debugLog(
      `[VideoPlayer] ✔ Stream attached (${label}) | video tracks:`,
      stream.getVideoTracks().length,
      '| track muted:',
      videoTrack ? videoTrack.muted : 'n/a'
    );

    // Browsers block autoplay of unmuted media without a prior user gesture
    // on the page (Chrome's autoplay policy). Muted local previews always
    // autoplay fine, but an unmuted remote <video> can have its play() call
    // silently rejected (NotAllowedError) — srcObject is attached so
    // everything LOOKS connected, but no frame ever renders and no audio
    // ever plays. Retry once on the next user interaction anywhere on the
    // page (click/keydown/touch already happen naturally — joining a call,
    // toggling mic/camera, etc.).
    let retryListenersAttached = false;
    const attemptPlay = () => videoEl.play().catch((err) => err);

    const cleanupRetryListeners = () => {
      if (!retryListenersAttached) return;
      window.removeEventListener('click', retryPlay);
      window.removeEventListener('keydown', retryPlay);
      window.removeEventListener('touchstart', retryPlay);
      retryListenersAttached = false;
    };

    function retryPlay() {
      cleanupRetryListeners();
      attemptPlay();
    }

    attemptPlay().then((err) => {
      if (!err) {
        debugLog(`[VideoPlayer] ✔ Video playing (${label})`);
        return;
      }
      if (err.name === 'AbortError') return;

      console.warn('[VideoPlayer] Autoplay prevented, will retry on next user interaction:', err.message);
      retryListenersAttached = true;
      window.addEventListener('click', retryPlay, { once: true });
      window.addEventListener('keydown', retryPlay, { once: true });
      window.addEventListener('touchstart', retryPlay, { once: true });
    });

    return cleanupRetryListeners;
  }, [stream]);

  // ─── Fullscreen toggle ─────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('[VideoPlayer] Fullscreen error:', err);
    }
  }, []);

  // Listen for fullscreen change (e.g., user presses Esc)
  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  // ─── Initials avatar (shown when camera is off) ────────────────────────────
  const initials = label
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      ref={containerRef}
      className={`
        relative overflow-hidden rounded-2xl glass group
        ${animate ? 'participant-join' : ''}
        ${className}
      `}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      style={{ aspectRatio: '16/9' }}
    >
      {/* ── Video element ───────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`
          absolute inset-0 w-full h-full object-cover
          ${isLocal && !isScreenShare ? 'video-local' : ''}
          ${!isVideoEnabled ? 'opacity-0' : 'opacity-100'}
          transition-opacity duration-300
        `}
        aria-label={`${label}'s video`}
      />

      {/* ── Camera off placeholder ──────────────────────────────────────── */}
      {!isVideoEnabled && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-700">
          {/* Animated avatar */}
          <div className="relative">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center text-2xl md:text-3xl font-bold text-white shadow-glow">
              {initials}
            </div>
            <div className="pulse-ring" />
          </div>
          <p className="mt-3 text-sm text-slate-400">Camera off</p>
        </div>
      )}

      {/* ── Bottom gradient overlay ─────────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

      {/* ── Participant label ───────────────────────────────────────────── */}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
        <span className="text-xs font-medium text-white/90 bg-black/40 px-2 py-0.5 rounded-md backdrop-blur-sm">
          {label}
        </span>
        {isLocal && (
          <span className="text-xs text-violet-300/80 bg-violet-900/40 px-2 py-0.5 rounded-md backdrop-blur-sm">
            You
          </span>
        )}
        {isScreenShare && (
          <span className="text-xs text-cyan-300/80 bg-cyan-900/40 px-2 py-0.5 rounded-md backdrop-blur-sm">
            Screen
          </span>
        )}
      </div>

      {/* ── Status indicators (top-right) ──────────────────────────────── */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {/* Microphone status */}
        <div
          className={`
            w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm
            ${isAudioEnabled
              ? 'bg-black/30 text-white/60'
              : 'bg-red-500/80 text-white shadow-glow-red'}
          `}
          title={isAudioEnabled ? 'Microphone on' : 'Microphone muted'}
        >
          {isAudioEnabled ? (
            <HiMicrophone className="text-sm" />
          ) : (
            <HiSpeakerXMark className="text-sm" />
          )}
        </div>

        {/* Camera status */}
        <div
          className={`
            w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm
            ${isVideoEnabled
              ? 'bg-black/30 text-white/60'
              : 'bg-red-500/80 text-white shadow-glow-red'}
          `}
          title={isVideoEnabled ? 'Camera on' : 'Camera off'}
        >
          {isVideoEnabled ? (
            <MdVideocam className="text-sm" />
          ) : (
            <MdVideocamOff className="text-sm" />
          )}
        </div>
      </div>

      {/* ── Fullscreen button (hover) ──────────────────────────────────── */}
      <button
        onClick={toggleFullscreen}
        className={`
          absolute top-3 left-3 w-8 h-8 rounded-lg
          glass flex items-center justify-center text-white/80 hover:text-white
          transition-all duration-200 hover:bg-white/10
          ${showControls || isFullscreen ? 'opacity-100' : 'opacity-0'}
        `}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          <MdFullscreenExit className="text-base" />
        ) : (
          <MdFullscreen className="text-base" />
        )}
      </button>
    </div>
  );
}

export default VideoPlayer;
