import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { candidateJobsService } from "@/services/api/candidate/jobs";
import {
  APPLICATION_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  ROUND_MODE_LABELS,
  ROUND_TYPE_LABELS,
  type JobDetail,
} from "@/types/jobs";

export const Route = createFileRoute("/candidate-jobs/$jobId")({
  head: ({ params }) => ({ meta: [{ title: `Job — ${params.jobId} — Mirracle` }] }),
  component: CandidateJobDetailPage,
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "Dates to be announced";
  return `${fmtDateTime(start)} → ${fmtDateTime(end)}`;
}

function fmtRange(cur: string, min: number | null, max: number | null, suffix = ""): string | null {
  const f = (n: number) => `${cur} ${n.toLocaleString()}${suffix}`;
  if (min != null && max != null) return `${f(min)}–${f(max)}`;
  if (min != null) return `${f(min)}+`;
  if (max != null) return `Up to ${f(max)}`;
  return null;
}

function fmtCtc(job: JobDetail): string | null {
  const cur = job.ctcCurrency ?? "INR";
  if (job.employmentType === "intern") {
    return fmtRange(cur, job.stipendMin, job.stipendMax, "/mo");
  }
  return fmtRange(cur, job.ctcMin, job.ctcMax);
}

function CandidateJobDetailPage() {
  const { jobId } = Route.useParams();
  const session = useCandidateGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: job,
    isLoading,
    isError,
  } = useQuery<JobDetail>({
    queryKey: ["candidate-job", jobId],
    queryFn: () => candidateJobsService.getJob(jobId),
    enabled: !!session,
    retry: false,
  });

  const applyMutation = useMutation({
    mutationFn: () => candidateJobsService.apply(jobId),
    onSuccess: () => {
      toast.success("Application submitted — scoring in progress. You can leave this page.");
      queryClient.invalidateQueries({ queryKey: ["candidate-job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["candidate-applications"] });
      queryClient.invalidateQueries({ queryKey: ["candidate-job-board"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not submit your application."),
  });

  if (!session) return null;

  const applied = job?.alreadyApplied || applyMutation.isSuccess;
  const ctc = job ? fmtCtc(job) : null;

  // Relocation / sponsorship quick-confirm — only when the profile default
  // doesn't already answer it.
  const prefs = session.user.preferredLocations ?? [];
  const loc = (job?.location ?? "").toLowerCase();
  const locationMismatch =
    !!job &&
    prefs.length > 0 &&
    !prefs.some((p) => loc.includes(p.toLowerCase()) || p.toLowerCase().includes(loc));
  const sponsorshipCountry = (session.user.sponsorshipCountry ?? "").toLowerCase();
  const sponsorshipRelevant =
    !!job &&
    session.user.needsSponsorship === true &&
    !!sponsorshipCountry &&
    !loc.includes(sponsorshipCountry);
  const showQuickConfirm = !applied && (locationMismatch || sponsorshipRelevant);

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4 md:px-8">
          <Link
            to="/candidate"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError || !job ? (
          <Card className="p-10 text-center">
            <p className="text-sm font-medium text-destructive">Job not available.</p>
            <button
              onClick={() => navigate({ to: "/candidate" })}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Back to the job board
            </button>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* 1. Header */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {job.isOnCampus ? "On-campus" : "Off-campus"}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}
                </Badge>
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold md:text-3xl">{job.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-4 w-4" /> {job.companyName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> {job.location}
                </span>
                {ctc && <span className="font-medium text-foreground">{ctc}</span>}
              </div>
            </div>

            {/* 2. Eligibility block */}
            {job.eligible ? (
              <Card className="flex items-center gap-3 border-success/30 bg-success/5 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <p className="text-sm text-foreground">You&apos;re eligible for this drive.</p>
              </Card>
            ) : (
              <Card className="flex items-center gap-3 border-destructive/30 bg-destructive/5 p-4">
                <Ban className="h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    You&apos;re not eligible for this drive.
                  </p>
                  {job.ineligibleReason && (
                    <p className="text-xs text-muted-foreground">{job.ineligibleReason}</p>
                  )}
                </div>
              </Card>
            )}

            {/* 3. JD + skills */}
            <Card className="p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
              {job.requiredSkills.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Required skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {job.requiredSkills.map((s) => (
                      <Badge
                        key={s}
                        variant="outline"
                        className="border-primary/20 bg-primary/5 text-primary"
                      >
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {job.openingsCount} opening{job.openingsCount === 1 ? "" : "s"}
              </p>
            </Card>

            {/* 3b. Internship details + perks */}
            {(job.employmentType === "intern" || job.perks.length > 0) && (
              <Card className="space-y-3 p-5">
                {job.employmentType === "intern" && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internship details
                    </p>
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">Monthly stipend</dt>
                        <dd className="font-medium">
                          {fmtRange(
                            job.ctcCurrency ?? "INR",
                            job.stipendMin,
                            job.stipendMax,
                            "/mo",
                          ) ?? "Not disclosed"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Duration</dt>
                        <dd className="font-medium">
                          {job.internshipDurationMonths
                            ? `${job.internshipDurationMonths} month${
                                job.internshipDurationMonths === 1 ? "" : "s"
                              }`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Expected PPO package</dt>
                        <dd className="font-medium">
                          {fmtRange(job.ctcCurrency ?? "INR", job.ppoCtcMin, job.ppoCtcMax) ??
                            "Not disclosed"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
                {job.perks.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Perks &amp; benefits
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {job.perks.map((p) => (
                        <Badge key={p} variant="secondary" className="text-xs">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* 4. Timeline block */}
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-4 w-4" /> Hiring timeline
              </p>
              <ol className="space-y-3">
                <li className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold">
                    <Clock className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="font-medium">Apply by</p>
                    <p className="text-muted-foreground">
                      {fmtDate(job.applyDeadline ?? job.deadline)}
                    </p>
                  </div>
                </li>
                {(job.oaWindowStart || job.oaWindowEnd) && (
                  <li className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold">
                      OA
                    </span>
                    <div>
                      <p className="font-medium">Online assessment</p>
                      <p className="text-muted-foreground">
                        {fmtWindow(job.oaWindowStart, job.oaWindowEnd)}
                      </p>
                    </div>
                  </li>
                )}
                {job.rounds.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold tabular-nums">
                      {r.roundNumber}
                    </span>
                    <div>
                      <p className="font-medium">
                        Round {r.roundNumber} · {ROUND_TYPE_LABELS[r.roundType]}
                        <Badge
                          variant="outline"
                          className="ml-2 align-middle text-[10px] uppercase"
                        >
                          {ROUND_MODE_LABELS[r.mode]}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground">
                        {fmtWindow(r.windowStart, r.windowEnd)}
                      </p>
                    </div>
                  </li>
                ))}
                {job.rounds.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    Interview rounds haven&apos;t been scheduled yet.
                  </li>
                )}
              </ol>
            </Card>

            {/* 5. Relocation / sponsorship quick-confirm */}
            {showQuickConfirm && (
              <Card className="border-amber-300/40 bg-amber-50/60 p-4 dark:bg-amber-950/20">
                <p className="text-sm font-medium">Before you apply</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {locationMismatch && (
                    <li>
                      This role is in{" "}
                      <span className="font-medium text-foreground">{job.location}</span>, which
                      isn&apos;t in your preferred locations ({prefs.join(", ")}).
                    </li>
                  )}
                  {sponsorshipRelevant && (
                    <li>
                      You&apos;ve indicated you need visa sponsorship (authorized in{" "}
                      {session.user.sponsorshipCountry}). Confirm this role can sponsor you.
                    </li>
                  )}
                </ul>
              </Card>
            )}

            {/* 6. Apply */}
            <div className="flex items-center gap-3">
              {applied ? (
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 px-3 py-1.5 text-primary"
                >
                  {job.applicationStatus
                    ? APPLICATION_STATUS_LABELS[job.applicationStatus]
                    : "Applied — scoring in progress"}
                </Badge>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Button
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending || !job.eligible}
                    className="bg-gradient-brand text-primary-foreground shadow-soft"
                  >
                    {applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply now
                  </Button>
                  {!job.eligible && (
                    <p className="text-xs text-destructive">
                      {job.ineligibleReason ?? "You don't meet this drive's eligibility criteria."}
                    </p>
                  )}
                </div>
              )}
            </div>
            {applied && (
              <p className="text-xs text-muted-foreground">
                Track scoring progress on your dashboard&apos;s Jobs tab — no need to wait here.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
