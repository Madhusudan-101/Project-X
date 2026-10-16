import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_TAGS,
  MAX_FEEDBACK_COMMENT,
  peerSafetyService,
} from "@/services/api/candidate/peerSafety";

/** "How was your session?" for a meeting (null room = closed). Your partner never sees this. */
export function PeerFeedbackDialog({
  roomId,
  onClose,
  onSaved,
}: {
  roomId: string | null;
  onClose: () => void;
  onSaved?: (roomId: string, rating: number) => void;
}) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roomId) {
      setRating(0);
      setTags([]);
      setComment("");
      setError(null);
    }
  }, [roomId]);

  const toggle = (id: string) =>
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const save = async () => {
    if (!roomId || rating < 1) return;
    setBusy(true);
    setError(null);
    try {
      await peerSafetyService.saveFeedback({
        room_id: roomId,
        rating,
        tags,
        comment: comment.trim(),
      });
      toast.success("Thanks for the feedback");
      onSaved?.(roomId, rating);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your feedback. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!roomId} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How was your session?</DialogTitle>
          <DialogDescription>
            Your answer helps us match people better. Your partner never sees it.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Rating" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setRating(n)}
              className="rounded p-1 focus-visible:outline focus-visible:outline-2"
            >
              <Star
                className={`h-7 w-7 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
              />
            </button>
          ))}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What stood out? (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={tags.includes(t.id) ? "default" : "outline"}
                aria-pressed={tags.includes(t.id)}
                onClick={() => toggle(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="feedback-comment">Anything else? (optional)</Label>
          <Textarea
            id="feedback-comment"
            rows={2}
            maxLength={MAX_FEEDBACK_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Skip
          </Button>
          <Button onClick={save} disabled={busy || rating < 1}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
