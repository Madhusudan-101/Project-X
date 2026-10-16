import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { peerService, type ScheduledMeeting } from "@/services/api/candidate/peer";

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO time as the `YYYY-MM-DDTHH:mm` a datetime-local input wants, in the person's own timezone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Why a new time cannot be used, or null. The server checks again. */
export function validateNewTime(local: string, now: Date = new Date()): string | null {
  if (!local) return "Pick a date and time.";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "That date is not valid.";
  if (d.getTime() < now.getTime() - 60_000) return "Pick a time in the future.";
  return null;
}

export function RescheduleDialog({
  meeting,
  onClose,
  onMoved,
}: {
  meeting: ScheduledMeeting | null;
  onClose: () => void;
  onMoved: (m: ScheduledMeeting) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (meeting) {
      setValue(toLocalInput(meeting.scheduled_at));
      setError(null);
    }
  }, [meeting]);

  const save = async () => {
    const problem = validateNewTime(value);
    if (problem || !meeting) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const moved = await peerService.rescheduleMeeting(meeting.id, new Date(value).toISOString());
      toast.success(meeting.invitee_id ? "Moved. Your invitee was emailed." : "Moved.");
      onMoved(moved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the meeting.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!meeting} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move this meeting</DialogTitle>
          <DialogDescription>
            Pick a new time in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            {meeting?.invitee_id ? " Your invitee will be told." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-time">New date and time</Label>
          <Input
            id="reschedule-time"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Move meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
