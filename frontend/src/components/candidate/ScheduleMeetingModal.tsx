/**
 * Schedule Meeting modal — create a persisted, joinable scheduled Peer
 * Interview. Every field is validated on both sides; the row is written to
 * public.peer_scheduled_meetings via FastAPI (service-role client) and shows
 * up in ScheduledMeetingsList after creation.
 *
 * The modal shows a confirmation view AFTER a successful save — with the
 * server-assigned room ID (which the creator can share with an invitee) and
 * the time it's joinable — rather than closing immediately, so nothing
 * about the meeting is unclaimed if the user just walks away from the tab.
 */

import { useMemo, useState } from "react";
import { CalendarClock, Check, Copy, Shield, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { peerService, type ScheduledMeeting } from "@/services/api/candidate/peer";
import { ApiClientError } from "@/services/api/client";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultKeepPrivate?: boolean;
  onScheduled?: (meeting: ScheduledMeeting) => void;
}

/** Local-time-of-input rounded up to the next 15-minute slot, at least 15
 * minutes in the future. Returned as `YYYY-MM-DDTHH:mm` for a native
 * datetime-local input. */
function defaultLocalDateTime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  const step = 15;
  const roundedMin = Math.ceil(now.getMinutes() / step) * step;
  now.setMinutes(roundedMin, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function ScheduleMeetingModal({
  open,
  onOpenChange,
  defaultKeepPrivate = true,
  onScheduled,
}: Props) {
  const [title, setTitle] = useState("");
  const [dateTimeLocal, setDateTimeLocal] = useState(defaultLocalDateTime);
  const [duration, setDuration] = useState<number>(30);
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [keepPrivate, setKeepPrivate] = useState(defaultKeepPrivate);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<ScheduledMeeting | null>(null);
  const bumpScheduledMeetings = usePeerInterviewStore((s) => s.bumpScheduledMeetings);

  const minLocal = useMemo(() => defaultLocalDateTime(), []);
  // Note: we use `min` on the input for browser-side hinting but the server
  // is the source of truth (`scheduled_at cannot be in the past`).

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!dateTimeLocal) {
      setErrorMsg("Pick a date and time.");
      return;
    }
    // datetime-local carries no timezone → interpret as the user's local time
    // and convert to a proper ISO string with timezone offset for the server.
    const localDate = new Date(dateTimeLocal);
    if (Number.isNaN(localDate.getTime())) {
      setErrorMsg("Invalid date/time.");
      return;
    }
    if (localDate.getTime() < Date.now() - 60_000) {
      setErrorMsg("Meeting time must be in the future.");
      return;
    }

    setSubmitting(true);
    try {
      const meeting = await peerService.createScheduledMeeting({
        title: title.trim() || undefined,
        scheduled_at: localDate.toISOString(),
        duration_minutes: duration,
        keep_private: keepPrivate,
        invitee_email: inviteeEmail.trim() || undefined,
      });
      setCreated(meeting);
      bumpScheduledMeetings();
      onScheduled?.(meeting);
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not schedule the meeting.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setTitle("");
    setDateTimeLocal(defaultLocalDateTime());
    setDuration(30);
    setInviteeEmail("");
    setKeepPrivate(defaultKeepPrivate);
    setErrorMsg(null);
    setCreated(null);
    setSubmitting(false);
  };

  const closeAll = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={closeAll}>
      <DialogContent className="sm:max-w-lg overflow-hidden border-border/60 p-0">
        {created ? (
          <ConfirmationPanel
            meeting={created}
            onCopyRoomId={async (id) => {
              try {
                await navigator.clipboard.writeText(id);
                toast.success("Room ID copied");
              } catch {
                toast.error("Could not copy — select the ID and copy manually.");
              }
            }}
            onClose={() => closeAll(false)}
            onScheduleAnother={reset}
          />
        ) : (
          <form onSubmit={submit}>
            <DialogHeader className="px-6 pt-6">
              <div className="mx-auto mb-1 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <CalendarClock className="h-3 w-3" />
                Schedule
              </div>
              <DialogTitle>Schedule a Peer Interview</DialogTitle>
              <DialogDescription>
                We'll reserve a room and let you join it at the scheduled time.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 px-6 py-5">
              <div>
                <Label htmlFor="schedule-title" className="text-xs font-medium text-muted-foreground">
                  Topic (optional)
                </Label>
                <Input
                  id="schedule-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Systems design practice"
                  maxLength={120}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="schedule-when" className="text-xs font-medium text-muted-foreground">
                    Date &amp; time
                  </Label>
                  <Input
                    id="schedule-when"
                    type="datetime-local"
                    min={minLocal}
                    value={dateTimeLocal}
                    onChange={(e) => setDateTimeLocal(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="schedule-duration" className="text-xs font-medium text-muted-foreground">
                    Duration (min)
                  </Label>
                  <Input
                    id="schedule-duration"
                    type="number"
                    min={5}
                    max={240}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 30)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="schedule-invitee" className="text-xs font-medium text-muted-foreground">
                  Invite a specific candidate by email (optional)
                </Label>
                <Input
                  id="schedule-invitee"
                  type="email"
                  value={inviteeEmail}
                  onChange={(e) => setInviteeEmail(e.target.value)}
                  placeholder="peer@example.com"
                  autoComplete="off"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  If they use Mirracle with this email, the meeting will show
                  up on their dashboard automatically. Otherwise, share the
                  room ID with them yourself.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3">
                <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                  <Shield className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Keep my identity private</span>
                    <Switch
                      checked={keepPrivate}
                      onCheckedChange={setKeepPrivate}
                      aria-label="Keep identity private"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your peer sees you as “Anonymous Candidate.”
                  </p>
                </div>
              </label>

              {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => closeAll(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-brand text-primary-foreground"
                  disabled={submitting}
                >
                  {submitting ? "Scheduling…" : "Schedule meeting"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationPanel({
  meeting,
  onCopyRoomId,
  onClose,
  onScheduleAnother,
}: {
  meeting: ScheduledMeeting;
  onCopyRoomId: (id: string) => void;
  onClose: () => void;
  onScheduleAnother: () => void;
}) {
  const when = new Date(meeting.scheduled_at);
  return (
    <div>
      <DialogHeader className="px-6 pt-6">
        <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
          <Check className="h-3 w-3" />
          Meeting scheduled
        </div>
        <DialogTitle>You're all set</DialogTitle>
        <DialogDescription>
          {meeting.title ? `"${meeting.title}" · ` : ""}
          {when.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" · "}
          {meeting.duration_minutes} min
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-6 py-5">
        <div className="rounded-xl border border-primary/30 bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Room ID
              </div>
              <code className="mt-1 block truncate font-mono text-sm font-semibold tracking-wider">
                {meeting.room_id}
              </code>
            </div>
            <Button size="sm" variant="outline" onClick={() => onCopyRoomId(meeting.room_id)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Share this room ID with your peer or tell them to sign in and click
            Peer Interview → Join with a room ID.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          The meeting will appear on your dashboard. Join will unlock 5 minutes
          before the scheduled start time.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onScheduleAnother}>
            <CalendarClock className="mr-1.5 h-4 w-4" />
            Schedule another
          </Button>
          <Button className="bg-gradient-brand text-primary-foreground" onClick={onClose}>
            Done
            <X className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
