import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";

const LABELS = ["Poor", "Fair", "Good", "Very good", "Excellent"];
const MAX_CHARS = 2000;

/**
 * Asked once, right after the assessment is submitted: 1-5 stars and an optional note about the
 * experience. It is never required, and it never touches the score or the recruiter's decision
 * about the candidate; recruiters see it as feedback on the assessment itself.
 */
export function FeedbackCard({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient();
  const key = ["candidate-oa", applicationId, "feedback"];
  const saved = useQuery({
    queryKey: key,
    queryFn: () => candidateAssessmentService.getFeedback(applicationId),
    retry: false,
    staleTime: Infinity,
  });
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");

  const send = useMutation({
    mutationFn: () => candidateAssessmentService.sendFeedback(applicationId, { rating, comment }),
    onSuccess: () => {
      queryClient.setQueryData(key, { submitted: true, rating, comment: comment.trim() || null });
      toast.success("Thanks for your feedback.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not send your feedback."),
  });

  if (saved.isLoading) return null;

  if (saved.data?.submitted) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-4 text-center">
        <Stars value={saved.data.rating ?? 0} readOnly />
        <p className="text-sm font-medium">Thanks for your feedback!</p>
        <p className="text-xs text-muted-foreground">
          It helps the hiring team improve the assessment.
        </p>
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <div className="space-y-3 rounded-lg border border-border p-4 text-left">
      <p className="text-center text-sm font-medium">How was your assessment experience?</p>
      <div className="flex flex-col items-center gap-1">
        <Stars value={shown} onPick={setRating} onHover={setHover} />
        <span className="h-4 text-xs text-muted-foreground" aria-live="polite">
          {shown ? LABELS[shown - 1] : "Tap a star"}
        </span>
      </div>
      <div className="space-y-1">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_CHARS))}
          placeholder="Anything to tell us? Clarity of the questions, the code editor, timing, technical problems… (optional)"
          rows={4}
          aria-label="Your feedback"
        />
        <p className="text-right text-[11px] text-muted-foreground">
          {comment.length}/{MAX_CHARS}
        </p>
      </div>
      <Button
        onClick={() => send.mutate()}
        disabled={rating === 0 || send.isPending}
        className="w-full bg-gradient-brand text-primary-foreground"
      >
        {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit feedback
      </Button>
    </div>
  );
}

function Stars({
  value,
  onPick,
  onHover,
  readOnly,
}: {
  value: number;
  onPick?: (n: number) => void;
  onHover?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      role={readOnly ? "img" : "radiogroup"}
      aria-label={readOnly ? `${value} out of 5 stars` : "Rating"}
      className="flex justify-center gap-1"
      onMouseLeave={() => onHover?.(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const star = (
          <Star
            className={
              "h-8 w-8 transition-colors " +
              (n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")
            }
          />
        );
        return readOnly ? (
          <span key={n}>{star}</span>
        ) : (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onPick?.(n)}
            onMouseEnter={() => onHover?.(n)}
            onFocus={() => onHover?.(n)}
            onBlur={() => onHover?.(0)}
            className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}
