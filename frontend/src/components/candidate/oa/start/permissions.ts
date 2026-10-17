import type { OADisplayCheck, OffOptionalRequired } from "@/types/candidate/assessment";

export type WebcamState = "pending" | "requesting" | "granted" | "denied" | "skipped";

export interface PermissionState {
  webcam: WebcamState;
  monitors: OADisplayCheck | null;
  fullscreen: boolean;
}

export const initialPermissions: PermissionState = {
  webcam: "pending",
  monitors: null,
  fullscreen: false,
};

export type ItemKey = "webcam" | "monitors" | "fullscreen";

/** Which permission items this test needs, and whether each is mandatory. */
export function permissionPlan(webcamMode: OffOptionalRequired, monitorMode: OffOptionalRequired) {
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  return [
    ...(webcamMode !== "off"
      ? [{ key: "webcam" as ItemKey, required: webcamMode === "required" }]
      : []),
    ...(monitorMode !== "off"
      ? [{ key: "monitors" as ItemKey, required: monitorMode === "required" }]
      : []),
    ...(canFullscreen ? [{ key: "fullscreen" as ItemKey, required: true }] : []),
  ];
}

/** Is this item finished, so the candidate may move on? */
export function itemDone(key: ItemKey, p: PermissionState, required: boolean): boolean {
  if (key === "webcam") return p.webcam === "granted" || (!required && p.webcam === "skipped");
  if (key === "monitors") return !!p.monitors && (!required || p.monitors.status !== "multiple");
  return p.fullscreen;
}

export function permissionsReady(
  webcamMode: OffOptionalRequired,
  monitorMode: OffOptionalRequired,
  p: PermissionState,
): boolean {
  return permissionPlan(webcamMode, monitorMode).every((i) => itemDone(i.key, p, i.required));
}
