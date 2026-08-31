/**
 * useWebRTC.js
 *
 * Custom hook that manages the entire WebRTC lifecycle using Simple Peer.
 *
 * Where Socket.io is used (signaling only):
 *   - Listening for 'user-joined'  → know when partner joined (initiator path)
 *   - Listening for 'ready'        → know who the initiator is (receiver path)
 *   - Listening for 'return-signal' → receive SDP offers/answers and ICE candidates
 *   - Emitting  'signal'           → send SDP offers/answers and ICE candidates
 *
 * Where Simple Peer is used (WebRTC wrapper):
 *   - Creates RTCPeerConnection behind the scenes
 *   - Generates SDP offer (initiator) or answer (receiver)
 *   - Handles ICE candidate gathering and trickle
 *   - Emits 'signal' events with SDP/ICE data
 *   - Fires 'stream' when remote media track is received
 *   - All actual audio/video flows P2P, NEVER through Socket.io
 *
 * STUN server: stun:stun.l.google.com:19302
 * (Helps peers discover their public IP/port for NAT traversal)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import SimplePeerLib from 'simple-peer';
// simple-peer is CommonJS; Vite may expose it as a namespace object.
// Grabbing .default ensures we always get the actual constructor.
const SimplePeer = SimplePeerLib.default ?? SimplePeerLib;
import socket from '../socket.js';
import { debugLog } from '../utils/debugLog.js';

/** Connection status enum */
export const ConnectionStatus = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  WAITING: 'waiting',       // Initiator waiting for partner
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
};

// Minimal fallback so peer creation never has a completely empty ICE list;
// the real (TURN-included) list is fetched from the server below, since
// TURN credentials must never live in client source.
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Dump the ICE candidate types both sides gathered after a failed connection.
 * Without this, an ICE failure gives no clue as to WHY: the console only says
 * "failed", and the candidate types are the piece of evidence that separates
 * "TURN never allocated" from "TURN worked but the path was still blocked".
 */
async function logIceFailureDiagnostics(pc) {
  try {
    const stats = await pc.getStats();
    const local = new Set();
    const remote = new Set();
    stats.forEach((report) => {
      if (report.type === 'local-candidate' && report.candidateType) local.add(report.candidateType);
      if (report.type === 'remote-candidate' && report.candidateType) remote.add(report.candidateType);
    });

    console.error(
      '[WebRTC] ✖ ICE FAILED — no working path between the peers.',
      '\n  local candidate types :', [...local].join(', ') || '(none)',
      '\n  remote candidate types:', [...remote].join(', ') || '(none)',
      '\n  If "relay" is missing, the TURN server did not allocate for that side.'
    );
  } catch (err) {
    console.error('[WebRTC] ✖ ICE FAILED (could not read candidate stats):', err.message);
  }
}

