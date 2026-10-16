import { useState } from "react";
import {
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Scissors,
  Video,
  VideoOff,
  Waypoints,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  IntegrityEvent,
  IntegrityEventType,
  IntegrityTimeline,
} from "@/types/company/assessment";
import { fmtDuration } from "./format";

/** A paste at least this long into the code editor is worth a recruiter's attention. */
export const LARGE_PASTE_CHARS = 200;

const LABEL: Record<IntegrityEventType, string> = {
  tab_switch: "Left the tab",
  tab_return: "Back on the tab",
  window_blur: "Window lost focus",
  window_focus: "Window regained focus",
  fullscreen_exit: "Left fullscreen",
  fullscreen_enter: "Entered fullscreen",
  paste: "Pasted",
  copy: "Copied",
  cut: "Cut",
  camera_denied: "Camera blocked",
  camera_lost: "Camera turned off",
  camera_restored: "Camera back on",
};

const ICON: Record<IntegrityEventType, typeof Eye> = {
  tab_switch: EyeOff,
  tab_return: Eye,
  window_blur: EyeOff,
  window_focus: Eye,
  fullscreen_exit: Minimize,
  fullscreen_enter: Maximize,
  paste: ClipboardPaste,
  copy: Copy,
  cut: Scissors,
  camera_denied: VideoOff,
  camera_lost: VideoOff,
  camera_restored: Video,
};

const CONCERNING: IntegrityEventType[] = [
  "tab_switch",
  "window_blur",
  "fullscreen_exit",
  "paste",
  "camera_denied",
  "camera_lost",
];

function clock(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isLargePaste(e: IntegrityEvent): boolean {
  return e.type === "paste" && (e.length ?? 0) >= LARGE_PASTE_CHARS;
}

export function IntegrityTimelineCard({ timeline }: { timeline: IntegrityTimeline }) {
  const [onlyConcerning, setOnlyConcerning] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const { items, counts } = timeline;
  const shown = items
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !onlyConcerning || CONCERNING.includes(e.type));
  const large = items.filter(isLargePaste).length;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Waypoints className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">Activity timeline</h3>
        {large > 0 && (
          <Badge variant="destructive">
            {large} large paste{large === 1 ? "" : "s"} (largest {timeline.largestPaste} chars)
          </Badge>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyConcerning}
            onChange={(e) => setOnlyConcerning(e.target.checked)}
          />
          Only leaves &amp; pastes
        </label>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing was recorded for this attempt. (Attempts taken before the timeline existed only
          have the counters above.)
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {(Object.keys(LABEL) as IntegrityEventType[])
              .filter((t) => counts[t])
              .map((t) => `${counts[t]} × ${LABEL[t].toLowerCase()}`)
              .join(" · ")}
          </p>
          <ol className="space-y-1">
            {shown.map(({ e, i }) => {
              const Icon = ICON[e.type];
              const hasText = !!e.text;
              const bad =
                isLargePaste(e) ||
                e.type === "tab_switch" ||
                e.type === "fullscreen_exit" ||
                e.type === "camera_denied" ||
                e.type === "camera_lost";
              return (
                <li key={i} className="rounded px-2 py-1 text-xs hover:bg-muted/50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
                      {clock(e.offsetSeconds)}
                    </span>
                    <Icon
                      className={
                        "h-3.5 w-3.5 " + (bad ? "text-destructive" : "text-muted-foreground")
                      }
                    />
                    <span className={bad ? "font-medium" : ""}>{LABEL[e.type]}</span>
                    {e.awayMs != null && (
                      <span className="text-muted-foreground">
                        after {fmtDuration(Math.round(e.awayMs / 1000))} away
                      </span>
                    )}
                    {e.length != null && (
                      <span className="text-muted-foreground">
                        {e.length} char{e.length === 1 ? "" : "s"}
                        {e.target === "editor"
                          ? " · in the editor"
                          : e.target === "other"
                            ? " · from the page"
                            : ""}
                      </span>
                    )}
                    {e.question && (
                      <span className="ml-auto truncate text-muted-foreground">
                        Q{e.question.position} · {e.question.title}
                      </span>
                    )}
                    {hasText && (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => setOpenIdx(openIdx === i ? null : i)}
                      >
                        {openIdx === i ? "hide" : "show"}
                      </button>
                    )}
                  </div>
                  {hasText && openIdx === i && (
                    <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-[#0f1320] p-3 font-mono text-xs leading-5 text-slate-100">
                      {e.text}
                      {e.truncated
                        ? `\n… (${e.length} chars total, first ${e.text?.length} shown)`
                        : ""}
                    </pre>
                  )}
                </li>
              );
            })}
          </ol>
          {timeline.capped && (
            <p className="text-xs text-muted-foreground">
              Showing the first {items.length} events; the counters above include everything.
            </p>
          )}
        </>
      )}
    </section>
  );
}
