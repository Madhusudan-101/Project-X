import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  peerSafetyService,
  validateReport,
  type ReportReason,
} from "@/services/api/candidate/peerSafety";

interface Props {
  /** The meeting to report about (null = closed). The server works out who the other person was. */
  roomId: string | null;
  onClose: () => void;
}

export function PeerReportDialog({ roomId, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocked: boolean } | null>(null);

  useEffect(() => {
    if (roomId) {
      setReason("");
      setDetails("");
      setBlock(true);
      setError(null);
      setDone(null);
    }
  }, [roomId]);

  const submit = async () => {
    const problem = validateReport(reason, details);
    if (problem || !roomId || !reason) return setError(problem ?? "Choose a reason.");
    setBusy(true);
    setError(null);
    try {
      const res = await peerSafetyService.report({
        room_id: roomId,
        reason,
        details: details.trim(),
        block,
      });
      setDone({ blocked: res.blocked });
      toast.success("Report sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not send your report. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!roomId} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report this person</DialogTitle>
          <DialogDescription>
            Reports are reviewed by people at Mirracle. The other person is not told that you
            reported them. Please only report real problems: false reports can lead to penalties.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div role="status" className="space-y-3 text-sm">
            <p>
              Thank you. Your report is with the Mirracle team.
              {done.blocked ? " You will not be matched with this person again." : ""}
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What happened?</legend>
              <RadioGroup value={reason} onValueChange={(v) => setReason(v as ReportReason)}>
                {REPORT_REASONS.map((r) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <RadioGroupItem id={`report-${r.id}`} value={r.id} />
                    <Label htmlFor={`report-${r.id}`} className="font-normal">
                      {r.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea
                id="report-details"
                value={details}
                maxLength={MAX_REPORT_DETAILS}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {details.length}/{MAX_REPORT_DETAILS}
              </p>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="report-block"
                checked={block}
                onCheckedChange={(v) => setBlock(v === true)}
              />
              <Label htmlFor="report-block" className="font-normal">
                Also block this person, so we never match you again.
              </Label>
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
              <Button onClick={submit} disabled={busy || !reason}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send report
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
