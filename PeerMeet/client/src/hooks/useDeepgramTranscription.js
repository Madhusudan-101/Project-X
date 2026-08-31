/**
 * useDeepgramTranscription.js
 *
 * Streams this participant's own microphone audio chunks to the backend.
 * The backend owns the Deepgram API key and Deepgram connection.
 *
 * Takes `micStream` — the STABLE camera+mic stream from useMediaDevices,
 * not the video-source stream that swaps to the screen while sharing. Using
 * the swapping stream here would silently kill transcription the moment
 * screen sharing starts (the display stream has no audio track).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import socket from '../socket.js';

const AUDIO_CHUNK_INTERVAL_MS = 250;

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    // Safari (desktop & iOS) supports neither webm nor ogg for MediaRecorder —
    // without this candidate, live transcription is silently unavailable there.
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// Insert `entry` into `list` (already sorted by timestamp) keeping order,
// or skip it entirely if its `id` is already present. Cross-speaker lines
// arrive independently (each participant has their own Deepgram connection
// with its own jitter), so arrival order at this client does not always
// match chronological order — sort-on-insert keeps the panel consistent
// for both participants regardless of network timing.
function insertSorted(list, entry) {
  if (list.some((existing) => existing.id === entry.id)) return list;

  const next = [...list, entry];
  next.sort((a, b) => a.timestamp - b.timestamp);
  return next;
}

export function useDeepgramTranscription({
  micStream,
  roomId,
  participantId,
  isAudioEnabled,
  isEnabled = true,
}) {
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscripts, setFinalTranscripts] = useState([]);
  const [transcriptionError, setTranscriptionError] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const isStoppingRef = useRef(false);

  const microphoneTrack = useMemo(() => {
    return micStream?.getAudioTracks()?.[0] || null;
  }, [micStream]);

  const stopTranscription = useCallback(() => {
    isStoppingRef.current = true;

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }

    recorderRef.current = null;
    recorderStreamRef.current = null;
    setIsTranscribing(false);
    setInterimTranscript('');
    socket.emit('transcription:stop');
  }, []);

  const startTranscription = useCallback(() => {
    if (
      !isEnabled ||
      !roomId ||
      !microphoneTrack ||
      !isAudioEnabled ||
      recorderRef.current
    ) {
      return;
    }

    if (!window.MediaRecorder) {
      setTranscriptionError('Live transcription is not supported in this browser.');
      return;
    }

    try {
      const recorderStream = new MediaStream([microphoneTrack]);

      const mimeType = getSupportedMimeType();

      if (!mimeType) {
        setTranscriptionError('Live transcription is not supported in this browser.');
        return;
      }

      const recorder = new MediaRecorder(recorderStream, { mimeType });

      isStoppingRef.current = false;
      recorderStreamRef.current = recorderStream;
      recorderRef.current = recorder;
      setTranscriptionError(null);

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0 || isStoppingRef.current) {
          return;
        }

        socket.emit('transcription:audio', event.data);
      };

      recorder.onerror = () => {
        setTranscriptionError('Microphone transcription recorder failed.');
        stopTranscription();
      };

      recorder.onstop = () => {
        recorderRef.current = null;
        recorderStreamRef.current = null;
        setIsTranscribing(false);
      };

      socket.emit('transcription:start', { roomId, mimeType });
      recorder.start(AUDIO_CHUNK_INTERVAL_MS);
      setIsTranscribing(true);
    } catch (err) {
      console.error('[Transcription] Unable to start recorder:', err);
      setTranscriptionError('Unable to start live transcription.');
      recorderRef.current = null;
      recorderStreamRef.current = null;
      setIsTranscribing(false);
    }
  }, [
    isAudioEnabled,
    isEnabled,
    microphoneTrack,
    roomId,
    stopTranscription,
  ]);

  useEffect(() => {
    if (isEnabled && isAudioEnabled && microphoneTrack) {
      startTranscription();
      return;
    }

    if (recorderRef.current) {
      stopTranscription();
    }
  }, [
    isAudioEnabled,
    isEnabled,
    microphoneTrack,
    startTranscription,
    stopTranscription,
  ]);

  useEffect(() => {
    const handleInterimTranscript = ({ text }) => {
      setInterimTranscript(text);
    };

    const handleFinalTranscript = (payload) => {
      setFinalTranscripts((current) => insertSorted(current, payload));
      setInterimTranscript((current) =>
        payload.speakerParticipantId === participantId ? '' : current
      );
    };

    // Resync path for a reconnect or late join: the server replays the
    // room's full transcript history. Merge (not replace) so any lines
    // already received live in this session aren't dropped, and dedupe by
    // id so replayed lines don't double up with ones already present.
    const handleHistory = ({ entries }) => {
      if (!Array.isArray(entries) || !entries.length) return;
      setFinalTranscripts((current) =>
        entries.reduce((list, entry) => insertSorted(list, entry), current)
      );
    };

    const handleTranscriptionError = ({ message }) => {
      setTranscriptionError(message || 'Live transcription failed.');
    };

    // The server can auto-reconnect a dropped Deepgram connection entirely
    // transparently (the recorder here keeps running throughout) — without
    // this, a "reconnecting…" error banner from that recovery would never
    // clear even after the connection is healthy again.
    const handleRecovered = () => {
      setTranscriptionError(null);
    };

    socket.on('transcription:interim', handleInterimTranscript);
    socket.on('transcription:final', handleFinalTranscript);
    socket.on('transcription:history', handleHistory);
    socket.on('transcription:error', handleTranscriptionError);
    socket.on('transcription:recovered', handleRecovered);

    return () => {
      socket.off('transcription:interim', handleInterimTranscript);
      socket.off('transcription:final', handleFinalTranscript);
      socket.off('transcription:history', handleHistory);
      socket.off('transcription:error', handleTranscriptionError);
      socket.off('transcription:recovered', handleRecovered);
    };
  }, [participantId]);

  useEffect(() => {
    const handleTrackEnded = () => {
      stopTranscription();
    };

    microphoneTrack?.addEventListener('ended', handleTrackEnded);

    return () => {
      microphoneTrack?.removeEventListener('ended', handleTrackEnded);
    };
  }, [microphoneTrack, stopTranscription]);

  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        stopTranscription();
      }
    };
  }, [stopTranscription]);

  return {
    interimTranscript,
    finalTranscripts,
    transcriptionError,
    isTranscribing,
    startTranscription,
    stopTranscription,
  };
}
