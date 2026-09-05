/**
 * MeetingRoom.jsx
 *
 * The main meeting page — orchestrates media, WebRTC, UI state, and controls.
 *
 * Flow:
 *  1. Parse roomId + ?init=true from URL
 *  2. Acquire local media (useMediaDevices)
 *  3. Emit 'create-room' (initiator) or 'join-room' (receiver) via Socket.io
 *  4. useWebRTC manages SimplePeer lifecycle and remote stream
 *  5. Render local + remote video, controls, waiting/error screens
 *  6. Handle leave: destroy peer, stop tracks, navigate home
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import VideoPlayer from '../components/VideoPlayer.jsx';
import Controls from '../components/Controls.jsx';
import WaitingScreen from '../components/WaitingScreen.jsx';
import Loader from '../components/Loader.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { useMediaDevices } from '../hooks/useMediaDevices.js';
import { useWebRTC, ConnectionStatus } from '../hooks/useWebRTC.js';
import { useMeetingTimer } from '../hooks/useMeetingTimer.js';
import { useDeepgramTranscription } from '../hooks/useDeepgramTranscription.js';
import { useInterviewAssistant } from '../hooks/useInterviewAssistant.js';
import { useToast } from '../context/ToastContext.jsx';
import DisclosureBanner from '../components/DisclosureBanner.jsx';
import InterviewSetup from '../components/InterviewSetup.jsx';
import AssistantPanel from '../components/AssistantPanel.jsx';
import InterviewCountdown from '../components/InterviewCountdown.jsx';
import InterviewReport from '../components/InterviewReport.jsx';
import socket from '../socket.js';
import { MdSignalWifiOff } from 'react-icons/md';
import { HiSignal, HiSignalSlash } from 'react-icons/hi2';
import { debugLog } from '../utils/debugLog.js';
import { getAuthToken } from '../utils/authToken.js';

// ── Connection status badge ────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const configs = {
    [ConnectionStatus.IDLE]: {
      color: 'text-slate-400',
      bg: 'bg-slate-500/20 border-slate-500/30',
      dot: 'bg-slate-400',
      label: 'Idle',
    },
    [ConnectionStatus.CONNECTING]: {
      color: 'text-amber-300',
      bg: 'bg-amber-500/20 border-amber-500/30',
      dot: 'bg-amber-400 animate-pulse',
      label: 'Connecting...',
    },
    [ConnectionStatus.WAITING]: {
      color: 'text-blue-300',
      bg: 'bg-blue-500/20 border-blue-500/30',
      dot: 'bg-blue-400 animate-pulse',
      label: 'Waiting for participant...',
    },
    [ConnectionStatus.CONNECTED]: {
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/20 border-emerald-500/30',
      dot: 'bg-emerald-400',
      label: 'Connected',
    },
    [ConnectionStatus.DISCONNECTED]: {
      color: 'text-red-300',
      bg: 'bg-red-500/20 border-red-500/30',
      dot: 'bg-red-400',
      label: 'Disconnected',
    },
    [ConnectionStatus.ERROR]: {
      color: 'text-red-300',
      bg: 'bg-red-500/20 border-red-500/30',
      dot: 'bg-red-400',
      label: 'Error',
    },
  };

  const cfg = configs[status] || configs[ConnectionStatus.IDLE];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border glass text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  );
}

function TranscriptPanel({
  finalTranscripts,
  interimTranscript,
  transcriptionError,
  isTranscribing,
  participantId,
}) {
  const hasTranscripts = finalTranscripts.length > 0 || interimTranscript;

  if (!hasTranscripts && !transcriptionError && !isTranscribing) {
    return null;
  }

  return (
    <section className="w-full max-w-6xl mx-auto px-4 pb-3">
      <div className="glass rounded-2xl border border-white/10 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-white/90">Live transcript</h2>
          <span
            className={`
              text-[11px] px-2 py-1 rounded-full border
              ${isTranscribing
                ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                : 'text-slate-400 border-white/10 bg-white/5'
              }
            `}
          >
            {isTranscribing ? 'Listening' : 'Paused'}
          </span>
        </div>

        {transcriptionError && (
          <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
            {transcriptionError}
          </p>
        )}

        <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
          {finalTranscripts.map((item, index) => (
            <p key={item.id || `${item.speakerId}-${item.timestamp}-${index}`} className="text-sm text-slate-200">
              <span className="font-semibold text-violet-300">
                {item.speakerParticipantId === participantId ? 'You' : 'Participant'}:
              </span>{' '}
              {item.text}
            </p>
          ))}

          {interimTranscript && (
            <p className="text-sm text-slate-400 italic">
              <span className="font-semibold text-violet-300 not-italic">You:</span>{' '}
              {interimTranscript}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// A stable identity for this participant, independent of the ephemeral
// Socket.io `socket.id` (which changes on every reconnect). Persisted in
// sessionStorage (survives a page refresh in this tab, cleared when the tab
// closes) so the server can recognize "same participant, new socket" and
// let them reclaim their interview role instead of being treated as a
// brand-new joiner. Keyed per-room so distinct meetings don't collide.
function getOrCreateParticipantId(roomId) {
  const key = `peermeet:participantId:${roomId}`;
  const makeId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = makeId();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (e.g. some private-browsing modes) — the
    // meeting still works, it just won't survive a refresh as the same
    // participant.
    return makeId();
  }
}

function MeetingRoom() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Determine if this user is the meeting creator (initiator)
  const isInitiator = searchParams.get('init') === 'true';

  // Stable across reconnects/refreshes — see getOrCreateParticipantId above.
  const participantId = useMemo(() => getOrCreateParticipantId(roomId), [roomId]);

  // Track whether we've already registered with the server
  const hasJoinedRef = useRef(false);

  // Room rejection states
  const [roomError, setRoomError] = useState(null); // 'full' | 'not-found'
  const [remoteJoined, setRemoteJoined] = useState(false);
  const [canTranscribe, setCanTranscribe] = useState(false);

  // ── Media Devices ──────────────────────────────────────────────────────────
  // `localStream` is the VIDEO source (camera or, while sharing, the
  // screen) — used for the local preview and WebRTC. `micStream` is always
  // the original camera+mic stream regardless of screen sharing — it must
  // be what live transcription reads from, or transcription silently dies
  // the moment screen share starts (the display stream has no audio track).
  const {
    stream: localStream,
    micStream,
    isLoading: mediaLoading,
    error: mediaError,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    stopStream,
    retry: retryMedia,
  } = useMediaDevices();

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  const {
    remoteStream,
    connectionStatus,
    peerError,
    replaceVideoTrack,
    destroyPeer,
  } = useWebRTC({ localStream, roomId, isInitiator });

  // ── Meeting Timer (starts when connected) ──────────────────────────────────
  const isConnected = connectionStatus === ConnectionStatus.CONNECTED;
  const { formatted: timerFormatted } = useMeetingTimer(isConnected);

  // ── Live Transcription ─────────────────────────────────────────
  const {
    interimTranscript,
    finalTranscripts,
    transcriptionError,
    isTranscribing,
    startTranscription,
    stopTranscription,
  } = useDeepgramTranscription({
    micStream,
    roomId,
    participantId,
    isAudioEnabled,
    isEnabled: Boolean(micStream && canTranscribe && !roomError),
  });

  // ── AI Interview Assistant (disclosed) ─────────────────────────────────────
  const {
    role,
    config: interviewConfig,
    phase,
    aiAssisted,
    isInterviewer,
    recommendation,
    evaluation,
    tracking,
    summary,
    deadline,
    ended,
    endedReason,
    turnReport,
    configure,
    start: startInterview,
    switchRoles,
    endInterview,
    dismissTurnReport,
  } = useInterviewAssistant({ roomId });

  // Show the setup modal to the creator once the partner has joined.
  const [showSetup, setShowSetup] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);

  const handleSubmitSetup = useCallback(
    (cfg) => {
      configure(cfg);
      startInterview();
      setShowSetup(false);
      addToast('AI-assisted interview started', 'success');
    },
    [configure, startInterview, addToast]
  );

  const handleSkipSetup = useCallback(() => {
    setShowSetup(false);
    setSetupDismissed(true);
  }, []);

  // ── Register with signaling server once local stream is ready ─────────────
  // Always try join-room first — the server treats a matching participantId
  // as a reconnect (reclaiming the same slot/interview role) rather than a
  // fresh join. If the room genuinely doesn't exist yet, 'room-not-found'
  // falls back to create-room below (only if we expect to be the creator).
  useEffect(() => {
    if (!localStream || hasJoinedRef.current) return;

    hasJoinedRef.current = true;
    debugLog('[MeetingRoom] Emitting join-room:', roomId, 'participantId:', participantId);
    socket.emit('join-room', { roomId, participantId, token: getAuthToken() });
  }, [localStream, roomId, participantId]);

  // ── Socket event listeners for room state ─────────────────────────────────
  useEffect(() => {
    const handleRoomCreated = ({ roomId: id }) => {
      debugLog('[MeetingRoom] Room created:', id);
      setCanTranscribe(true);
    };

    const handleReady = () => {
      setCanTranscribe(true);
    };

    const handleUserJoined = () => {
      setRemoteJoined(true);
      addToast('A participant has joined the meeting!', 'success');
      // Only the creator (initiator) sees the interview setup modal, and only
      // if they haven't already dismissed or completed it.
      if (isInitiator && !setupDismissed) {
        setShowSetup(true);
      }
    };

    const handleUserLeft = () => {
      setRemoteJoined(false);
      addToast('Participant has left the meeting.', 'warning', 5000);
    };

    const handleRoomFull = ({ reason } = {}) => {
      // A duplicate tab (sessionStorage is copied into duplicated/target=_blank
      // tabs, so it carries the same participantId) is rejected rather than
      // silently stealing the original tab's slot — see roomManager.joinRoom.
      if (reason === 'duplicate-session') {
        setRoomError('duplicate');
        setCanTranscribe(false);
        addToast('This meeting is already open in another tab.', 'error', 0);
        return;
      }
      setRoomError('full');
      setCanTranscribe(false);
      addToast('This room is full (max 2 participants).', 'error', 0);
    };

    const handleRoomNotFound = () => {
      // join-room found nothing. If we expect to be the creator, this is a
      // truly fresh room (or one both participants fully abandoned) —
      // create it. Otherwise it's a genuinely bad/expired room ID.
      if (isInitiator) {
        debugLog('[MeetingRoom] Room not found — creating fresh as initiator');
        socket.emit('create-room', { roomId, participantId, token: getAuthToken() });
        return;
      }
      setRoomError('not-found');
      setCanTranscribe(false);
      addToast('Meeting room not found.', 'error', 0);
    };

    const handleRoomExists = () => {
      // Lost a create-vs-join race (e.g. duplicate tab) — the room exists
      // now, so join it instead.
      debugLog('[MeetingRoom] Room already exists — joining instead');
      socket.emit('join-room', { roomId, participantId, token: getAuthToken() });
    };

    socket.on('room-created', handleRoomCreated);
    socket.on('ready', handleReady);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('room-full', handleRoomFull);
    socket.on('room-not-found', handleRoomNotFound);
    socket.on('room-exists', handleRoomExists);

    return () => {
      socket.off('room-created', handleRoomCreated);
      socket.off('ready', handleReady);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('room-full', handleRoomFull);
      socket.off('room-not-found', handleRoomNotFound);
      socket.off('room-exists', handleRoomExists);
    };
  }, [addToast, isInitiator, setupDismissed, roomId, participantId]);

  // ── Notify when connected ──────────────────────────────────────────────────
  useEffect(() => {
    if (connectionStatus === ConnectionStatus.CONNECTED) {
      addToast('Connected! Enjoy your meeting.', 'success');
    }
  }, [connectionStatus, addToast]);

  // ── Notify when the interview ends (manual or time-expiry) ────────────────
  useEffect(() => {
    if (!ended) return;
    if (endedReason === 'time-expired') {
      addToast('Time is up — the interview has ended. Generating report…', 'info', 5000);
    } else {
      addToast('The interview has ended.', 'info');
    }
  }, [ended, endedReason, addToast]);

  // ── Screen Share toggle ────────────────────────────────────────────────────
  const handleToggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      const oldStream = localStream;
      const screenStream = await startScreenShare();

      if (screenStream && oldStream) {
        // Replace the video track in the peer connection (no renegotiation needed)
        replaceVideoTrack(oldStream, screenStream);
        addToast('Screen sharing started', 'info');
      }
    } else {
      const oldStream = localStream;
      const cameraStream = stopScreenShare();

      if (cameraStream && oldStream) {
        replaceVideoTrack(oldStream, cameraStream);
        addToast('Screen sharing stopped', 'info');
      }
    }
  }, [
    isScreenSharing,
    localStream,
    startScreenShare,
    stopScreenShare,
    replaceVideoTrack,
    addToast,
  ]);

  // ── Leave meeting ──────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    // 1. Destroy the WebRTC peer connection
    destroyPeer();
    // 2. Stop all local media tracks
    stopStream();
    // 3. Disconnect socket (triggers server-side cleanup + user-left for partner)
    socket.disconnect();
    // 4. Navigate home
    navigate('/');
  }, [destroyPeer, stopStream, navigate]);

  // Reconnect socket on next visit (in case we disconnected)
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
    return () => {
      // Don't disconnect on unmount if still on route;
      // handleLeave does explicit disconnect
    };
  }, []);

  // ── Recover from a Socket.IO reconnect ─────────────────────────────────────
  // A reconnect issues a brand-new socket.id, which orphans this room's
  // server-side signaling membership (roomManager) and its Deepgram stream
  // (keyed by socket.id). Rejoin the room and re-arm transcription so a
  // transient network drop doesn't silently kill the call/transcript.
  // `socket.js` connects eagerly at module load and this SPA navigates
  // Home → MeetingRoom without a page reload, so the socket is frequently
  // ALREADY connected by the time this component mounts. Seeding the ref
  // from the current connection state (rather than always `false`) ensures
  // the next 'connect' event is correctly recognized as a reconnect instead
  // of being misclassified as the initial connect and silently skipped.
  const wasEverConnectedRef = useRef(socket.connected);
  useEffect(() => {
    const handleConnect = () => {
      if (!wasEverConnectedRef.current) {
        wasEverConnectedRef.current = true;
        return;
      }

      debugLog('[MeetingRoom] Socket reconnected — rejoining room:', roomId);
      destroyPeer();
      setRemoteJoined(false);
      // Our stable participantId lets the server recognize this as a
      // reconnect (reclaiming our interview role) rather than a fresh
      // join; it falls back to 'room-not-found' → create-room (handled by
      // the existing listener) if the room was fully abandoned.
      socket.emit('join-room', { roomId, participantId, token: getAuthToken() });

      stopTranscription();
      if (isAudioEnabled) {
        startTranscription();
      }
    };

    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [roomId, participantId, destroyPeer, stopTranscription, startTranscription, isAudioEnabled]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Fatal room error
  if (roomError) {
    const msg =
      roomError === 'full'
        ? 'This room is full. A maximum of 2 participants are allowed per meeting.'
        : roomError === 'duplicate'
        ? 'This meeting is already open in another tab of this browser. Switch to that tab, or use a different browser or a private window to join as the second participant.'
        : 'Meeting room not found. The ID may be incorrect or the room may have expired.';

    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center pt-16 px-4">
          <div className="glass-strong rounded-3xl p-8 md:p-12 max-w-md w-full">
            <ErrorMessage
              message={msg}
              type={roomError === 'full' || roomError === 'duplicate' ? 'warning' : 'error'}
            />
          </div>
        </div>
      </div>
    );
  }

  // Media permission / device error
  if (mediaError && !localStream) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center pt-16 px-4">
          <div className="glass-strong rounded-3xl p-8 md:p-12 max-w-md w-full">
            <ErrorMessage
              message={mediaError}
              type="error"
              onRetry={retryMedia}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-dark-900">
      <Navbar showTimer timerFormatted={timerFormatted} />

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col pt-16">
        {/* ── Status bar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-3 py-3 px-4">
          <StatusBadge status={connectionStatus} />
          {peerError && (
            <span className="text-xs text-red-400 glass px-2 py-1 rounded-lg">
              {peerError}
            </span>
          )}
        </div>

        {/* ── AI disclosure banner (both participants) ───────────────────── */}
        {aiAssisted && <DisclosureBanner role={role} phase={phase} />}

        {/* ── Interview countdown (both participants) ────────────────────── */}
        {deadline && !ended && (
          <div className="flex justify-center pt-2">
            <InterviewCountdown deadline={deadline} />
          </div>
        )}

        {/* ── Video grid (+ interviewer assistant panel) ─────────────────── */}
        <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-center gap-4 px-4 pb-2">
          {mediaLoading ? (
            // Loading spinner while acquiring media
            <div className="glass-strong rounded-3xl p-12">
              <Loader />
            </div>
          ) : (
            <div
              className={`
                w-full max-w-6xl
                ${remoteStream
                  ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                  : 'flex items-center justify-center'
                }
              `}
            >
              {/* ── Remote video ──────────────────────────────────────── */}
              {remoteStream ? (
                <div className="relative w-full">
                  <VideoPlayer
                    stream={remoteStream}
                    muted={false}
                    label="Participant"
                    isAudioEnabled={true}
                    isVideoEnabled={true}
                    isLocal={false}
                    animate={true}
                    className="w-full"
                  />
                </div>
              ) : null}

              {/* ── Local video ───────────────────────────────────────── */}
              <div
                className={`
                  relative
                  ${!remoteStream ? 'w-full max-w-2xl' : 'w-full'}
                `}
              >
                <VideoPlayer
                  stream={localStream}
                  muted={true}
                  label="You"
                  isAudioEnabled={isAudioEnabled}
                  isVideoEnabled={isVideoEnabled}
                  isLocal={true}
                  isScreenShare={isScreenSharing}
                  className="w-full"
                />

                {/* Waiting overlay — shown until partner joins */}
                {!remoteStream && connectionStatus === ConnectionStatus.WAITING && (
                  <WaitingScreen roomId={roomId} />
                )}

                {/* Disconnected overlay */}
                {connectionStatus === ConnectionStatus.DISCONNECTED && remoteJoined && (
                  <div className="absolute inset-0 flex items-center justify-center glass-dark rounded-2xl">
                    <div className="text-center p-6">
                      <HiSignalSlash className="text-5xl text-red-400 mx-auto mb-3" />
                      <p className="text-white font-semibold">Participant disconnected</p>
                      <p className="text-slate-400 text-sm mt-1">They may rejoin using the same link</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Interviewer-only AI panel — never mounted for candidates */}
          {!mediaLoading && isInterviewer && (
            <AssistantPanel
              recommendation={recommendation}
              evaluation={evaluation}
              tracking={tracking}
              summary={summary}
              config={interviewConfig}
              onSwitchRoles={switchRoles}
              onEndInterview={endInterview}
            />
          )}
        </div>

        {/* ── Controls bar ──────────────────────────────────────────────── */}
        <TranscriptPanel
          finalTranscripts={finalTranscripts}
          interimTranscript={interimTranscript}
          transcriptionError={transcriptionError}
          isTranscribing={isTranscribing}
          participantId={participantId}
        />

        {!mediaLoading && (
          <div className="sticky bottom-0 glass-dark border-t border-white/5 px-4">
            <Controls
              isAudioEnabled={isAudioEnabled}
              isVideoEnabled={isVideoEnabled}
              isScreenSharing={isScreenSharing}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onToggleScreenShare={handleToggleScreenShare}
              onLeave={handleLeave}
            />
          </div>
        )}
      </main>

      {/* ── Interview setup modal (creator only) ─────────────────────────── */}
      {showSetup && (
        <InterviewSetup onSubmit={handleSubmitSetup} onSkip={handleSkipSetup} />
      )}

      {/* ── Turn report modal (shown to whoever was just interviewed) ────── */}
      {turnReport && (
        <InterviewReport
          report={turnReport}
          isFinal={Boolean(turnReport.__final)}
          onClose={dismissTurnReport}
        />
      )}
    </div>
  );
}

export default MeetingRoom;
