import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Briefcase, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompanyGuard } from "@/hooks/company/use-company-guard";
import { jobsService } from "@/services/api/company/jobs";
import { JobFormDialog } from "@/components/company/jobs/JobFormDialog";
import { EXPERIENCE_LEVEL_LABELS, type Job, type JobStatus } from "@/types/jobs";

export const Route = createFileRoute("/company-jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs — Mirracle" },
      {
        name: "description",
        content: "Post jobs, set scoring weights, and review ranked candidates.",
      },
    ],
  }),
  component: JobsListingPage,
});

type StatusFilter = "all" | JobStatus;
const JOBS_KEY = ["company-jobs"] as const;

const STATUS_STYLES: Record<JobStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  live: "border-success/30 bg-success/10 text-success",
  closed: "border-destructive/30 bg-destructive/10 text-destructive",
};

function JobsListingPage() {
  const session = useCompanyGuard();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  const {
    data: jobs,
    isLoading,
    isError,
  } = useQuery<Job[]>({
    queryKey: JOBS_KEY,
    queryFn: () => jobsService.list(),
    enabled: !!session,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: JOBS_KEY });

  const publishMutation = useMutation({
    mutationFn: (id: string) => jobsService.publish(id),
    onSuccess: () => {
      toast.success("Job published.");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to publish."),
  });
  const closeMutation = useMutation({
    mutationFn: (id: string) => jobsService.close(id),
    onSuccess: () => {
      toast.success("Job closed.");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to close."),
  });

  if (!session) return null;

  const all = jobs ?? [];
  const filtered = all.filter((j) => filter === "all" || j.status === filter);

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 md:px-8">
          <Link
            to="/company"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
              <Briefcase className="h-6 w-6 text-primary" aria-hidden="true" />
              Jobs
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Post a JD, set the scoring weights, and review candidates ranked for that job.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="bg-gradient-brand text-primary-foreground shadow-soft"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create job
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)} className="mt-6">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="mt-4 overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-10 text-center text-sm text-destructive">
              Couldn&apos;t load jobs.
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Briefcase className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium">
                {all.length > 0 ? "No jobs match this filter." : "No jobs yet."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Post your first job to start receiving ranked candidates.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Domain</TableHead>
                  <TableHead className="hidden md:table-cell">Experience</TableHead>
                  <TableHead className="hidden lg:table-cell">Deadline</TableHead>
                  <TableHead className="text-right">Applicants</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link
                        to="/company-jobs/$jobId"
                        params={{ jobId: job.id }}
                        className="font-medium hover:underline"
                      >
                        {job.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[job.status]}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm capitalize text-muted-foreground md:table-cell">
                      {job.domain}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {new Date(job.deadline).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to="/company-jobs/$jobId"
                        params={{ jobId: job.id }}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {job.applicationCount}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            •••
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(job);
                              setFormOpen(true);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          {job.status === "draft" && (
                            <DropdownMenuItem onClick={() => publishMutation.mutate(job.id)}>
                              Publish
                            </DropdownMenuItem>
                          )}
                          {job.status === "live" && (
                            <DropdownMenuItem onClick={() => closeMutation.mutate(job.id)}>
                              Close
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>

      <JobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={editing ? "edit" : "create"}
        job={editing}
        onSuccess={() => invalidate()}
      />
    </div>
  );
}
