import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Archive, Pencil, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import type { InterviewTemplate } from "@/types/company/aiInterview";
import { InvitesPanel } from "./InvitesPanel";
import { ResultsPanel } from "./ResultsPanel";
import { TemplateFormDialog } from "./TemplateFormDialog";
import { LEVEL_LABEL, STATUS_LABEL } from "./rubric";

function RubricView({ t }: { t: InterviewTemplate }) {
  return (
    <ol className="space-y-3">
      {t.rubric.map((c) => (
        <li key={c.name} className="rounded-lg border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-medium">{c.name}</h4>
            <span className="text-sm tabular-nums text-muted-foreground">
              {c.weight_pct}% of the score
            </span>
          </div>
          {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
          {c.questions.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {c.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TemplateWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: t, isLoading } = useQuery({
    queryKey: ["company-ai-interviews", id],
    queryFn: () => companyAiInterviewService.get(id),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["company-ai-interviews"] });
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const activate = useMutation({
    mutationFn: () => companyAiInterviewService.update(id, { status: "active" }),
    onSuccess: () => {
      toast.success("Interview activated. You can invite candidates now.");
      refresh();
    },
    onError,
  });
  const archive = useMutation({
    mutationFn: () => companyAiInterviewService.archive(id),
    onSuccess: () => {
      toast.success("Interview archived. Invitations no longer work; results stay.");
      refresh();
      onBack();
    },
    onError,
  });

  if (isLoading || !t) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> All interviews
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">
            {t.role_title} · {LEVEL_LABEL[t.level]} · {t.duration_minutes} min · version {t.version}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={t.status === "active" ? "default" : "secondary"}>
            {STATUS_LABEL[t.status]}
          </Badge>
          {t.status === "draft" && (
            <Button size="sm" onClick={() => activate.mutate()} disabled={activate.isPending}>
              <Play className="mr-1.5 h-4 w-4" /> Activate
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-4 w-4" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
          >
            <Archive className="mr-1.5 h-4 w-4" /> Archive
          </Button>
        </div>
      </div>

      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites">
            Invitations ({t.counts.invited + t.counts.started + t.counts.completed})
          </TabsTrigger>
          <TabsTrigger value="results">
            Results ({t.counts.started + t.counts.completed})
          </TabsTrigger>
          <TabsTrigger value="rubric">Rubric</TabsTrigger>
        </TabsList>
        <TabsContent value="invites" className="mt-4">
          <InvitesPanel template={t} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsPanel templateId={t.id} />
        </TabsContent>
        <TabsContent value="rubric" className="mt-4">
          <RubricView t={t} />
        </TabsContent>
      </Tabs>

      <TemplateFormDialog open={editing} onOpenChange={setEditing} template={t} />
    </div>
  );
}
