import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import { TemplateFormDialog } from "./TemplateFormDialog";
import { TemplateWorkspace } from "./TemplateWorkspace";
import { LEVEL_LABEL, STATUS_LABEL } from "./rubric";

/** The company's AI interviews: set one up for a role, invite candidates, read the results. */
export function AiInterviewStudio() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["company-ai-interviews"],
    queryFn: () => companyAiInterviewService.list(),
  });

  if (openId) return <TemplateWorkspace id={openId} onBack={() => setOpenId(null)} />;

  const templates = data ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">AI Interviews</h2>
          <p className="text-sm text-muted-foreground">
            Set up an interview for a role, choose what it scores, invite candidates and read the
            results.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-gradient-brand text-primary-foreground"
        >
          <Plus className="mr-1.5 h-4 w-4" /> New interview
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load your interviews. Try again.</p>
      ) : templates.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Video className="h-8 w-8 text-muted-foreground" aria-hidden />
          <h3 className="font-display text-lg font-semibold">No interviews yet</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Pick a role and a rubric, and the AI interviewer will run a voice and video interview
            with every candidate you invite. You get a scored report for each one.
          </p>
          <Button onClick={() => setCreating(true)}>Create your first interview</Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="rounded-xl border bg-card p-5 text-left transition hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-semibold">{t.title}</h3>
                <Badge variant={t.status === "active" ? "default" : "secondary"}>
                  {STATUS_LABEL[t.status]}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t.role_title} · {LEVEL_LABEL[t.level]} · {t.duration_minutes} min
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.rubric.map((c) => (
                  <Badge key={c.name} variant="outline" className="font-normal">
                    {c.name} {c.weight_pct}%
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-sm tabular-nums text-muted-foreground">
                {t.counts.invited} invited · {t.counts.started} in progress · {t.counts.completed}{" "}
                completed
              </p>
            </button>
          ))}
        </div>
      )}

      <TemplateFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(t) => setOpenId(t.id)}
      />
    </div>
  );
}
