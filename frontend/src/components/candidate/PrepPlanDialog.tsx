import { useQuery } from "@tanstack/react-query";
import { CircleDot, Clock, Loader2, RefreshCw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { candidateJobsService } from "@/services/api/candidate/jobs";
import type { PrepPlan } from "@/types/jobs";

interface PrepPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string | null;
  jobTitle?: string | null;
}

export function PrepPlanDialog({
  open,
  onOpenChange,
  applicationId,
  jobTitle,
}: PrepPlanDialogProps) {
  const {
    data: plan,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery<PrepPlan>({
    queryKey: ["prep-plan", applicationId],
    queryFn: () => candidateJobsService.getPrepPlan(applicationId as string),
    enabled: open && !!applicationId,
    staleTime: Infinity,
    retry: false,
  });

  const regenerate = () =>
    candidateJobsService.getPrepPlan(applicationId as string, true).then(() => refetch());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preparation plan</DialogTitle>
          <DialogDescription>
            {jobTitle
              ? `Tailored to ${jobTitle} and this drive's rounds.`
              : "Tailored to this job."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Building your plan from your job score…
          </div>
        ) : isError ? (
          <div className="py-8 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not build a plan yet."}
          </div>
        ) : plan ? (
          <div className="space-y-5">
            <p className="text-base font-medium leading-snug">{plan.headline}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{plan.standingSummary}</p>

            {/* Priority focus */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <Target className="h-3.5 w-3.5" /> Priority focus
              </p>
              <p className="mt-1.5 text-sm font-medium">{plan.priorityFocus.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{plan.priorityFocus.why}</p>
            </div>

            {/* Phases */}
            <div className="space-y-3">
              {plan.phases
                .filter((ph) => ph.applies)
                .map((ph) => (
                  <div key={ph.name} className="rounded-lg border border-border/70 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{ph.name}</h4>
                      <Badge variant="outline" className="text-[11px]">
                        {ph.timeframe}
                      </Badge>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {ph.actionItems.map((item, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              {plan.phases.some((ph) => !ph.applies) && (
                <p className="text-[11px] text-muted-foreground">
                  Not applicable for this drive:{" "}
                  {plan.phases
                    .filter((ph) => !ph.applies)
                    .map((ph) => ph.name)
                    .join(", ")}
                  .
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Estimated: {plan.estimatedPrepTime}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={regenerate}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
