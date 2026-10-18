import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Eye,
  Lightbulb,
  Loader2,
  Maximize,
  Monitor,
  ShieldCheck,
  UserRound,
  VideoOff,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OffOptionalRequired } from "@/types/candidate/assessment";
import { checkDisplays } from "./display-check";
import { itemDone, permissionPlan, type ItemKey, type PermissionState } from "./permissions";

type Tone = "todo" | "done" | "warn" | "error";

function Item({
  icon: Icon,
  title,
  tone,
  note,
  open,
  onToggle,
  children,
}: {
  icon: typeof Camera;
  title: string;
  tone: Tone;
  /** short text kept beside the title so a warning is not lost when the item collapses */
  note?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-muted/20 transition-colors " +
        (open ? "border-primary/40" : "border-border")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">
          {title}
          {note && (
            <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
              {note}
            </span>
          )}
        </span>
        {tone === "done" && <CheckCircle2 className="h-5 w-5 text-success" aria-label="Done" />}
        {tone === "warn" && (
          <AlertTriangle className="h-5 w-5 text-amber-500" aria-label="Needs attention" />
        )}
        {tone === "error" && <XCircle className="h-5 w-5 text-destructive" aria-label="Problem" />}
        <ChevronDown
          className={
            "h-4 w-4 text-muted-foreground transition-transform " + (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && <div className="space-y-4 px-5 pb-5 pl-[3.25rem] text-sm">{children}</div>}
    </div>
  );
}

const TIPS: { icon: typeof Camera; text: string }[] = [
  { icon: UserRound, text: "Your face is clearly visible in the webcam" },
  { icon: Lightbulb, text: "You are in a well-lit place, with the light in front of you" },
  { icon: Eye, text: "You are not using a virtual or blurred background" },
  { icon: ShieldCheck, text: "You are alone, in a private and quiet place" },
];

/**
 * Step 3: the checks, one at a time. The first unfinished item is open; finishing it opens the next.
 * State lives in the parent so Back / Continue never loses a granted permission.
 */
export function PermissionsStep({
  webcamMode,
  monitorMode,
  snapshotIntervalSeconds,
  retentionDays,
  value,
  onChange,
}: {
  webcamMode: OffOptionalRequired;
  monitorMode: OffOptionalRequired;
  snapshotIntervalSeconds: number;
  retentionDays: number;
  value: PermissionState;
  onChange: (patch: Partial<PermissionState>) => void;
}) {
  const plan = permissionPlan(webcamMode, monitorMode);
  const required = (k: ItemKey) => plan.find((i) => i.key === k)?.required ?? false;
  const firstTodo = plan.find((i) => !itemDone(i.key, value, i.required))?.key ?? null;
  const [open, setOpen] = useState<ItemKey | null>(firstTodo);
  const [tips, setTips] = useState(false);
  const [checkingDisplays, setCheckingDisplays] = useState(false);

  // A finished item hands over to the next unfinished one.
  const doneSig = plan.map((i) => (itemDone(i.key, value, i.required) ? 1 : 0)).join("");
  useEffect(() => {
    setOpen(firstTodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSig]);

  // Fullscreen state follows the browser (Esc, F11), not just our button.
  useEffect(() => {
    const sync = () => onChange({ fullscreen: !!document.fullscreenElement });
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── camera ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]); // leaving the step hands the camera back; the test reopens it
  useEffect(() => {
    if (value.webcam === "granted" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [value.webcam, open]);

  const grantCamera = async () => {
    setTips(false);
    onChange({ webcam: "requesting" });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      stopCamera();
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      onChange({ webcam: "granted" });
    } catch {
      onChange({ webcam: "denied" });
    }
  };

  const runDisplayCheck = async () => {
    setCheckingDisplays(true);
    try {
      onChange({ monitors: await checkDisplays() });
    } finally {
      setCheckingDisplays(false);
    }
  };

  const goFullscreen = () => {
    document.documentElement.requestFullscreen().catch(() => onChange({ fullscreen: false }));
  };

  const minutes = Math.max(1, Math.round(snapshotIntervalSeconds / 60));
  const toggle = (k: ItemKey) => setOpen((o) => (o === k ? null : k));
  const m = value.monitors;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Permissions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A few quick checks so the test runs fairly and nothing surprises you halfway through.
          Complete each one, then start.
        </p>
      </div>

      <div className="space-y-3">
        {plan.some((i) => i.key === "webcam") && (
          <Item
            icon={Camera}
            title="Allow webcam access"
            open={open === "webcam"}
            onToggle={() => toggle("webcam")}
            note={value.webcam === "skipped" ? "Skipped" : undefined}
            tone={
              value.webcam === "granted"
                ? "done"
                : value.webcam === "denied"
                  ? "error"
                  : value.webcam === "skipped"
                    ? "warn"
                    : "todo"
            }
          >
            <p className="leading-relaxed text-muted-foreground">
              Your camera is used for identity verification during the test. A small photo is taken
              about every {minutes} minute
              {snapshotIntervalSeconds >= 90 ? "s" : ""} and shown to the hiring team; photos are
              deleted after {retentionDays} days. No audio or video is recorded.
              {!required("webcam") && " This is optional: you can continue without it."}
            </p>
            {value.webcam === "granted" ? (
              <div className="space-y-2">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  aria-label="Your camera preview"
                  className="h-40 w-56 -scale-x-100 rounded-lg border border-border bg-black object-cover"
                />
                <p className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Camera is working. Make sure your face is
                  clearly visible.
                </p>
              </div>
            ) : value.webcam === "denied" ? (
              <div className="space-y-3">
                <p className="flex items-start gap-1.5 text-destructive">
                  <VideoOff className="mt-0.5 h-4 w-4 shrink-0" />
                  Camera access was blocked. Click the camera icon in your browser&apos;s address
                  bar, choose Allow, then try again.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setTips(true)}>
                    Try again
                  </Button>
                  {!required("webcam") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onChange({ webcam: "skipped" })}
                    >
                      Continue without camera
                    </Button>
                  )}
                </div>
              </div>
            ) : value.webcam === "skipped" ? (
              <div className="flex items-center gap-3">
                <p className="text-amber-600 dark:text-amber-400">
                  You chose to continue without the camera.
                </p>
                <Button size="sm" variant="outline" onClick={() => setTips(true)}>
                  Allow camera
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => setTips(true)}
                  disabled={value.webcam === "requesting"}
                >
                  {value.webcam === "requesting" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Grant access
                </Button>
                {!required("webcam") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onChange({ webcam: "skipped" })}
                  >
                    Skip
                  </Button>
                )}
              </div>
            )}
          </Item>
        )}

        {plan.some((i) => i.key === "monitors") && (
          <Item
            icon={Monitor}
            title="Check for multiple monitors"
            open={open === "monitors"}
            onToggle={() => toggle("monitors")}
            note={
              m?.status === "unknown"
                ? "Couldn't verify in this browser"
                : m?.status === "multiple" && !required("monitors")
                  ? "Extra display will be noted"
                  : undefined
            }
            tone={
              !m
                ? "todo"
                : m.status === "multiple"
                  ? "error"
                  : m.status === "unknown"
                    ? "warn"
                    : "done"
            }
          >
            <p className="leading-relaxed text-muted-foreground">
              Use a single screen during the test, so every candidate has the same conditions.
              {required("monitors")
                ? " An extra display must be disconnected before you can start."
                : " We note it for the hiring team."}
            </p>
            {m?.status === "single" && (
              <p className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-4 w-4" /> Only one display detected.
              </p>
            )}
            {m?.status === "multiple" && (
              <p className="flex items-start gap-1.5 text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {m.count ? `${m.count} displays` : "More than one display"} detected.{" "}
                {required("monitors")
                  ? "Disconnect or turn off the extra display(s), then check again."
                  : "This will be noted for the hiring team. You can disconnect it and check again."}
              </p>
            )}
            {m?.status === "unknown" && (
              <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Your browser can&apos;t tell how many displays are connected (Chrome and Edge can).
                Make sure only one is in use. This will be noted as unverified.
              </p>
            )}
            <Button
              size="sm"
              variant={m ? "outline" : "default"}
              onClick={runDisplayCheck}
              disabled={checkingDisplays}
            >
              {checkingDisplays && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m ? "Check again" : "Check now"}
            </Button>
          </Item>
        )}

        {plan.some((i) => i.key === "fullscreen") && (
          <Item
            icon={Maximize}
            title="Enter fullscreen mode"
            open={open === "fullscreen"}
            onToggle={() => toggle("fullscreen")}
            tone={value.fullscreen ? "done" : "todo"}
          >
            <p className="leading-relaxed text-muted-foreground">
              Fullscreen hides your browser tabs and taskbar so you can focus. Leaving it during the
              test is recorded. Press Esc or F11 to leave it when you finish.
            </p>
            {value.fullscreen ? (
              <p className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-4 w-4" /> Fullscreen is on.
              </p>
            ) : (
              <Button size="sm" onClick={goFullscreen}>
                Enter fullscreen
              </Button>
            )}
          </Item>
        )}
      </div>

      <Dialog open={tips} onOpenChange={setTips}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>For best results, make sure</DialogTitle>
          </DialogHeader>
          <ul className="grid gap-3">
            {TIPS.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
              >
                <Icon className="h-5 w-5 shrink-0 text-primary" />
                {text}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTips(false)}>
              Cancel
            </Button>
            <Button onClick={grantCamera} className="bg-gradient-brand text-primary-foreground">
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
