/**
 * deepgramTranscription.js
 *
 * Small lifecycle wrapper around Deepgram live transcription.
 * Each socket gets its own independent Deepgram connection.
 */

const { randomUUID } = require('crypto');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const DEFAULT_LIVE_OPTIONS = {
  model: 'nova-2',
  language: 'en-US',
  smart_format: true,
  punctuate: true,
  interim_results: true,
  endpointing: 1000,
  // Pairs with endpointing to reliably detect sentence/utterance boundaries
  // even through natural mid-thought pauses (common in interview speech).
  vad_events: true,
  utterance_end_ms: 1200,
};

// Mime type (as reported by the client's MediaRecorder) -> Deepgram
// encoding/container hints, so each participant's stream is decoded
// correctly regardless of which container their browser produced.
const MIME_TO_DEEPGRAM = {
  'audio/webm;codecs=opus': { encoding: 'opus', container: 'webm' },
  'audio/webm': { encoding: 'opus', container: 'webm' },
  'audio/ogg;codecs=opus': { encoding: 'opus', container: 'ogg' },
  'audio/ogg': { encoding: 'opus', container: 'ogg' },
  'audio/mp4': { encoding: 'aac', container: 'mp4' },
  'audio/mp4;codecs=mp4a.40.2': { encoding: 'aac', container: 'mp4' },
};

// Below this confidence, a "final" transcript is treated as noise/garbage
// (background noise, cross-talk) and dropped rather than broadcast or fed
// to the AI assistant's transcript buffer.
const MIN_FINAL_CONFIDENCE = 0.35;

const MAX_QUEUED_CHUNKS = 25;
const KEEP_ALIVE_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 3;

function normalizeAudioChunk(chunk) {
  if (!chunk) return null;
  if (Buffer.isBuffer(chunk)) return chunk;

  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }

  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  return null;
}

function closeDeepgramConnection(connection) {
  if (!connection) return;

  if (typeof connection.finish === 'function') {
    connection.finish();
    return;
  }

  if (typeof connection.requestClose === 'function') {
    connection.requestClose();
    return;
  }

  if (typeof connection.close === 'function') {
    connection.close();
  }
}

function extractTranscript(result) {
  const alternative = result?.channel?.alternatives?.[0];
  const transcript = alternative?.transcript?.trim();

  if (!transcript) return null;

  return {
    text: transcript,
    isFinal: Boolean(result.is_final),
    speechFinal: Boolean(result.speech_final),
    confidence: alternative.confidence ?? null,
  };
}

/**
 * Join a connection's locked-in ("is_final") segments into one utterance and
 * emit it as a single final transcript line, once a true boundary
 * (speech_final / UtteranceEnd) has been reached. Segments below the
 * confidence threshold are dropped as noise rather than broadcast.
 */
function flushPending(state, socketId, onFinalTranscript) {
  if (!state.pendingSegments.length) return;

  const text = state.pendingSegments.join(' ').trim();
  const confidences = state.pendingConfidences.filter((c) => typeof c === 'number');
  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null;

  state.pendingSegments = [];
  state.pendingConfidences = [];

  if (!text) return;
  if (confidence != null && confidence < MIN_FINAL_CONFIDENCE) return;

  onFinalTranscript({
    // Unique per line so clients can dedupe (a Close-triggered reconnect can
    // flush the same pending segments again if Deepgram redelivers before
    // the drop) and correctly merge server-replayed history with lines
    // already received live.
    id: randomUUID(),
    speakerId: socketId,
    roomId: state.roomId,
    text,
    confidence,
    timestamp: Date.now(),
  });
}

