import { Building2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AiInterviewAssignment } from "@/types/candidate/aiInterview";

const LEVEL = { intern: "Intern", junior: "Junior", mid: "Mid-level", senior: "Senior" } as const;

const STATUS: Record<AiInterviewAssignment["status"], { label: string; note: string }> = {
  invited: { label: "Ready to take", note: "You can take this interview once." },
  started: { label: "Started", note: "You have already used your attempt." },
  completed: { label: "Submitted", note: "Your responses were sent to the hiring team." },
  expired: { label: "Expired", note: "This invitation is past its deadline." },
};

/** Interviews companies have sent this candidate. Practice stays separate, below. */
export function AssignedInterviews({
  assignments,
  onStart,
}: {
  assignments: AiInterviewAssignment[];
  onStart: (a: AiInterviewAssignment) => void;
}) {
  if (assignments.length === 0) return null;
  return (
    <section aria-labelledby="assigned-h" className="space-y-3">
      <div>
        <h2 id="assigned-h" className="font-display text-lg font-semibold">
          Interviews from companies
        </h2>
        <p className="text-sm text-muted-foreground">
          These count. Take them in a quiet room with a working camera and microphone.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {assignments.map((a) => (
          <Card key={a.id} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4" aria-hidden /> {a.company_name}
                </p>
                <h3 className="font-display text-lg font-semibold">{a.role_title}</h3>
              </div>
              <Badge variant={a.status === "invited" ? "default" : "secondary"}>
                {STATUS[a.status].label}
              </Badge>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{LEVEL[a.level]}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden /> Up to {a.duration_minutes} min
              </span>
              {a.status === "invited" && (
                <span>Start before {new Date(a.expires_at).toLocaleDateString()}</span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">{STATUS[a.status].note}</p>
            {a.status === "invited" && (
              <Button
                className="mt-auto w-full bg-gradient-brand text-primary-foreground"
                onClick={() => onStart(a)}
                aria-label={`Start the ${a.role_title} interview for ${a.company_name}`}
              >
                Start interview
              </Button>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
