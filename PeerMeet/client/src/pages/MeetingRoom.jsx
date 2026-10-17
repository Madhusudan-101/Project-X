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
import ReportDialog from '../components/ReportDialog.jsx';
import SidePanel from '../components/SidePanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ParticipantsPanel from '../components/ParticipantsPanel.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useChat } from '../hooks/useChat.js';
import { endCountdown, nextWarning, parseUntil } from '../utils/scheduledEnd.js';
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
import ReadyScreen from '../components/ReadyScreen.jsx';
import SessionEnded from '../components/SessionEnded.jsx';
import InterviewerOnboarding from '../components/InterviewerOnboarding.jsx';
import CandidateNote from '../components/CandidateNote.jsx';
import { parseStart } from '../utils/precall.js';
import { loadLobby, saveLobby } from '../utils/lobbyPrefs.js';
import AssistantPanel from '../components/AssistantPanel.jsx';
import InterviewCountdown from '../components/InterviewCountdown.jsx';
import InterviewReport from '../components/InterviewReport.jsx';
import socket from '../socket.js';
import { MdSignalWifiOff } from 'react-icons/md';
import { HiSignal, HiSignalSlash } from 'react-icons/hi2';
import { debugLog } from '../utils/debugLog.js';
import { getAuthToken, getIdentityPrivate } from '../utils/authToken.js';

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