function createDeepgramTranscriptionManager({
  apiKey,
  onInterimTranscript,
  onFinalTranscript,
  onError,
  onReconnected,
  logger = console,
}) {
  const deepgram = apiKey ? createClient(apiKey) : null;
  const connections = new Map();

  function notifyError(socketId, error) {
    const message = error?.message || 'Deepgram transcription error';
    logger.error(`[Deepgram] ${socketId}: ${message}`);

    if (typeof onError === 'function') {
      onError(socketId, message);
    }
  }

  function stop(socketId) {
    const state = connections.get(socketId);
    if (!state) return;

    connections.delete(socketId);
    state.closed = true;
    state.queuedAudio.length = 0;

    if (state.keepAliveTimer) {
      clearInterval(state.keepAliveTimer);
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }

    closeDeepgramConnection(state.connection);
  }

  function start({ socketId, roomId, mimeType, _reconnectAttempts = 0, _carriedAudio = [] }) {
    if (!deepgram) {
      notifyError(socketId, new Error('DEEPGRAM_API_KEY is not configured'));
      return false;
    }

    stop(socketId);

    const mimeHint = mimeType ? MIME_TO_DEEPGRAM[mimeType] : null;
    const liveOptions = mimeHint
      ? { ...DEFAULT_LIVE_OPTIONS, ...mimeHint }
      : DEFAULT_LIVE_OPTIONS;

    const connection = deepgram.listen.live(liveOptions);
    const state = {
      connection,
      roomId,
      mimeType,
      isOpen: false,
      closed: false,
      // Carry over anything queued while we were reconnecting so audio
      // captured during the gap isn't silently lost.
      queuedAudio: _carriedAudio.slice(-MAX_QUEUED_CHUNKS),
      keepAliveTimer: null,
      reconnectTimer: null,
      reconnectAttempts: _reconnectAttempts,
      // Locked-in ("is_final") segments not yet flushed as a true utterance
      // boundary (speech_final / UtteranceEnd) — see flushPending().
      pendingSegments: [],
      pendingConfidences: [],
    };

    connections.set(socketId, state);

    connection.on(LiveTranscriptionEvents.Open, () => {
      if (state.closed) return;

      // Capture before resetting: tells us whether this Open followed a
      // Close-triggered reconnect (vs. the very first connection), so the
      // client's "reconnecting…" banner can be cleared once we're healthy
      // again — nothing else would ever tell it the retry succeeded, since
      // the client-side recorder keeps running transparently throughout.
      const wasReconnecting = state.reconnectAttempts > 0;

      state.isOpen = true;
      state.reconnectAttempts = 0;

      if (wasReconnecting && typeof onReconnected === 'function') {
        onReconnected(socketId);
      }

      while (state.queuedAudio.length > 0) {
        connection.send(state.queuedAudio.shift());
      }

      if (typeof connection.keepAlive === 'function') {
        state.keepAliveTimer = setInterval(() => {
          if (!state.closed) {
            connection.keepAlive();
          }
        }, KEEP_ALIVE_INTERVAL_MS);
      }
    });

    connection.on(LiveTranscriptionEvents.Transcript, (result) => {
      if (state.closed) return;

      const transcript = extractTranscript(result);
      if (!transcript) {
        // An empty result can still carry speech_final on trailing silence.
        if (result?.speech_final) {
          flushPending(state, socketId, onFinalTranscript);
        }
        return;
      }

      if (transcript.isFinal) {
        // "is_final" only means this chunk of words is locked in — it is
        // NOT a sentence/utterance boundary and fires every few seconds
        // regardless of whether the speaker paused. Accumulate it instead
        // of broadcasting it as a standalone final line (which fragments
        // the transcript and the AI's context).
        state.pendingSegments.push(transcript.text);
        state.pendingConfidences.push(transcript.confidence);

        if (transcript.speechFinal) {
          flushPending(state, socketId, onFinalTranscript);
          return;
        }

        onInterimTranscript({
          speakerId: socketId,
          roomId: state.roomId,
          text: state.pendingSegments.join(' ').trim(),
          confidence: transcript.confidence,
          timestamp: Date.now(),
        });
        return;
      }

      // True interim: pending (locked) text + the still-changing tail.
      onInterimTranscript({
        speakerId: socketId,
        roomId: state.roomId,
        text: [...state.pendingSegments, transcript.text].join(' ').trim(),
        confidence: transcript.confidence,
        timestamp: Date.now(),
      });
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      if (state.closed) return;
      // Fires on trailing silence even when speech_final didn't — catches
      // utterances that end the call/turn without a further Results event.
      flushPending(state, socketId, onFinalTranscript);
    });

    connection.on(LiveTranscriptionEvents.Error, (error) => {
      if (!state.closed) {
        notifyError(socketId, error);
      }
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      if (state.closed) return;

      // Don't lose whatever was already locked in before the drop.
      flushPending(state, socketId, onFinalTranscript);

      // Queue (don't send) any audio arriving during the reconnect gap.
      state.isOpen = false;

      if (state.keepAliveTimer) {
        clearInterval(state.keepAliveTimer);
        state.keepAliveTimer = null;
      }

      if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const nextAttempt = state.reconnectAttempts + 1;
        notifyError(
          socketId,
          new Error(
            `Live transcription connection dropped — reconnecting (${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})…`
          )
        );
        state.reconnectTimer = setTimeout(() => {
          if (state.closed) return;
          const carriedAudio = state.queuedAudio;
          connections.delete(socketId);
          start({
            socketId,
            roomId: state.roomId,
            mimeType: state.mimeType,
            _reconnectAttempts: nextAttempt,
            _carriedAudio: carriedAudio,
          });
        }, RECONNECT_DELAY_MS);
      } else {
        notifyError(socketId, new Error('Live transcription connection lost and could not be restored.'));
        state.closed = true;
        connections.delete(socketId);
      }
    });

    return true;
  }

  function sendAudio(socketId, chunk) {
    const state = connections.get(socketId);
    if (!state || state.closed) return false;

    const audioChunk = normalizeAudioChunk(chunk);
    if (!audioChunk || audioChunk.length === 0) return false;

    if (!state.isOpen) {
      if (state.queuedAudio.length >= MAX_QUEUED_CHUNKS) {
        state.queuedAudio.shift();
        logger.warn(
          `[Deepgram] ${socketId}: audio buffer full before connection opened — dropping oldest chunk`
        );
      }

      state.queuedAudio.push(audioChunk);
      return true;
    }

    state.connection.send(audioChunk);
    return true;
  }

  function hasConnection(socketId) {
    return connections.has(socketId);
  }

  return {
    start,
    sendAudio,
    stop,
    hasConnection,
  };
}

module.exports = {
  createDeepgramTranscriptionManager,
};
