import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalAudioTrack, LocalVideoTrack, Room } from "livekit-client";
import { ApiClientError } from "@/services/api/client";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type {
  AiInterviewDomain,
  AiInterviewSession,
  IntegrityKind,
  VideoFlagKind,
} from "@/types/candidate/aiInterview";

export type InterviewPhase =
  | "setup"
  | "connecting"
  | "live"
  /** The connection dropped but the interview is still open: the candidate can rejoin. */
  | "interrupted"
  /** The AI interviewer never joined; the attempt was given back. */
  | "unavailable"
  | "ended";

export interface CaptionLine {
  id: string;
  who: "you" | "interviewer";
  text: string;
}

type DeviceKind = "camera" | "mic";

export interface DevicePick {
  micId?: string;
  camId?: string;
}

const VIDEO_FLAGS: VideoFlagKind[] = ["no_face", "multiple_faces", "camera_blocked"];

/**
 * The interviewer agent tells the candidate, on topic "integrity", when its video check
 * flags or clears a problem. Returns null for anything else, so stray data is ignored.
 */
export function parseIntegrityNotice(
  payload: Uint8Array,
  topic?: string,
): { kind: VideoFlagKind; state: "flagged" | "cleared" } | null {
  if (topic !== "integrity") return null;
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; state?: string };
    if (!VIDEO_FLAGS.includes(msg.kind as VideoFlagKind)) return null;
    if (msg.state !== "flagged" && msg.state !== "cleared") return null;
    return { kind: msg.kind as VideoFlagKind, state: msg.state };
  } catch {
    return null;
  }
}

const MAX_CAPTIONS = 8;
/** How long to wait for the voice agent to join before telling the user. */
const INTERVIEWER_JOIN_TIMEOUT_MS = 25_000;

/**
 * Owns the LiveKit room for one AI interview. livekit-client touches browser
 * APIs, so it is imported dynamically inside start() — never at module load —
 * which keeps the TanStack Start SSR pass working.
 */
