import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Calendar, Layers, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyGuard } from "@/hooks/company/use-company-guard";
import { jobsService } from "@/services/api/company/jobs";
import { JobFormDialog } from "@/components/company/jobs/JobFormDialog";
import { DriveRoundsPanel } from "@/components/company/jobs/DriveRoundsPanel";
import {
  EMPLOYMENT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  INTERVIEW_MODE_LABELS,
  type Job,
} from "@/types/jobs";

export const Route = createFileRoute("/company-jobs/$jobId")({
  head: ({ params }) => ({ meta: [{ title: `Job — ${params.jobId} — Mirracle` }] }),
  component: JobDetailPage,
});

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const session = useCompanyGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);

  const {
    data: job,
    isLoading,
    isError,
  } = useQuery<Job>({
    queryKey: ["company-jobs", jobId],
    queryFn: () => jobsService.getById(jobId),
    enabled: !!session,
    retry: false,
  });

  const publishMutation = useMutation({
    mutationFn: () => jobsService.publish(jobId),
    onSuccess: () => {
      toast.success("Job published.");
      queryClient.invalidateQueries({ queryKey: ["company-jobs"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Publish failed."),
  });

  if (!session) return null;

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 md:px-8">
          <Link
            to="/company-jobs"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All jobs
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError || !job ? (
          <Card className="p-10 text-center">
            <p className="text-sm font-medium text-destructive">Job not found.</p>
            <button
              onClick={() => navigate({ to: "/company-jobs" })}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Back to jobs
            </button>
          </Card>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-2xl font-bold md:text-3xl">{job.title}</h1>
                  <Badge variant="outline" className="capitalize">
                    {job.status}
                  </Badge>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm capitalize text-muted-foreground">
                  <span>{job.domain}</span>
                  <span>·</span>
                  <span>{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</span>
                  <span>·</span>
                  <span>{INTERVIEW_MODE_LABELS[job.interviewMode]}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                {job.status === "draft" && (
                  <Button
                    onClick={() => publishMutation.mutate()}
                    className="bg-gradient-brand text-primary-foreground"
                  >
                    Publish
                  </Button>
                )}
              </div>
            </div>

            {/* Key facts + weights */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Fact
                  icon={Layers}
                  label="Experience"
                  value={EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}
                />
                <Fact icon={MapPin} label="Location" value={job.location} />
                <Fact
                  icon={Calendar}
                  label="Deadline"
                  value={new Date(job.deadline).toLocaleDateString()}
                />
                <Fact icon={Users} label="Openings" value={String(job.openingsCount)} />
              </Card>
              <Card className="p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scoring weights
                </h2>
                {job.weights ? (
                  <div className="mt-3 space-y-1.5 text-sm">
                    {[
                      ["Resume", job.weights.resumeWeight],
                      ["GitHub", job.weights.githubWeight],
                      ["LeetCode", job.weights.leetcodeWeight],
                      ["Interview", job.weights.interviewWeight],
                      ["Assessment", job.weights.assessmentWeight],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium tabular-nums">{val}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No weights set.</p>
                )}
              </Card>
            </div>

            {/* Description */}
            <Card className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Description
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
              {job.skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {job.skills.map((s) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className="border-primary/20 bg-primary/5 text-primary"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>

            {/* Per-drive, per-round applicant view */}
            <DriveRoundsPanel jobId={jobId} />
          </>
        )}
      </main>

      {job && (
        <JobFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          job={job}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["company-jobs", jobId] });
            queryClient.invalidateQueries({ queryKey: ["company-jobs"] });
          }}
        />
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Layers; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
