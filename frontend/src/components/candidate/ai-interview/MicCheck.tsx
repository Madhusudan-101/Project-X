import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mic, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";
import { domainInfo } from "./domains";

interface Props {
  domain: AiInterviewDomain;
  onBack: () => void;
  onJoin: () => void;
}

type MicState = "asking" | "ready" | "denied" | "missing";

const HEARD_LEVEL = 0.06;

/**
 * Pre-join microphone test. Opens the mic only to draw a level meter, then
 * releases it so the LiveKit room can take over on join.
 */
export function MicCheck({ domain, onBack, onJoin }: Props) {
  const [state, setState] = useState<MicState>("asking");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const role = domainInfo(domain)?.role;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    setState("asking");
    setHeard(false);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) return;
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        );
        setDevices(list);
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
      void ctx?.close();
    };
  }, [deviceId]);

  const checks = [
    {
      ok: state === "ready",
      pending: state === "asking",
      label: "Microphone access",
      detail:
        state === "ready"
          ? "Permission granted"
          : state === "asking"
            ? "Waiting for your browser permission"
            : state === "missing"
              ? "No microphone found. Connect one and reload."
              : "Blocked. Allow the microphone in your browser's site settings, then retry.",
    },
    {
      ok: heard,
      pending: state === "ready" && !heard,
      label: "Voice detected",
      detail: heard ? "We can hear you" : "Say a few words and watch the meter move",
    },
  ];

  return (
    <Card className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Step 2 of 3 · Equipment check
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">Test your microphone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Interview for <span className="font-medium text-foreground">{role}</span>. Make sure the
          interviewer can hear you before you join.
        </p>
      </div>

      {devices.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="mic-device" className="text-sm font-medium">
            Microphone
          </label>
          <select
            id="mic-device"
            value={deviceId ?? ""}
            onChange={(e) => setDeviceId(e.target.value || undefined)}
            className="h-10 w-full rounded-md border bg-card px-3 text-sm"
          >
            <option value="">Default microphone</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
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

      <ul className="divide-y rounded-lg border">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3 p-3 text-sm">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
            ) : c.pending ? (
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
            )}
            <div>
              <div className="font-medium">{c.label}</div>
              <div className="text-muted-foreground">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          className="bg-gradient-brand text-primary-foreground"
          disabled={state !== "ready"}
          onClick={onJoin}
        >
          Join interview
        </Button>
      </div>
    </Card>
  );
}
