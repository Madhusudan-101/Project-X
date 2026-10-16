import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalVideoTrack, Room } from "livekit-client";
import { ApiClientError } from "@/services/api/client";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type {
  AiInterviewDomain,
  IntegrityKind,
  VideoFlagKind,
} from "@/types/candidate/aiInterview";

export type InterviewPhase = "setup" | "connecting" | "live" | "ended";

export interface CaptionLine {
  id: string;
  who: "you" | "interviewer";
  text: string;
}

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
  const roomNameRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const cameraLostRef = useRef(false);
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
  const [videoFlag, setVideoFlag] = useState<VideoFlagKind | null>(null);

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

  const start = useCallback(
    async (domain: AiInterviewDomain, consentVersion: string, devices: DevicePick = {}) => {
      setError(null);
      setCaptions([]);
      setMuted(false);
      setInterviewerJoined(false);
      setInterviewerMissing(false);
      setInterviewerSpeaking(false);
      setSelfVideo(null);
      setCameraLost(false);
      cameraLostRef.current = false;
      endingRef.current = false;
      setVideoFlag(null);
      pendingEventsRef.current = [];
      roomNameRef.current = null;
      setPhase("connecting");
      try {
        const session = await aiInterviewService.startSession(domain, consentVersion);
        const { Room, RoomEvent } = await import("livekit-client");
        if (unmountedRef.current) return;

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
        room.on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.track?.kind === "video") {
            setSelfVideo(pub.track as LocalVideoTrack);
            setCameraLost(false);
            if (cameraLostRef.current) {
              cameraLostRef.current = false;
              reportIntegrity("camera_restored");
            }
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.track?.kind === "video") {
            setSelfVideo(null);
            setCameraLost(true);
            if (!cameraLostRef.current) {
              cameraLostRef.current = true;
              reportIntegrity("camera_lost");
            }
          }
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
        room.on(RoomEvent.Disconnected, () => {
          // Fires for: End button, server time limit, network loss, agent exit.
          endingRef.current = true;
          stopTimer();
          roomRef.current = null;
          void flushIntegrity();
          if (!unmountedRef.current) setPhase("ended");
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
          setPhase("setup");
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
          setPhase("setup");
          setError(
            "Camera access is required for this interview. Allow the camera in your browser and try again.",
          );
          return;
        }

        startedAtRef.current = Date.now();
        const endsAt = Date.now() + session.maxMinutes * 60_000;
        setSecondsLeft(session.maxMinutes * 60);
        timerRef.current = setInterval(() => {
          setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
        }, 1000);
        // The agent is dispatched by the backend; if it never shows up the
        // call would otherwise look healthy while nobody is on the other end.
        if (room.remoteParticipants.size > 0) setInterviewerJoined(true);
        else {
          joinTimerRef.current = setTimeout(() => {
            if (roomRef.current && roomRef.current.remoteParticipants.size === 0) {
              setInterviewerMissing(true);
            }
          }, INTERVIEWER_JOIN_TIMEOUT_MS);
        }
        setPhase("live");
      } catch (err: unknown) {
        teardown();
        setPhase("setup");
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not start the interview. Check your connection and try again.",
        );
      }
    },
    [teardown, reportIntegrity, flushIntegrity],
  );

  const end = useCallback(() => {
    const room = roomRef.current;
    endingRef.current = true;
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

  /** Re-enable the camera after it was lost (unplugged, revoked, or stopped by the browser). */
  const retryCamera = useCallback(async () => {
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(true);
    } catch {
      setCameraLost(true);
    }
  }, []);

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
    setVideoFlag(null);
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
    videoFlag,
    retryCamera,
    reportIntegrity,
    needsAudioUnlock,
    audioHostRef,
    start,
    end,
    toggleMute,
    unlockAudio,
    reset,
  };
}
