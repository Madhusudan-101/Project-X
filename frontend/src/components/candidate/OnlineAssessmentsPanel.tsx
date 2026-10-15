import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { candidateAssessmentService } from "@/services/api/candidate/assessment";
import type { OAListItem, OAState } from "@/types/candidate/assessment";

const STATE_LABEL: Record<OAState, string> = {
  unscheduled: "Dates TBA",
  upcoming: "Upcoming",
  open: "Open now",
  closed: "Window closed",
  in_progress: "In progress",
  submitted: "Submitted",
};

const STATE_CLASS: Partial<Record<OAState, string>> = {
  open: "border-success/40 bg-success/10 text-success",
  in_progress: "border-primary/30 bg-primary/10 text-primary",
  closed: "border-destructive/30 bg-destructive/5 text-destructive",
};

const ACTION_LABEL: Partial<Record<OAState, string>> = {
  open: "Start",
  in_progress: "Resume",
  upcoming: "View details",
  unscheduled: "View details",
  submitted: "View",
  closed: "View",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Lists the candidate's online assessments. Renders nothing when there are none. */
export function OnlineAssessmentsPanel() {
  const { data } = useQuery<OAListItem[]>({
    queryKey: ["candidate-oa"],
    queryFn: () => candidateAssessmentService.list(),
    refetchInterval: 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <ClipboardCheck className="h-5 w-5 text-primary" />
        Online assessments
      </h2>
      <div className="space-y-2">
        {data.map((oa) => (
          <Card
            key={oa.applicationId}
            className={
              "flex flex-wrap items-center justify-between gap-3 p-4 " +
              (oa.state === "open" || oa.state === "in_progress" ? "border-primary/40" : "")
            }
          >
            <div>
              <div className="text-sm font-medium">{oa.jobTitle}</div>
              <div className="text-xs text-muted-foreground">
                {oa.companyName} · {fmt(oa.windowStart)} → {fmt(oa.windowEnd)}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={STATE_CLASS[oa.state] ?? "text-muted-foreground"}>
                {STATE_LABEL[oa.state]}
              </Badge>
              <Button
                asChild
                size="sm"
                variant={oa.state === "open" || oa.state === "in_progress" ? "default" : "outline"}
              >
                <Link
                  to="/candidate-oa/$applicationId"
                  params={{ applicationId: oa.applicationId }}
                >
                  {ACTION_LABEL[oa.state]}
                </Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
