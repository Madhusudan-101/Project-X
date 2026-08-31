/**
 * useMediaDevices.js
 *
 * Custom hook to manage local camera/microphone access.
 *
 * Uses: navigator.mediaDevices.getUserMedia()
 *
 * Features:
 *   - Request camera + mic with sensible video constraints
 *   - Toggle audio (mute/unmute) without stopping the stream
 *   - Toggle video (camera on/off) without restarting the stream
 *   - Replace video track for screen sharing
 *   - Graceful error handling for permission denial and device unavailability
 *   - Clean stream teardown on unmount
 *
 * `stream` vs `micStream`:
 *   `stream` is the VIDEO source for local preview + WebRTC — it switches to
 *   the display stream while screen sharing (screen share has no audio
 *   track: `getDisplayMedia({ audio: false })`).
 *   `micStream` is ALWAYS the original camera+mic stream, completely
 *   unaffected by screen sharing. Consumers that need the microphone
 *   specifically (live transcription) MUST use `micStream`, not `stream` —
 *   reading the mic track off `stream` would silently lose audio the moment
 *   screen sharing starts, since `stream` no longer has an audio track then.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { debugLog } from '../utils/debugLog.js';

/**
 * Translate MediaDevices error names to user-friendly messages.
 */
function getFriendlyError(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera/microphone permission was denied. Please allow access in your browser settings and refresh.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera or microphone was found. Please connect a device and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your camera or microphone is already in use by another application.';
    case 'OverconstrainedError':
      return 'Your camera does not support the requested video quality. Trying with default settings.';
    case 'SecurityError':
      return 'Media access is blocked due to security settings (HTTPS required in production).';
    default:
      return `Media error: ${err.message || err.name}`;
  }
}

export function useMediaDevices() {
  const [stream, setStream] = useState(null);
  // Stable mic source — set once on acquire, never touched by screen share.
  const [micStream, setMicStream] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Keep a ref to the original camera stream so we can switch back from screen share
  const cameraStreamRef = useRef(null);
  const streamRef = useRef(null);

  // ─── Acquire media ─────────────────────────────────────────────────────────
  const initializeMedia = useCallback(async (cancelled) => {
    setIsLoading(true);
    setError(null);

    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      };

      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintErr) {
        // Fallback to basic constraints if ideal constraints fail
        if (constraintErr.name === 'OverconstrainedError') {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } else {
          throw constraintErr;
        }
      }

      // This acquisition was superseded (or the component unmounted) while
      // getUserMedia was in flight — release the device instead of leaking a
      // second live camera/mic handle and publishing a stream nobody owns.
      if (cancelled?.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      debugLog(
        '[Media] ✔ getUserMedia success | video:',
        mediaStream.getVideoTracks().length,
        '| audio:',
        mediaStream.getAudioTracks().length
      );

      streamRef.current = mediaStream;
      cameraStreamRef.current = mediaStream;
      setStream(mediaStream);
      setMicStream(mediaStream);
      setIsAudioEnabled(true);
      setIsVideoEnabled(true);
    } catch (err) {
      if (cancelled?.current) return;
      console.error('[Media] Error acquiring media:', err);
      setError(getFriendlyError(err));
    } finally {
      if (!cancelled?.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    // getUserMedia is async, so on a fast unmount/remount (React StrictMode
    // in development, or any re-run of this effect) the cleanup below fires
    // while the request is still pending — at which point streamRef.current
    // is still null and there is nothing for it to stop. The camera then
    // gets opened a second time and the first stream is orphaned: its tracks
    // stay live forever (device stays held) and `stream` changes identity an
    // extra time, which churns every consumer keyed on it. Handing
    // initializeMedia a cancellation flag lets a superseded acquisition stop
    // its own tracks the moment it resolves.
    const cancelled = { current: false };

    initializeMedia(cancelled);

    return () => {
      cancelled.current = true;

      // Cleanup: stop all tracks when component unmounts
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (
        cameraStreamRef.current &&
        cameraStreamRef.current !== streamRef.current
      ) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [initializeMedia]);

  // Wrapper so the "Try Again" button's click event is never mistaken for the
  // internal cancellation token that initializeMedia takes.
  const retryMedia = useCallback(() => initializeMedia(), [initializeMedia]);

  // ─── Toggle Audio (mute/unmute) ────────────────────────────────────────────
  // Always operates on cameraStreamRef (the persistent mic source), NOT
  // streamRef — during screen share, streamRef points at the display stream,
  // which has no audio track at all, so muting against it would silently
  // do nothing to the real microphone.
  const toggleAudio = useCallback(() => {
    if (!cameraStreamRef.current) return;

    const audioTracks = cameraStreamRef.current.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsAudioEnabled((prev) => !prev);
  }, []);

  // ─── Toggle Video (camera on/off) ──────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    if (!streamRef.current) return;

    const videoTracks = streamRef.current.getVideoTracks();
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsVideoEnabled((prev) => !prev);
  }, []);

  // ─── Screen Sharing ────────────────────────────────────────────────────────
  /**
   * Start screen sharing.
   * Returns the new screen stream so useWebRTC can call peer.replaceTrack().
   */
  const startScreenShare = useCallback(async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });

      // When user stops sharing via browser UI
      displayStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      setStream(displayStream);
      streamRef.current = displayStream;
      setIsScreenSharing(true);

      return displayStream;
    } catch (err) {
      // User cancelled or permission denied — not a fatal error
      if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
        console.error('[Media] Screen share error:', err);
      }
      return null;
    }
  }, []);

  /**
   * Stop screen sharing and revert to camera.
   * Returns the camera stream so useWebRTC can restore it.
   */
  const stopScreenShare = useCallback(() => {
    // Stop screen tracks
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => track.stop());
    }

    // Revert to camera stream
    const cameraStream = cameraStreamRef.current;
    setStream(cameraStream);
    streamRef.current = cameraStream;
    setIsScreenSharing(false);

    return cameraStream;
  }, []);

  // ─── Stop all media (called on leave) ──────────────────────────────────────
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (
      cameraStreamRef.current &&
      cameraStreamRef.current !== streamRef.current
    ) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
    setMicStream(null);
    streamRef.current = null;
    cameraStreamRef.current = null;
  }, []);

  return {
    stream,
    micStream,
    isLoading,
    error,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    stopStream,
    retry: retryMedia,
  };
}
