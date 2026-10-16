import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Mic, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";
import { domainInfo } from "./domains";
import type { DevicePick } from "./useInterviewRoom";

interface Props {
  domain?: AiInterviewDomain;
  /** Company interviews name their own role; practice uses the track's role. */
  roleTitle?: string;
  onBack: () => void;
  onJoin: (devices: DevicePick) => void;
}

type DeviceState = "asking" | "ready" | "denied" | "missing";

const HEARD_LEVEL = 0.06;

const stateFromError = (e: unknown): DeviceState => {
  const name = e instanceof DOMException ? e.name : "";
  return name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "denied";
};

/**
 * Pre-join camera and microphone test. Each device is requested on its own, so the
 * candidate sees exactly which permission is missing and can fix it. Both must be
 * granted to join. The devices are opened only for the preview and meter, then
 * released so the LiveKit room can take over on join.
 */
export function DeviceCheck({ domain, roleTitle, onBack, onJoin }: Props) {
  const [micState, setMicState] = useState<DeviceState>("asking");
  const [camState, setCamState] = useState<DeviceState>("asking");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string | undefined>();
  const [camId, setCamId] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const role = roleTitle ?? (domain ? domainInfo(domain)?.role : undefined);

  const refreshDeviceLists = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === "audioinput"));
      setCams(all.filter((d) => d.kind === "videoinput"));
    } catch {
      /* the lists only feed the pickers */
    }
  };

  // Microphone: permission + level meter.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    setMicState("asking");
    setHeard(false);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        void refreshDeviceLists();
        setMicState("ready");
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel(peak);
          if (peak > HEARD_LEVEL) setHeard(true);
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        if (!cancelled) setMicState(stateFromError(e));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [micId, attempt]);

  // Camera: permission + live preview.
  useEffect(() => {
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamState("asking");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: camId ? { deviceId: { exact: camId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        void refreshDeviceLists();
        if (video) video.srcObject = stream;
        setCamState("ready");
      } catch (e) {
        if (!cancelled) setCamState(stateFromError(e));
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [camId, attempt]);

  const detail = (state: DeviceState, noun: "camera" | "microphone") =>
    state === "ready"
      ? `${noun === "camera" ? "Camera" : "Microphone"} allowed`
      : state === "asking"
        ? `Waiting for your browser's ${noun} permission`
        : state === "missing"
          ? `No ${noun} found. Connect one, then retry.`
          : `${noun === "camera" ? "Camera" : "Microphone"} blocked. Allow the ${noun} in your browser's site settings, then retry.`;

  const checks = [
    {
      ok: camState === "ready",
      pending: camState === "asking",
      label: "Camera permission",
      detail: detail(camState, "camera"),
    },
    {
      ok: micState === "ready",
      pending: micState === "asking",
      label: "Microphone permission",
      detail: detail(micState, "microphone"),
    },
    {
      ok: heard,
      pending: micState === "ready" && !heard,
      label: "Voice detected",
      detail: heard ? "We can hear you" : "Say a few words and watch the meter move",
    },
  ];
  const ready = camState === "ready" && micState === "ready";
  const failed =
    camState === "denied" ||
    camState === "missing" ||
    micState === "denied" ||
    micState === "missing";

  const picker = (
    id: string,
    label: string,
    list: MediaDeviceInfo[],
    value: string | undefined,
    set: (v: string | undefined) => void,
  ) =>
    list.length > 1 && (
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => set(e.target.value || undefined)}
          className="h-10 w-full rounded-md border bg-card px-3 text-sm"
        >
          <option value="">Default</option>
          {list.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
    );

  return (
    <Card className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Step 2 of 3 · Equipment check
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">Test your camera and microphone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Interview for <span className="font-medium text-foreground">{role}</span>. Your browser
          will ask for camera and microphone access. You must allow both, and keep both on for the
          whole session.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-foreground">
            {/* Muted: the preview must never play your own microphone back. */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Camera preview"
              className="h-full w-full -scale-x-100 object-cover"
            />
            {camState !== "ready" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-background/70">
                {camState === "asking" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Starting camera…
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4" aria-hidden /> Camera unavailable
                  </>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mic className="h-4 w-4" aria-hidden /> Input level
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, level * 3) * 100)}
            >
              <div
                className="h-full rounded-full bg-success transition-[width] duration-75"
                style={{ width: `${Math.min(1, level * 3) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {picker("cam-device", "Camera", cams, camId, setCamId)}
          {picker("mic-device", "Microphone", mics, micId, setMicId)}
          <ul className="divide-y rounded-lg border">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3 p-3 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : c.pending ? (
                  <Loader2
                    className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                )}
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-muted-foreground">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          {failed && (
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Retry permissions
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          className="bg-gradient-brand text-primary-foreground"
          disabled={!ready}
          onClick={() => onJoin({ micId, camId })}
        >
          Join interview
        </Button>
      </div>
    </Card>
  );
}
