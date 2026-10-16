import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { OAEventType } from "@/types/candidate/assessment";

export type CameraStatus = "idle" | "starting" | "on" | "denied" | "lost";

/** Snapshots are small on purpose: ~320x240 JPEG, a few tens of KB. */
const WIDTH = 320;
const HEIGHT = 240;
const QUALITY = 0.6;
const FIRST_SNAPSHOT_MS = 4000;

interface FaceDetectorLike {
  detect: (src: CanvasImageSource) => Promise<unknown[]>;
}
type FaceDetectorCtor = new (opts?: {
  fastMode?: boolean;
  maxDetectedFaces?: number;
}) => FaceDetectorLike;

interface Options {
  enabled: boolean;
  intervalSeconds: number;
  /** a JPEG data URL plus the faces the browser counted (null = it can't tell) */
  onSnapshot: (image: string, faces: number | null) => void;
  onEvent: (type: OAEventType) => void;
}

/**
 * Opens the camera while `enabled`, shows it through `videoRef`, and hands a small
 * snapshot to `onSnapshot` every ~`intervalSeconds` (jittered, so it can't be timed).
 * Reports camera_denied / camera_lost / camera_restored through `onEvent`.
 * Nothing is recorded locally; frames only leave the page via `onSnapshot`.
 */
export function useProctorCamera({ enabled, intervalSeconds, onSnapshot, onEvent }: Options): {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  retry: () => void;
} {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const hadStream = useRef(false);
  const cbs = useRef({ onSnapshot, onEvent });
  cbs.current = { onSnapshot, onEvent };

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current?.active) return;
    setStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.play().catch(() => undefined);
      }
      stream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          streamRef.current = null;
          setStatus("lost");
          cbs.current.onEvent("camera_lost");
        };
      });
      setStatus("on");
      if (hadStream.current) cbs.current.onEvent("camera_restored");
      hadStream.current = true;
    } catch {
      setStatus("denied");
      cbs.current.onEvent("camera_denied");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void start();
    return () => {
      stop();
      setStatus("idle");
    };
  }, [enabled, start, stop]);

  useEffect(() => {
    if (!enabled || status !== "on") return;
    let timer = 0;
    let cancelled = false;
    const Detector = (window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
    const detector = Detector ? new Detector({ fastMode: true, maxDetectedFaces: 5 }) : null;

    const snap = async () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, WIDTH, HEIGHT);
          let faces: number | null = null;
          if (detector) {
            try {
              faces = (await detector.detect(canvas)).length;
            } catch {
              faces = null;
            }
          }
          if (!cancelled) cbs.current.onSnapshot(canvas.toDataURL("image/jpeg", QUALITY), faces);
        }
      }
      if (!cancelled) schedule();
    };
    const schedule = (first = false) => {
      const base = intervalSeconds * 1000;
      timer = window.setTimeout(
        snap,
        first ? FIRST_SNAPSHOT_MS : base * (0.7 + Math.random() * 0.6),
      );
    };
    schedule(true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, status, intervalSeconds]);

  return { videoRef, status, retry: () => void start() };
}