export function useInterviewRoom() {
  const roomRef = useRef<Room | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  /** The candidate pressed End, so a disconnect is the end and not a dropped connection. */
  const userEndedRef = useRef(false);
  const endsAtRef = useRef(0);
  const devicesRef = useRef<DevicePick>({});
  const roomNameRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const lostRef = useRef<Record<DeviceKind, boolean>>({ camera: false, mic: false });
  const deviceTrackRef = useRef<Partial<Record<DeviceKind, LocalAudioTrack | LocalVideoTrack>>>({});
  const pendingEventsRef = useRef<{ kind: IntegrityKind; offsetSeconds: number }[]>([]);
  const flushingRef = useRef(false);
  /** True once the call is being closed, so unpublishing tracks is not reported as a camera fault. */
  const endingRef = useRef(false);

  const [phase, setPhase] = useState<InterviewPhase>("setup");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [interviewerJoined, setInterviewerJoined] = useState(false);
  const [interviewerMissing, setInterviewerMissing] = useState(false);
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false);
  const [selfVideo, setSelfVideo] = useState<LocalVideoTrack | null>(null);
  const [cameraLost, setCameraLost] = useState(false);
  const [micLost, setMicLost] = useState(false);
  const [videoFlag, setVideoFlag] = useState<VideoFlagKind | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [unavailable, setUnavailable] = useState<{ released: boolean } | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (joinTimerRef.current) clearTimeout(joinTimerRef.current);
    joinTimerRef.current = null;
  };

  /** Send queued integrity events; anything that fails stays queued for the next attempt. */
  const flushIntegrity = useCallback(async () => {
    const name = roomNameRef.current;
    if (!name || flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (pendingEventsRef.current.length > 0) {
        const batch = pendingEventsRef.current.slice(0, 20);
        try {
          await aiInterviewService.logIntegrityEvents(name, batch);
        } catch {
          return; // keep the batch queued; the next event or the end of the call retries
        }
        pendingEventsRef.current = pendingEventsRef.current.slice(batch.length);
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  /** Record a supervision signal against the live interview (saved by the backend). */
  const reportIntegrity = useCallback(
    (kind: IntegrityKind) => {
      if (!roomNameRef.current || endingRef.current) return;
      const offsetSeconds = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
      pendingEventsRef.current.push({ kind, offsetSeconds });
      void flushIntegrity();
    },
    [flushIntegrity],
  );

  const markLost = useCallback(
    (device: DeviceKind) => {
      if (endingRef.current || lostRef.current[device]) return;
      lostRef.current[device] = true;
      (device === "camera" ? setCameraLost : setMicLost)(true);
      reportIntegrity(device === "camera" ? "camera_lost" : "mic_lost");
    },
    [reportIntegrity],
  );

  const markRestored = useCallback(
    (device: DeviceKind) => {
      if (!lostRef.current[device]) return;
      lostRef.current[device] = false;
      (device === "camera" ? setCameraLost : setMicLost)(false);
      reportIntegrity(device === "camera" ? "camera_restored" : "mic_restored");
    },
    [reportIntegrity],
  );

  const teardown = useCallback(() => {
    endingRef.current = true;
    stopTimer();
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      void room.disconnect();
    }
    if (audioHostRef.current) audioHostRef.current.replaceChildren();
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      teardown();
    };
  }, [teardown]);

  /** Open the room for a session the backend has just created (practice or company). */
  const begin = useCallback(
    async (open: () => Promise<AiInterviewSession>, devices: DevicePick = {}, resume = false) => {
      setError(null);
      setUnavailable(null);
      setReconnecting(false);
      userEndedRef.current = false;
      if (!resume) {
        devicesRef.current = devices;
        setCaptions([]);
        pendingEventsRef.current = [];
        roomNameRef.current = null;
      }
      setMuted(false);
      setInterviewerJoined(false);
      setInterviewerMissing(false);
      setInterviewerSpeaking(false);
      setSelfVideo(null);
      setCameraLost(false);
      setMicLost(false);
      lostRef.current = { camera: false, mic: false };
      deviceTrackRef.current = {};
      endingRef.current = false;
      setVideoFlag(null);
      setPhase("connecting");
      // A failed first start goes back to setup; a failed rejoin stays on the "connection lost" screen.
      const failTo = resume ? "interrupted" : "setup";
      try {
        const session = await open();
        const { Room, RoomEvent, TrackEvent, DisconnectReason } = await import("livekit-client");
        if (unmountedRef.current) return;
        // Reasons that mean the interview itself is over, not that the connection dropped.
        const finalReasons = new Set(
          [
            DisconnectReason.CLIENT_INITIATED,
            DisconnectReason.DUPLICATE_IDENTITY,
            DisconnectReason.SERVER_SHUTDOWN,
            DisconnectReason.PARTICIPANT_REMOVED,
            DisconnectReason.ROOM_DELETED,
          ].filter((r) => r !== undefined),
        );

        const room = new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        setRoomName(session.roomName);
        roomNameRef.current = session.roomName;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === "audio" && audioHostRef.current) {
            audioHostRef.current.appendChild(track.attach());
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
        });
        room.on(RoomEvent.ParticipantConnected, () => {
          setInterviewerJoined(true);
          setInterviewerMissing(false);
        });
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setInterviewerSpeaking(speakers.some((s) => !s.isLocal));
        });
        room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (!participant || participant.isLocal) return; // only the interviewer may send these
          const notice = parseIntegrityNotice(payload, topic);
          if (!notice) return;
          setVideoFlag((cur) =>
            notice.state === "flagged" ? notice.kind : cur === notice.kind ? null : cur,
          );
        });
        // A camera or microphone can drop out mid-interview (unplugged, permission revoked,
        // taken by another app). LiveKit then emits "ended" on the track and tries to restart
        // it; it never unpublishes. So watch each device track for ended / restarted.
        room.on(RoomEvent.LocalTrackPublished, (pub) => {
          const track = pub.track;
          if (track?.kind !== "video" && track?.kind !== "audio") return;
          const device: DeviceKind = track.kind === "video" ? "camera" : "mic";
          const local = track as LocalVideoTrack | LocalAudioTrack;
          deviceTrackRef.current[device] = local;
          if (device === "camera") setSelfVideo(local as LocalVideoTrack);
          local.on(TrackEvent.Ended, () => markLost(device));
          local.on(TrackEvent.Restarted, () => markRestored(device));
          markRestored(device); // a (re)published track means the device is back
        });
        room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
          const kind = pub.track?.kind;
          if (kind === "video") setSelfVideo(null);
          if (kind === "video") markLost("camera");
          if (kind === "audio") markLost("mic");
        });
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setNeedsAudioUnlock(!room.canPlaybackAudio);
        });
        room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
          const who = participant?.isLocal ? "you" : "interviewer";
          setCaptions((prev) => {
            const next = [...prev];
            for (const seg of segments) {
              const line: CaptionLine = { id: seg.id, who, text: seg.text };
              const i = next.findIndex((c) => c.id === seg.id);
              if (i >= 0) next[i] = line;
              else next.push(line);
            }
            return next.slice(-MAX_CAPTIONS);
          });
        });
        room.on(RoomEvent.Reconnecting, () => setReconnecting(true));
        room.on(RoomEvent.Reconnected, () => setReconnecting(false));
        room.on(RoomEvent.Disconnected, (reason) => {
          // Fires for: End button, server time limit, network loss, agent exit.
          endingRef.current = true;
          stopTimer();
          roomRef.current = null;
          setReconnecting(false);
          void flushIntegrity();
          if (unmountedRef.current) return;
          // Only a dropped connection with time left can be resumed; everything else is the end.
          const timeLeft = endsAtRef.current - Date.now() > 0;
          const over =
            userEndedRef.current || (reason !== undefined && finalReasons.has(reason)) || !timeLeft;
          setPhase(over ? "ended" : "interrupted");
        });

        await room.connect(session.serverUrl, session.participantToken);
        await room.startAudio().catch(() => setNeedsAudioUnlock(true));
        try {
          await room.localParticipant.setMicrophoneEnabled(
            true,
            devices.micId ? { deviceId: devices.micId } : undefined,
          );
        } catch {
          teardown();
          setPhase(failTo);
          setError(
            "Microphone access is required. Allow the microphone in your browser and try again.",
          );
          return;
        }
        // The camera is mandatory: it is how the session is supervised.
        try {
          await room.localParticipant.setCameraEnabled(
            true,
            devices.camId ? { deviceId: devices.camId } : undefined,
          );
        } catch {
          teardown();
          setPhase(failTo);
          setError(
            "Camera access is required for this interview. Allow the camera in your browser and try again.",
          );
          return;
        }

        // A rejoin keeps the original start time, so integrity events stay on one timeline.
        if (!resume) startedAtRef.current = Date.now();
        const endsAt = Date.now() + session.maxMinutes * 60_000;
        endsAtRef.current = endsAt;
        setSecondsLeft(session.maxMinutes * 60);
        timerRef.current = setInterval(() => {
          setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
        }, 1000);
        // The agent is dispatched by the backend; if it never shows up the
        // call would otherwise look healthy while nobody is on the other end.
        if (room.remoteParticipants.size > 0) setInterviewerJoined(true);
        else {
          joinTimerRef.current = setTimeout(() => {
            if (!roomRef.current || roomRef.current.remoteParticipants.size > 0) return;
            setInterviewerMissing(true);
            // Nobody is on the other end: cancel and give the attempt back. The server checks
            // with LiveKit first, so this cannot be used to peek at the questions and retry.
            const name = roomNameRef.current;
            if (!name) return;
            aiInterviewService
              .abortSession(name)
              .then(() => {
                if (unmountedRef.current) return;
                teardown();
                setUnavailable({ released: true });
                setPhase("unavailable");
              })
              .catch((err: unknown) => {
                // 409: the interviewer turned up after all, or it is too late to cancel. Either
                // way, stay in the room; the warning stays only while nobody else is there.
                if (err instanceof ApiClientError && err.status === 409) {
                  setInterviewerMissing((roomRef.current?.remoteParticipants.size ?? 0) === 0);
                }
              });
          }, INTERVIEWER_JOIN_TIMEOUT_MS);
        }
        setPhase("live");
      } catch (err: unknown) {
        teardown();
        // A rejoin refused because the interview is over is final; anything else can be retried.
        const over =
          resume && err instanceof ApiClientError && (err.status === 409 || err.status === 410);
        setPhase(over ? "ended" : failTo);
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not start the interview. Check your connection and try again.",
        );
      }
    },
    [teardown, flushIntegrity, markLost, markRestored],
  );

  /** Rejoin my own live interview after the connection dropped. */
  const rejoin = useCallback(async () => {
    const name = roomNameRef.current;
    if (!name) return;
    await begin(() => aiInterviewService.rejoinSession(name), devicesRef.current, true);
  }, [begin]);

  /** Practice interview on one of the built-in tracks. */
  const start = useCallback(
    (domain: AiInterviewDomain, consentVersion: string, devices: DevicePick = {}) =>
      begin(() => aiInterviewService.startSession(domain, consentVersion), devices),
    [begin],
  );

  /** The interview a company invited this candidate to. */
  const startInvite = useCallback(
    (inviteId: string, consentVersion: string, devices: DevicePick = {}) =>
      begin(() => aiInterviewService.startInviteSession(inviteId, consentVersion), devices),
    [begin],
  );

  const end = useCallback(() => {
    const room = roomRef.current;
    endingRef.current = true;
    userEndedRef.current = true;
    if (room)
      void room.disconnect(); // Disconnected handler moves us to "ended"
    else setPhase("ended");
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  }, [muted]);

  /**
   * Bring a lost camera or microphone back: restart its track on the current device and
   * unmute it, or publish it again if the track is gone. Stays "lost" if the device still fails.
   */
  const retryDevice = useCallback(
    async (device: DeviceKind) => {
      const lp = roomRef.current?.localParticipant;
      if (!lp) return;
      const track = deviceTrackRef.current[device];
      try {
        if (track) {
          await track.restartTrack();
          await track.unmute();
          markRestored(device);
        } else if (device === "camera") {
          await lp.setCameraEnabled(true);
        } else {
          await lp.setMicrophoneEnabled(true);
        }
      } catch {
        /* still lost; the banner stays and the candidate can try again */
      }
    },
    [markRestored],
  );
  const retryCamera = useCallback(() => retryDevice("camera"), [retryDevice]);
  const retryMic = useCallback(() => retryDevice("mic"), [retryDevice]);

  const unlockAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
    setNeedsAudioUnlock(false);
  }, []);

  const reset = useCallback(() => {
    teardown();
    setRoomName(null);
    setCaptions([]);
    setSecondsLeft(null);
    setInterviewerJoined(false);
    setInterviewerMissing(false);
    setInterviewerSpeaking(false);
    setSelfVideo(null);
    setCameraLost(false);
    setMicLost(false);
    setVideoFlag(null);
    setReconnecting(false);
    setUnavailable(null);
    setError(null);
    setPhase("setup");
  }, [teardown]);

  return {
    phase,
    roomName,
    error,
    muted,
    captions,
    secondsLeft,
    interviewerJoined,
    interviewerMissing,
    interviewerSpeaking,
    selfVideo,
    cameraLost,
    micLost,
    videoFlag,
    retryCamera,
    retryMic,
    reportIntegrity,
    needsAudioUnlock,
    audioHostRef,
    start,
    startInvite,
    rejoin,
    reconnecting,
    unavailable,
    end,
    toggleMute,
    unlockAudio,
    reset,
  };
}