/** Live captions, shown in the side panel. Auto-scrolls, keeps only the latest lines. */
function CaptionsView({
  finalTranscripts,
  interimTranscript,
  transcriptionError,
  isTranscribing,
  canTranscribe,
  participantId,
  partnerName,
}) {
  const endRef = useRef(null);
  const lines = finalTranscripts.slice(-200);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lines.length, interimTranscript]);

  if (!canTranscribe) {
    return (
      <p className="p-4 text-sm text-slate-400">
        Live captions are off for this meeting. You can turn them on next time in the lobby before you join.
      </p>
    );
  }
  return (
    <div className="p-3 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">Live captions</h3>
        <span className={`text-[11px] px-2 py-1 rounded-full border ${isTranscribing ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-400 border-white/10 bg-white/5'}`}>
          {isTranscribing ? 'Listening' : 'Paused'}
        </span>
      </div>
      {transcriptionError && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{transcriptionError}</p>
      )}
      {lines.length === 0 && !interimTranscript && <p className="text-sm text-slate-500">Captions appear here as people speak.</p>}
      {lines.map((item, index) => (
        <p key={item.id || `${item.speakerId}-${item.timestamp}-${index}`} className="text-sm text-slate-200">
          <span className="font-semibold text-violet-300">
            {item.speakerParticipantId === participantId ? 'You' : partnerName || 'Participant'}:
          </span>{' '}
          {item.text}
        </p>
      ))}
      {interimTranscript && (
        <p className="text-sm text-slate-400 italic">
          <span className="font-semibold text-violet-300 not-italic">You:</span> {interimTranscript}
        </p>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
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
  const [showReport, setShowReport] = useState(false);
  const [panel, setPanel] = useState(null); // null | 'chat' | 'people' | 'captions'
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Which video is large: the partner (default) or yourself.
  const [pinned, setPinned] = useState('remote');
  const [remoteMedia, setRemoteMedia] = useState({ audio: true, video: true });
  // Dashboard meetings pass their scheduled end (?until=<ms>); we show the time left and warn, never cut off.
  const until = useMemo(() => parseUntil(searchParams.get('until')), [searchParams]);
  // A meeting booked on the dashboard carries its end (and start) time; a plain instant match does not.
  const isScheduled = until !== null;
  const startMs = useMemo(() => parseStart(searchParams.get('start')), [searchParams]);
  const [now, setNow] = useState(() => Date.now());
  const lastWarningRef = useRef(null);
  const [roomError, setRoomError] = useState(null); // 'full' | 'not-found'
  const [remoteJoined, setRemoteJoined] = useState(false);
  // The Ready screen's state from the server, and what the browser keeps beside it.
  const [precall, setPrecall] = useState(null); // { phase, me, partner, deadlineAt, consentVersion } | null
  const [precallError, setPrecallError] = useState(null);
  const [devices, setDevices] = useState(() => loadLobby(roomId) || { cameraId: null, micId: null });
  const [sessionEnd, setSessionEnd] = useState(null); // 'declined' | 'cancelled' | 'timeout' | 'no-show'
  const [noShowMessage, setNoShowMessage] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mediaAnnounce, setMediaAnnounce] = useState(0);
  // The call itself (camera, microphone, video, captions) only exists once the server says the session is live.
  const live = precall?.phase === 'live';
  const isHost = precall?.me?.host === true;
  const canTranscribe = live;
  // Peer's display name — either their real name or "Anonymous Candidate"
  // depending on THEIR own privacy preference. Server-authoritative; we
  // don't try to derive it client-side.
  const [partnerDisplayName, setPartnerDisplayName] = useState('Participant');

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
    setOnScreenShareEnded,
    stopStream,
    retry: retryMedia,
  } = useMediaDevices({ cameraId: devices.cameraId, micId: devices.micId, enabled: live });

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  const {
    remoteStream,
    connectionStatus,
    peerError,
    replaceVideoTrack,
    destroyPeer,
  } = useWebRTC({ localStream, roomId, isInitiator });

  const chat = useChat(socket, roomId, panel === 'chat');

  // Tell the partner whether my mic/camera are on (and again when they arrive), and learn theirs.
  useEffect(() => {
    if (!remoteJoined) return;
    socket.emit('media-state', { roomId, audio: isAudioEnabled, video: isVideoEnabled });
  }, [remoteJoined, roomId, isAudioEnabled, isVideoEnabled]);
  useEffect(() => {
    const onState = ({ audio, video } = {}) => setRemoteMedia({ audio: audio !== false, video: video !== false });
    socket.on('media-state', onState);
    return () => socket.off('media-state', onState);
  }, []);

  // Scheduled end: tick every 15 seconds, warn once at 5 min, 1 min and when over.
  useEffect(() => {
    if (!until) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [until]);
  useEffect(() => {
    const w = nextWarning(until, now, lastWarningRef.current);
    if (w) {
      lastWarningRef.current = w.key;
      addToast(w.text, 'warning', 8000);
    }
  }, [until, now, addToast]);
  const countdown = endCountdown(until, now);

  // When the browser's own "Stop sharing" button ends a share, swap the camera back into the call.
  useEffect(() => {
    setOnScreenShareEnded((screenStream, cameraStream) => {
      replaceVideoTrack(screenStream, cameraStream);
      addToast('Screen sharing stopped', 'info');
    });
    return () => setOnScreenShareEnded(null);
  }, [setOnScreenShareEnded, replaceVideoTrack, addToast]);

  // Is our connection to the meeting server up? Shown as a banner so a drop is never silent.
  const [socketOnline, setSocketOnline] = useState(socket.connected);
  useEffect(() => {
    // The connection may have come back between the first render and this effect, and that "connect" event
    // is gone by now: read the real state once so the banner (and anything waiting on it) cannot stay stuck.
    setSocketOnline(socket.connected);
    const up = () => setSocketOnline(true);
    const down = (reason) => {
      if (reason !== 'io client disconnect') setSocketOnline(false);
    };
    socket.on('connect', up);
    socket.on('disconnect', down);
    return () => {
      socket.off('connect', up);
      socket.off('disconnect', down);
    };
  }, []);

  // ── Meeting Timer ─────────────────────────────────────────────────────────
  // Starts only when BOTH participants are in the room (server's user-joined/
  // ready is the source of truth via `remoteJoined`) AND our own media is
  // ready. Sitting alone in the room keeps the timer at 00:00.
  // useMeetingTimer preserves elapsed across pause/resume, so a partner's
  // transient drop + rejoin doesn't reset the clock.
  const isConnected = connectionStatus === ConnectionStatus.CONNECTED;
  const isMeetingLive = remoteJoined && Boolean(localStream);
  const { formatted: timerFormatted } = useMeetingTimer(isMeetingLive);

  // Track whether we have ever paired in this session, so the waiting-state
  // copy can distinguish first-wait from rejoin-wait.
  const [everPaired, setEverPaired] = useState(false);
  useEffect(() => {
    if (remoteJoined) setEverPaired(true);
  }, [remoteJoined]);

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

  // The person who started the meeting sets the interview up once both cameras are on.
  useEffect(() => {
    if (live && remoteJoined && isHost && !aiAssisted && !setupDismissed && !ended) setShowSetup(true);
  }, [live, remoteJoined, isHost, aiAssisted, setupDismissed, ended]);

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

  // ── Register with the meeting server as soon as the page opens ────────────
  // Joining only puts you on the Ready screen: no camera, microphone or video is involved until the
  // server says the session is live. A matching participantId makes this a reconnect (same slot, same
  // answers) rather than a fresh join. If the room genuinely does not exist yet, 'room-not-found' falls
  // back to create-room below (only if we expect to be the creator).
  useEffect(() => {
    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    debugLog('[MeetingRoom] Emitting join-room:', roomId, 'participantId:', participantId);
    socket.emit('join-room', {
      roomId,
      participantId,
      token: getAuthToken(),
      keepPrivate: getIdentityPrivate(),
    });
  }, [roomId, participantId]);

  // Once the session is live and our camera and microphone are on, tell the server so the two of us can
  // be paired for video. Sent again after any new live state (for example after a reconnect).
  useEffect(() => {
    if (live && localStream && socket.connected) socket.emit('session:media-ready', { roomId });
  }, [live, localStream, roomId, mediaAnnounce, socketOnline]);

  // ── Socket event listeners for room state ─────────────────────────────────
  useEffect(() => {
    const handleRoomCreated = ({ roomId: id }) => {
      debugLog('[MeetingRoom] Room created:', id);
    };

    const handleReady = ({ initiatorId, partnerDisplayName: pdn } = {}) => {
      // `ready` is delivered when the server knows who our partner is —
      // for a fresh second-participant join, this is the moment BOTH
      // participants exist in the room, so it's the authoritative signal
      // to start the meeting clock. Guarded on initiatorId so a lone
      // reconnect (partner slot exists but is disconnected → initiatorId
      // is null) does not falsely mark the peer as present.
      if (initiatorId) {
        setRemoteJoined(true);
        if (pdn) setPartnerDisplayName(pdn);
      }
    };

    const handleUserJoined = ({ partnerDisplayName: pdn } = {}) => {
      setRemoteJoined(true);
      if (pdn) setPartnerDisplayName(pdn);
      addToast('A participant has joined the meeting!', 'success');
    };

    const handleUserLeft = () => {
      setRemoteJoined(false);
      setPartnerDisplayName('Participant');
      addToast('Participant has left the meeting.', 'warning', 5000);
    };

    const handleRoomFull = ({ reason } = {}) => {
      // A duplicate tab (sessionStorage is copied into duplicated/target=_blank
      // tabs, so it carries the same participantId) is rejected rather than
      // silently stealing the original tab's slot — see roomManager.joinRoom.
      if (reason === 'duplicate-session') {
        setRoomError('duplicate');
        addToast('This meeting is already open in another tab.', 'error', 0);
        return;
      }
      setRoomError('full');
      addToast('This room is full (max 2 participants).', 'error', 0);
    };

    const handleRoomNotFound = () => {
      // join-room found nothing. If we expect to be the creator, this is a
      // truly fresh room (or one both participants fully abandoned) —
      // create it. Otherwise it's a genuinely bad/expired room ID.
      if (isInitiator) {
        debugLog('[MeetingRoom] Room not found — creating fresh as initiator');
        socket.emit('create-room', {
          roomId,
          participantId,
          token: getAuthToken(),
          keepPrivate: getIdentityPrivate(),
        });
        return;
      }
      setRoomError('not-found');
      addToast('Meeting room not found.', 'error', 0);
    };

    const handleAuthError = ({ reason } = {}) => {
      // The server refused us entry: our token is for another room, missing, or invalid.
      setRoomError(reason === 'token-required' ? 'auth-required' : 'auth');
      addToast('You are not allowed in this meeting.', 'error', 0);
    };

    const handleInterviewError = ({ reason } = {}) => {
      const text = {
        'consent-required': 'AI feedback needs both people to have said Yes. You can still talk without it.',
        'setup-locked': 'The setup was already submitted, so it cannot be changed.',
        'not-host': 'Only the person who started the meeting can set it up.',
        'already-started': 'The session already started, so the setup is locked.',
      }[reason];
      if (text) addToast(text, 'warning', 6000);
    };

    // ── The Ready screen, driven by the server ──────────────────────────────
    const handlePrecallState = (state) => {
      setPrecall(state);
      setPrecallError(null);
      if (state.phase === 'cancelled') setSessionEnd((cur) => cur || 'cancelled');
      if (state.phase === 'live') setMediaAnnounce((n) => n + 1);
    };
    const handlePrecallError = ({ reason } = {}) => setPrecallError(reason || 'unknown');
    const handleGo = () => setPrecall((cur) => (cur ? { ...cur, phase: 'live' } : cur));
    const handleCancelled = ({ self, reason } = {}) => {
      setSessionEnd(self ? 'declined' : reason === 'timeout' ? 'timeout' : 'cancelled');
    };
    const handleNoShowMarked = () => setSessionEnd('no-show');
    const handleNoShowError = ({ message } = {}) => setNoShowMessage(message || 'Could not do that right now. Try again.');
    const handleOnboarding = () => setShowOnboarding(true);

    const handleRoomExists = () => {
      // Lost a create-vs-join race (e.g. duplicate tab) — the room exists
      // now, so join it instead.
      debugLog('[MeetingRoom] Room already exists — joining instead');
      socket.emit('join-room', {
        roomId,
        participantId,
        token: getAuthToken(),
        keepPrivate: getIdentityPrivate(),
      });
    };

    socket.on('precall:state', handlePrecallState);
    socket.on('precall:error', handlePrecallError);
    socket.on('session:go', handleGo);
    socket.on('session:cancelled', handleCancelled);
    socket.on('no-show:marked', handleNoShowMarked);
    socket.on('no-show:error', handleNoShowError);
    socket.on('onboarding:interviewer', handleOnboarding);
    socket.on('room-created', handleRoomCreated);
    socket.on('ready', handleReady);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('room-full', handleRoomFull);
    socket.on('room-not-found', handleRoomNotFound);
    socket.on('room-exists', handleRoomExists);
    socket.on('auth-error', handleAuthError);
    socket.on('interview:error', handleInterviewError);

    return () => {
      socket.off('precall:state', handlePrecallState);
      socket.off('precall:error', handlePrecallError);
      socket.off('session:go', handleGo);
      socket.off('session:cancelled', handleCancelled);
      socket.off('no-show:marked', handleNoShowMarked);
      socket.off('no-show:error', handleNoShowError);
      socket.off('onboarding:interviewer', handleOnboarding);
      socket.off('auth-error', handleAuthError);
      socket.off('interview:error', handleInterviewError);
      socket.off('room-created', handleRoomCreated);
      socket.off('ready', handleReady);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('room-full', handleRoomFull);
      socket.off('room-not-found', handleRoomNotFound);
      socket.off('room-exists', handleRoomExists);
    };
  }, [addToast, isInitiator, roomId, participantId]);

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
    // 3. Tell the server we are LEAVING (frees our slot at once and tells the partner), then
    //    disconnect. A bare disconnect is treated as a dropped connection and keeps the slot reserved.
    socket.emit('leave-room', { roomId });
    socket.disconnect();
    // 4. Show the "you left" screen (feedback, rejoin) instead of dropping straight to the home page
    navigate(`/left/${encodeURIComponent(roomId)}`);
  }, [destroyPeer, stopStream, navigate, roomId]);

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
      socket.emit('join-room', {
        roomId,
        participantId,
        token: getAuthToken(),
        keepPrivate: getIdentityPrivate(),
      });

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
        : roomError === 'auth' || roomError === 'auth-required'
        ? 'You are not allowed in this meeting. Open it again from your Mirracle dashboard so your invitation is checked.'
        : 'Meeting room not found. The ID may be incorrect or the room may have expired.';

    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center pt-16 px-4">
          <div className="glass-strong rounded-3xl p-8 md:p-12 max-w-md w-full">
            <ErrorMessage
              message={msg}
              type={roomError === 'full' || roomError === 'duplicate' || roomError === 'auth' || roomError === 'auth-required' ? 'warning' : 'error'}
            />
          </div>
        </div>
      </div>
    );
  }

  const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL;
  const backToDashboard = (() => {
    try {
      return dashboardUrl ? new URL('/candidate', dashboardUrl).toString() : null;
    } catch {
      return null;
    }
  })();

  // The session ended before it began: a No, a timeout, or a no-show.
  if (sessionEnd) {
    return (
      <SessionEnded
        kind={sessionEnd}
        backHref={backToDashboard}
        onBack={() => navigate('/')}
      />
    );
  }

  // The Ready screen: nothing is sent between the two of you until you have both said Yes and clicked Ready.
  if (!live) {
    return (
      <ReadyScreen
        roomId={roomId}
        state={precall}
        error={precallError}
        online={socketOnline}
        isPrivate={getIdentityPrivate()}
        isScheduled={isScheduled}
        startMs={startMs}
        noShowMessage={noShowMessage}
        onConsent={(answer) => {
          setPrecallError(null);
          socket.emit('precall:consent', { roomId, answer, version: precall?.consentVersion });
        }}
        onReady={(chosen) => {
          setDevices(chosen);
          saveLobby(roomId, chosen);
          setPrecallError(null);
          socket.emit('precall:ready', { roomId, devicesOk: true });
        }}
        onNoShow={() => {
          setNoShowMessage(null);
          socket.emit('no-show:mark', { roomId });
        }}
        onLeave={() => {
          socket.emit('leave-room', { roomId });
          socket.disconnect();
          if (backToDashboard) window.location.assign(backToDashboard);
          else navigate('/');
        }}
      />
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

        {!socketOnline && (
          <div role="status" aria-live="polite" className="mx-4 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-200">
            Connection to the meeting server lost. Reconnecting… your call will resume when it is back.
          </div>
        )}

        {countdown && (
          <div className="flex justify-center pb-1">
            <span
              className={`text-xs px-3 py-1 rounded-full border ${countdown.over ? 'text-amber-200 border-amber-500/40 bg-amber-500/10' : countdown.minutesLeft <= 5 ? 'text-amber-200 border-amber-500/30 bg-amber-500/10' : 'text-slate-300 border-white/10 bg-white/5'}`}
              role="timer"
              aria-label={`Scheduled time: ${countdown.label}`}
            >
              {countdown.label}
            </span>
          </div>
        )}

        {/* ── AI disclosure banner (both participants) ───────────────────── */}
        {aiAssisted && <DisclosureBanner role={role} phase={phase} />}

        {/* ── A short note for the person being interviewed ───────────────── */}
        {aiAssisted && role === 'candidate' && !ended && <CandidateNote />}

        {/* ── Interview countdown (both participants) ────────────────────── */}
        {deadline && !ended && (
          <div className="flex justify-center pt-2">
            <InterviewCountdown deadline={deadline} />
          </div>
        )}

        {/* ── Stage: the big video, your picture-in-picture, and the side panel ───────── */}
        <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-center gap-4 px-4 pb-2">
          {mediaLoading ? (
            <div className="glass-strong rounded-3xl p-12">
              <Loader />
            </div>
          ) : (
            <div className="relative w-full max-w-5xl" data-testid="stage">
              {(() => {
                const remoteTile = (
                  <VideoPlayer
                    stream={remoteStream}
                    muted={false}
                    label={partnerDisplayName || 'Participant'}
                    isAudioEnabled={remoteMedia.audio}
                    isVideoEnabled={remoteMedia.video}
                    isLocal={false}
                    animate={true}
                    className="w-full"
                  />
                );
                const localTile = (
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
                );
                // Alone in the room, or the partner's video has not arrived yet: you are the big tile.
                const showRemote = Boolean(remoteStream);
                const bigIsRemote = showRemote && pinned === 'remote';
                return (
                  <>
                    <div className="relative w-full">
                      {bigIsRemote ? remoteTile : localTile}
                      {!remoteJoined && <WaitingScreen roomId={roomId} reconnecting={everPaired} />}
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
                    {showRemote && (
                      <div className="absolute bottom-3 right-3 z-10 w-36 sm:w-52 shadow-xl">
                        <button
                          type="button"
                          onClick={() => setPinned(bigIsRemote ? 'local' : 'remote')}
                          aria-label={bigIsRemote ? 'Make your video the large one' : 'Make your partner the large video'}
                          className="absolute top-1 left-1 z-20 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80"
                        >
                          Swap
                        </button>
                        {bigIsRemote ? localTile : remoteTile}
                      </div>
                    )}
                  </>
                );
              })()}
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

          {panel && !mediaLoading && (
            <SidePanel tab={panel} onTab={setPanel} onClose={() => setPanel(null)} unreadChat={chat.unread}>
              {panel === 'chat' && (
                <ChatPanel messages={chat.messages} onSend={chat.send} partnerName={partnerDisplayName} />
              )}
              {panel === 'people' && (
                <ParticipantsPanel
                  me={{ role: role ? (role === 'interviewer' ? 'Interviewer' : 'Candidate') : null, audio: isAudioEnabled, video: isVideoEnabled }}
                  partner={
                    remoteJoined
                      ? {
                          name: partnerDisplayName || 'Participant',
                          role: role ? (role === 'interviewer' ? 'Candidate' : 'Interviewer') : null,
                          audio: remoteMedia.audio,
                          video: remoteMedia.video,
                        }
                      : null
                  }
                />
              )}
              {panel === 'captions' && (
                <CaptionsView
                  finalTranscripts={finalTranscripts}
                  interimTranscript={interimTranscript}
                  transcriptionError={transcriptionError}
                  isTranscribing={isTranscribing}
                  canTranscribe={live}
                  participantId={participantId}
                  partnerName={partnerDisplayName}
                />
              )}
            </SidePanel>
          )}
        </div>

        {!mediaLoading && (
          <div className="sticky bottom-0 glass-dark border-t border-white/5 px-4">
            <Controls
              isAudioEnabled={isAudioEnabled}
              isVideoEnabled={isVideoEnabled}
              isScreenSharing={isScreenSharing}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onToggleScreenShare={handleToggleScreenShare}
              onReport={remoteJoined ? () => setShowReport(true) : undefined}
              onLeave={() => setConfirmLeave(true)}
              onToggleChat={() => setPanel((p) => (p === 'chat' ? null : 'chat'))}
              onTogglePeople={() => setPanel((p) => (p === 'people' ? null : 'people'))}
              panel={panel}
              chatUnread={chat.unread}
            />
          </div>
        )}
      </main>

      {/* ── Leave? ──────────────────────────────────────────────────────── */}
      {confirmLeave && (
        <ConfirmDialog
          title="Leave this meeting?"
          confirmLabel="Leave"
          cancelLabel="Stay"
          danger
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            handleLeave();
          }}
        >
          {aiAssisted && !ended
            ? 'An AI-assisted interview is in progress. If you leave now, your partner will not be able to finish it with you.'
            : 'Your partner will be told that you left. You can come back from the same link while the meeting is open.'}
        </ConfirmDialog>
      )}

      {/* ── Report the other person ─────────────────────────────────────── */}
      {showReport && (
        <ReportDialog
          socket={socket}
          roomId={roomId}
          onClose={() => setShowReport(false)}
          onSubmitted={({ block }) => {
            // Blocking means this meeting is over for us: leave once they have seen the confirmation.
            if (block) setTimeout(() => handleLeave(), 2500);
          }}
        />
      )}

      {/* ── One-time message, the first time you are ever the interviewer ─── */}
      {showOnboarding && (
        <InterviewerOnboarding
          onDismiss={() => {
            setShowOnboarding(false);
            socket.emit('onboarding:interviewer-dismiss', { roomId });
          }}
        />
      )}

      {/* ── Interview setup modal (the person who started the meeting) ───── */}
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