export function useWebRTC({ localStream, roomId, isInitiator }) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(ConnectionStatus.IDLE);
  const [peerError, setPeerError] = useState(null);

  // Refs (mutable, don't trigger re-renders)
  const peerRef = useRef(null);
  const partnerSocketIdRef = useRef(null);
  const isDestroyedRef = useRef(false);
  const iceServersRef = useRef(FALLBACK_ICE_SERVERS);

  // The signaling handlers below must never be re-registered just because the
  // local stream changed identity (a second getUserMedia resolving, or screen
  // sharing swapping the video source). 'ready'/'user-joined' are sent by the
  // server exactly once, so a socket.off/socket.on gap while the partner is
  // joining drops the handshake permanently — no peer, no offer, no remote
  // media, on both sides. Reading the stream from a ref keeps the handlers
  // stable while still always seeing the CURRENT stream.
  const localStreamRef = useRef(null);
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // 'ready'/'user-joined' can land before getUserMedia has resolved (the
  // partner may already be waiting in the room). Park the request instead of
  // dropping it, and build the peer as soon as the stream is available.
  const pendingPeerRequestRef = useRef(null);
  // Likewise, an offer/ICE candidate can arrive in the gap before the peer
  // object exists. simple-peer cannot buffer those itself, so hold them here
  // and replay them in arrival order once the peer is constructed.
  const pendingSignalsRef = useRef([]);

  // A peer built before the server's TURN list arrives gets ICE-gathered with
  // the STUN-only fallback, and STUN alone cannot traverse a symmetric NAT —
  // the call then fails with no recoverable path. An RTCPeerConnection's ICE
  // servers cannot be changed after construction, so this must be known
  // BEFORE the peer is created, not patched afterwards.
  const iceServersReadyRef = useRef(false);

  // ─── Create SimplePeer instance ─────────────────────────────────────────────
  const createPeer = useCallback(
    (partnerId, initiator, stream) => {
      debugLog(
        `[WebRTC] Creating peer | initiator=${initiator} | partner=${partnerId}`
      );

      // Destroy any existing peer
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.destroy();
      }

      isDestroyedRef.current = false;
      partnerSocketIdRef.current = partnerId;

      // Surfaces two silent-failure modes that otherwise only show up as a
      // black remote tile: sending a peer with no video track, and building
      // the connection before the server's TURN list arrived (STUN-only ICE
      // cannot traverse a symmetric NAT, so the call can never connect).
      debugLog(
        '[WebRTC] ✔ Local tracks attached | video:',
        stream?.getVideoTracks().length ?? 0,
        '| audio:',
        stream?.getAudioTracks().length ?? 0
      );
      const hasTurn = iceServersRef.current.some((s) =>
        String(s.urls).startsWith('turn')
      );
      if (!hasTurn) {
        console.warn(
          '[WebRTC] No TURN server in ICE config — this call can only connect on the same network'
        );
      }

      /**
       * SimplePeer wraps RTCPeerConnection.
       * - initiator=true → automatically generates an SDP offer
       * - trickle=true  → sends ICE candidates as they are discovered (faster connection)
       * - stream         → attaches local media tracks to the peer connection
       */
      const peer = new SimplePeer({
        initiator,
        trickle: true,
        stream,
        config: { iceServers: iceServersRef.current },
      });

      // These MUST use addEventListener — NEVER `peer._pc.onX = ...`.
      //
      // simple-peer installs its own `oniceconnectionstatechange` and
      // `onconnectionstatechange` in its constructor, and a direct property
      // assignment REPLACES them. Those handlers are the only thing that
      // surfaces a dead connection: they call destroy() with
      // ERR_ICE_CONNECTION_FAILURE / ERR_CONNECTION_FAILURE, which is what
      // fires the peer.on('error') and peer.on('close') handlers below. They
      // are also what sets simple-peer's internal _pcReady, so clobbering
      // them can leave the 'connect' (data channel) event hanging.
      //
      // With them clobbered, a call whose media path never established was
      // COMPLETELY silent: no error, no close, no status change — the UI sat
      // on a stale "Connected" with a permanently black remote tile.
      let iceRestartAttempted = false;
      peer._pc.addEventListener('iceconnectionstatechange', () => {
        const state = peer._pc.iceConnectionState;
        debugLog('[WebRTC] ✔ ICE state:', state);

        if (state === 'connected' || state === 'completed') {
          iceRestartAttempted = false;
          // Media only actually flows once ICE has a working candidate pair —
          // this, not ontrack, is the real "connected" moment.
          if (!isDestroyedRef.current) {
            setConnectionStatus(ConnectionStatus.CONNECTED);
          }
          return;
        }

        // 'failed' is terminal (simple-peer tears the peer down). Report WHICH
        // candidate types each side managed to gather, because that is the one
        // fact that distinguishes the possible causes: no 'relay' locally means
        // TURN did not allocate for us; relay on both sides yet still failing
        // points at the network blocking the relayed path.
        if (state === 'failed') {
          logIceFailureDiagnostics(peer._pc);
        }

        // Restart from 'disconnected' — the TRANSIENT state (e.g. a brief
        // network change) — not from 'failed'. simple-peer destroys the peer
        // outright on 'failed', so a restart attempted there would always
        // throw "cannot negotiate after peer is destroyed"; letting 'failed'
        // through to simple-peer is what gives the user a real error instead
        // of a silent black tile.
        //
        // simple-peer never wires up the native 'negotiationneeded' event, so
        // calling pc.restartIce() alone does nothing — nothing is listening
        // for the renegotiation it schedules. peer.negotiate() is
        // simple-peer's public method that actually calls createOffer()/emits
        // the signal; restartIce() first makes that upcoming offer carry a
        // fresh ICE ufrag/password.
        if (
          state === 'disconnected' &&
          !iceRestartAttempted &&
          !isDestroyedRef.current &&
          !peer.destroyed
        ) {
          iceRestartAttempted = true;
          console.warn('[WebRTC] ICE disconnected — attempting restart');
          try {
            if (initiator) {
              if (typeof peer._pc.restartIce === 'function') {
                peer._pc.restartIce();
              }
              peer.negotiate();
            }
            // Non-initiator side simply waits for the renegotiated offer.
          } catch (err) {
            console.error('[WebRTC] ICE restart failed:', err);
          }
        }
      });

      peer._pc.addEventListener('connectionstatechange', () => {
        const state = peer._pc.connectionState;
        debugLog('[WebRTC] ✔ Connection state:', state);
        if (state === 'connected' && !isDestroyedRef.current) {
          setConnectionStatus(ConnectionStatus.CONNECTED);
        }
      });

      /**
       * 'signal' event fires when SimplePeer has SDP or ICE data to send.
       * We forward this through Socket.io to the partner.
       * THIS IS THE ONLY TIME Socket.io IS INVOLVED — just signaling data.
       */
      peer.on('signal', (signalData) => {
        debugLog(
          `[WebRTC] Sending signal to ${partnerId} | type=${signalData.type || 'candidate'}`
        );
        socket.emit('signal', { signal: signalData, to: partnerId });
      });

      /**
       * 'stream' event fires when we receive the remote peer's media tracks.
       * From this point, audio/video flows directly P2P via WebRTC Data channels/SRTP.
       * Socket.io is no longer involved in media transport.
       */
      peer.on('stream', (remoteMediaStream) => {
        debugLog(
          '[WebRTC] ✔ Remote track received | video:',
          remoteMediaStream.getVideoTracks().length,
          '| audio:',
          remoteMediaStream.getAudioTracks().length
        );

        setRemoteStream(remoteMediaStream);

        // Deliberately NOT setting CONNECTED here. This event comes from
        // ontrack, which fires the moment the remote description is applied —
        // BEFORE ICE has checked a single candidate pair (verified: ontrack
        // fires while iceConnectionState is still 'new'). Marking CONNECTED
        // here is exactly what made a call whose media never flowed still
        // report "Connected" while the remote tile stayed black forever.
        // CONNECTED is now driven by the ICE/connection state listeners above.
      });

      peer.on('connect', () => {
        debugLog('[WebRTC] ✔ Peer data channel connected');
        // Third, independent confirmation that the transport is really up
        // (simple-peer only fires this once both ICE and the data channel are
        // ready), so the status can't get stuck on "Connecting" if a browser
        // reports its state-change events differently.
        if (!isDestroyedRef.current) {
          setConnectionStatus(ConnectionStatus.CONNECTED);
        }
      });

      peer.on('error', (err) => {
        console.error('[WebRTC] Peer error:', err);
        if (!isDestroyedRef.current) {
          setPeerError(`Connection error: ${err.message}`);
          setConnectionStatus(ConnectionStatus.ERROR);
        }
      });

      peer.on('close', () => {
        debugLog('[WebRTC] Peer connection closed');
        if (!isDestroyedRef.current) {
          setConnectionStatus(ConnectionStatus.DISCONNECTED);
          setRemoteStream(null);
        }
      });

      peerRef.current = peer;
      setConnectionStatus(ConnectionStatus.CONNECTING);

      // Replay anything that arrived before this peer existed (see
      // pendingSignalsRef) so no offer or ICE candidate is lost to the race.
      if (pendingSignalsRef.current.length) {
        debugLog(
          `[WebRTC] Replaying ${pendingSignalsRef.current.length} buffered signal(s)`
        );
        const buffered = pendingSignalsRef.current;
        pendingSignalsRef.current = [];
        for (const bufferedSignal of buffered) {
          try {
            peer.signal(bufferedSignal);
          } catch (err) {
            console.error('[WebRTC] Error replaying buffered signal:', err);
          }
        }
      }

      return peer;
    },
    []
  );

  /**
   * Build a parked peer once BOTH prerequisites are in: the local stream and
   * the ICE server list. Called again whenever either one lands.
   */
  const flushPendingPeer = useCallback(() => {
    const pending = pendingPeerRequestRef.current;
    if (!pending) return;
    if (!localStreamRef.current || !iceServersReadyRef.current) return;

    pendingPeerRequestRef.current = null;
    createPeer(pending.partnerId, pending.initiator, localStreamRef.current);
  }, [createPeer]);

  // ─── Fetch STUN/TURN servers from the server (credentials never ship in
  // client source) ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handleIceServers = ({ iceServers } = {}) => {
      if (Array.isArray(iceServers) && iceServers.length) {
        iceServersRef.current = iceServers;
      }
      iceServersReadyRef.current = true;
      flushPendingPeer();
    };

    socket.on('ice-servers:response', handleIceServers);
    socket.emit('ice-servers:request');

    // Never let a lost or failed response block the call outright — after a
    // short grace period, proceed with the STUN-only fallback (createPeer
    // warns loudly when it has to) rather than waiting forever.
    const fallbackTimer = setTimeout(() => {
      if (iceServersReadyRef.current) return;
      console.warn(
        '[WebRTC] ICE server list never arrived — proceeding with STUN-only fallback'
      );
      iceServersReadyRef.current = true;
      flushPendingPeer();
    }, 3000);

    return () => {
      clearTimeout(fallbackTimer);
      socket.off('ice-servers:response', handleIceServers);
    };
  }, [flushPendingPeer]);

  // ─── Socket.io event listeners ──────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    /**
     * Build the peer now if both the local stream and the ICE server list are
     * ready, otherwise park the request until they are (see
     * pendingPeerRequestRef / flushPendingPeer).
     */
    const createPeerWhenStreamReady = (partnerId, initiator) => {
      const stream = localStreamRef.current;

      if (!stream || !iceServersReadyRef.current) {
        debugLog(
          `[WebRTC] Partner known but not ready yet — deferring peer creation (stream: ${Boolean(
            stream
          )}, iceServers: ${iceServersReadyRef.current})`
        );
        pendingPeerRequestRef.current = { partnerId, initiator };
        return;
      }

      pendingPeerRequestRef.current = null;
      createPeer(partnerId, initiator, stream);
    };

    /**
     * INITIATOR PATH:
     * 'user-joined' fires when the second participant joins.
     * We create a peer as the initiator, which auto-generates an SDP offer.
     */
    const handleUserJoined = ({ callerId }) => {
      debugLog('[Socket] user-joined → creating peer as initiator');
      createPeerWhenStreamReady(callerId, true);
    };

    /**
     * RECEIVER PATH:
     * 'ready' fires immediately after joining, telling us who the initiator is.
     * We create a peer as the receiver (not initiator) — waits for an offer.
     */
    const handleReady = ({ initiatorId }) => {
      debugLog('[Socket] ready → creating peer as receiver');
      createPeerWhenStreamReady(initiatorId, false);
    };

    /**
     * 'return-signal' delivers an SDP offer/answer or ICE candidate from the partner.
     * We feed it directly into SimplePeer.signal(), which handles the rest.
     */
    const handleReturnSignal = ({ signal, from }) => {
      debugLog(
        `[Socket] return-signal from ${from} | type=${signal?.type || 'candidate'}`
      );

      // The peer may not exist yet (offer/candidates can outrun peer
      // construction while getUserMedia is still resolving). Buffer rather
      // than drop — createPeer() replays these in order.
      if (!peerRef.current || peerRef.current.destroyed) {
        pendingSignalsRef.current.push(signal);
        return;
      }

      try {
        peerRef.current.signal(signal);
      } catch (err) {
        console.error('[WebRTC] Error processing signal:', err);
      }
    };

    /**
     * 'user-left' fires when the partner disconnects.
     * Clean up the peer connection and update UI.
     */
    const handleUserLeft = ({ socketId }) => {
      debugLog('[Socket] user-left:', socketId);
      // Drop anything queued for the departed partner so it can't be replayed
      // into the next peer when someone new joins.
      pendingPeerRequestRef.current = null;
      pendingSignalsRef.current = [];
      if (!isDestroyedRef.current) {
        setConnectionStatus(ConnectionStatus.DISCONNECTED);
        setRemoteStream(null);
        if (peerRef.current && !peerRef.current.destroyed) {
          isDestroyedRef.current = true;
          peerRef.current.destroy();
        }
      }
    };

    // Register listeners
    socket.on('user-joined', handleUserJoined);
    socket.on('ready', handleReady);
    socket.on('return-signal', handleReturnSignal);
    socket.on('user-left', handleUserLeft);

    // Set initial waiting status (for initiator)
    if (isInitiator) {
      setConnectionStatus(ConnectionStatus.WAITING);
    }

    return () => {
      socket.off('user-joined', handleUserJoined);
      socket.off('ready', handleReady);
      socket.off('return-signal', handleReturnSignal);
      socket.off('user-left', handleUserLeft);
    };
    // Deliberately NOT keyed on localStream — see localStreamRef above.
  }, [roomId, isInitiator, createPeer]);

  // Build the peer as soon as the local stream lands, if the partner was
  // already announced while getUserMedia was still in flight. No-ops if the
  // ICE server list is still outstanding — that path fires from its own
  // handler above.
  useEffect(() => {
    if (!localStream) return;
    flushPendingPeer();
  }, [localStream, flushPendingPeer]);

  // ─── Screen share track replacement ────────────────────────────────────────
  /**
   * Replace the video track in the existing peer connection.
   * This enables screen sharing WITHOUT disconnecting the peer.
   *
   * Simple Peer's replaceTrack(oldTrack, newTrack, stream) method
   * calls RTCRtpSender.replaceTrack() internally — negotiation-free.
   */
  const replaceVideoTrack = useCallback((oldStream, newStream) => {
    if (!peerRef.current || peerRef.current.destroyed) return;

    const oldVideoTrack = oldStream?.getVideoTracks()[0];
    const newVideoTrack = newStream?.getVideoTracks()[0];

    if (oldVideoTrack && newVideoTrack) {
      try {
        peerRef.current.replaceTrack(oldVideoTrack, newVideoTrack, newStream);
        debugLog('[WebRTC] Video track replaced for screen sharing');
      } catch (err) {
        console.error('[WebRTC] replaceTrack error:', err);
      }
    }
  }, []);

  // ─── Destroy peer (on leave) ────────────────────────────────────────────────
  const destroyPeer = useCallback(() => {
    // Discard queued work from the old session so a reconnect's fresh peer
    // never replays signals belonging to the previous connection.
    pendingPeerRequestRef.current = null;
    pendingSignalsRef.current = [];
    if (peerRef.current && !peerRef.current.destroyed) {
      isDestroyedRef.current = true;
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setRemoteStream(null);
    setConnectionStatus(ConnectionStatus.DISCONNECTED);
  }, []);

  // ─── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (peerRef.current && !peerRef.current.destroyed) {
        isDestroyedRef.current = true;
        peerRef.current.destroy();
      }
    };
  }, []);

  return {
    remoteStream,
    connectionStatus,
    peerError,
    replaceVideoTrack,
    destroyPeer,
  };
}
