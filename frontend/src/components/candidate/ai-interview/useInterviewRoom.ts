import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { ApiClientError } from "@/services/api/client";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";

export type InterviewPhase = "setup" | "connecting" | "live" | "ended";

export interface CaptionLine {
  id: string;
  who: "you" | "interviewer";
  text: string;
}

const MAX_CAPTIONS = 8;

/**
 * Owns the LiveKit room for one AI interview. livekit-client touches browser
 * APIs, so it is imported dynamically inside start() — never at module load —
 * which keeps the TanStack Start SSR pass working.
 */
export function useInterviewRoom() {
  const roomRef = useRef<Room | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const [phase, setPhase] = useState<InterviewPhase>("setup");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const teardown = useCallback(() => {
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
    async (domain: AiInterviewDomain) => {
      setError(null);
      setCaptions([]);
      setMuted(false);
      setPhase("connecting");
      try {
        const session = await aiInterviewService.startSession(domain);
        const { Room, RoomEvent } = await import("livekit-client");
        if (unmountedRef.current) return;

        const room = new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        setRoomName(session.roomName);

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === "audio" && audioHostRef.current) {
            audioHostRef.current.appendChild(track.attach());
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
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
          stopTimer();
          roomRef.current = null;
          if (!unmountedRef.current) setPhase("ended");
        });

        await room.connect(session.serverUrl, session.participantToken);
        await room.startAudio().catch(() => setNeedsAudioUnlock(true));
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          teardown();
          setPhase("setup");
          setError(
            "Microphone access is required. Allow the microphone in your browser and try again.",
          );
          return;
        }

        const endsAt = Date.now() + session.maxMinutes * 60_000;
        setSecondsLeft(session.maxMinutes * 60);
        timerRef.current = setInterval(() => {
          setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
        }, 1000);
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
    [teardown],
  );

  const end = useCallback(() => {
    const room = roomRef.current;
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

  const unlockAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
    setNeedsAudioUnlock(false);
  }, []);

  const reset = useCallback(() => {
    teardown();
    setRoomName(null);
    setCaptions([]);
    setSecondsLeft(null);
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
    needsAudioUnlock,
    audioHostRef,
    start,
    end,
    toggleMute,
    unlockAudio,
    reset,
  };
}
