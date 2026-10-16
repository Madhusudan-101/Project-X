import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Mic, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";
import { domainInfo } from "./domains";
import type { DevicePick } from "./useInterviewRoom";

interface Props {
  domain: AiInterviewDomain;
  onBack: () => void;
  onJoin: (devices: DevicePick) => void;
}

type DeviceState = "asking" | "ready" | "denied" | "missing";

const HEARD_LEVEL = 0.06;

/**
 * Pre-join camera and microphone test. Opens both only to show a preview and a
 * level meter, then releases them so the LiveKit room can take over on join.
 */
export function DeviceCheck({ domain, onBack, onJoin }: Props) {
  const [state, setState] = useState<DeviceState>("asking");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string | undefined>();
  const [camId, setCamId] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const role = domainInfo(domain)?.role;

  useEffect(() => {
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    setState("asking");
    setHeard(false);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
          video: camId ? { deviceId: { exact: camId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        setMics(all.filter((d) => d.kind === "audioinput"));
        setCams(all.filter((d) => d.kind === "videoinput"));
        if (video) video.srcObject = stream;
        setState("ready");
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
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        setState(
          name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "denied",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
      void ctx?.close();
    };
  }, [micId, camId]);

  const problem =
    state === "missing"
      ? "No camera or microphone found. Connect one and reload this page."
      : "Blocked. Allow the camera and microphone in your browser's site settings, then retry.";

  const checks = [
    {
      ok: state === "ready",
      pending: state === "asking",
      label: "Camera and microphone access",
      detail:
        state === "ready"
          ? "Permission granted"
          : state === "asking"
            ? "Waiting for your browser permission"
            : problem,
    },
    {
      ok: state === "ready",
      pending: state === "asking",
      label: "Camera preview",
      detail: state === "ready" ? "Keep your face centered and well lit" : "No video yet",
    },
    {
      ok: heard,
      pending: state === "ready" && !heard,
      label: "Voice detected",
      detail: heard ? "We can hear you" : "Say a few words and watch the meter move",
    },
  ];

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
          Interview for <span className="font-medium text-foreground">{role}</span>. Your camera
          must stay on for the whole session, and the interviewer must be able to hear you.
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
            {state !== "ready" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-background/70">
                {state === "asking" ? (
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
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          className="bg-gradient-brand text-primary-foreground"
          disabled={state !== "ready"}
          onClick={() => onJoin({ micId, camId })}
        >
          Join interview
        </Button>
      </div>
    </Card>
  );
}
