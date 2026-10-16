import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { peerService, type PeerHistoryItem } from "@/services/api/candidate/peer";
import { PeerFeedbackDialog } from "./PeerFeedbackDialog";
import { PeerReportDialog } from "./PeerReportDialog";

export const STATUS_LABEL: Record<string, string> = {
  completed: "Finished",
  ended: "Ended",
  scheduled: "Upcoming",
  waiting: "Waiting",
  live: "In progress",
  cancelled: "Cancelled",
  expired: "Nobody joined",
  no_show: "Partner did not come",
};

export type HistoryFilter = "all" | "matched" | "scheduled" | "needs-feedback";

/** Which rows a filter keeps. "Needs feedback" = a real session with a partner I have not rated yet. */
export function filterHistory(items: PeerHistoryItem[], filter: HistoryFilter): PeerHistoryItem[] {
  switch (filter) {
    case "matched":
    case "scheduled":
      return items.filter((i) => i.kind === filter);
    case "needs-feedback":
      return items.filter(
        (i) =>
          i.can_report_or_rate && !i.rated && ["completed", "ended", "live"].includes(i.status),
      );
    default:
      return items;
  }
}

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "matched", label: "Instant matches" },
  { id: "scheduled", label: "Scheduled" },
  { id: "needs-feedback", label: "Not rated yet" },
];

export function PeerHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [items, setItems] = useState<PeerHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [reportRoom, setReportRoom] = useState<string | null>(null);
  const [rateRoom, setRateRoom] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    peerService
      .history()
      .then(setItems)
      .catch(() => setError("Could not load your history. Check your connection and try again."));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const shown = useMemo(() => filterHistory(items ?? [], filter), [items, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Peer interview history</DialogTitle>
          <DialogDescription>
            Every session you took part in. Partners are named only if they chose to be visible.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter history">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "outline"}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            <button type="button" className="underline" onClick={load}>
              Retry
            </button>
          </p>
        )}
        {items === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {items && shown.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No peer interviews yet. Find a partner or schedule one to get started."
              : "Nothing matches this filter."}
          </p>
        )}

        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={`${i.kind}-${i.room_id}`} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">
                      {i.title || (i.kind === "matched" ? "Instant match" : "Scheduled interview")}
                    </span>
                    <Badge variant="outline">{STATUS_LABEL[i.status] ?? i.status}</Badge>
                    {i.blocked && <Badge variant="outline">Blocked</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(i.when).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {i.partner_label ?? "No partner joined"}
                    {i.has_report ? " · feedback report ready" : ""}
                  </div>
                </div>
                {i.can_report_or_rate && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setRateRoom(i.room_id)}>
                      {i.rated ? "Change rating" : "Rate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setReportRoom(i.room_id)}
                    >
                      Report
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <PeerReportDialog roomId={reportRoom} onClose={() => setReportRoom(null)} />
        <PeerFeedbackDialog
          roomId={rateRoom}
          onClose={() => setRateRoom(null)}
          onSaved={(room) =>
            setItems((all) =>
              (all ?? []).map((x) => (x.room_id === room ? { ...x, rated: true } : x)),
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
