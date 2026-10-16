import type { RefObject } from "react";
import { Video, VideoOff } from "lucide-react";
import type { CameraStatus } from "./useProctorCamera";

/** The candidate always sees what the camera sees: a small self-view with a status dot. */
export function CameraPreview({
  videoRef,
  status,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
}) {
  const on = status === "on";
  return (
    <div
      className="flex items-center gap-2"
      title={on ? "Your camera is on for this assessment" : "Your camera is off"}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Your camera"
        className={
          "h-9 w-12 -scale-x-100 rounded border border-border bg-black object-cover " +
          (on ? "" : "hidden")
        }
      />
      <span
        className={"flex items-center gap-1 text-xs " + (on ? "text-success" : "text-destructive")}
      >
        {on ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
        {on ? "Camera on" : status === "starting" ? "Starting camera…" : "Camera off"}
      </span>
    </div>
  );
}
