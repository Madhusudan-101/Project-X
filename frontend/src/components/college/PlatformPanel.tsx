import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformService } from "@/services/api/college/college";
import type {
  PlatformApplication,
  PlatformApplicationStatus,
  PlatformDrive,
  PlatformOverview,
  PlatformRoundStatus,
  PlatformStudent,
} from "@/types/college/college";

const APPLICATION_LABEL: Record<PlatformApplicationStatus, string> = {
  applied: "Applied",
  scoring: "Applied",
  scored: "Applied",
  shortlisted: "Shortlisted",
  in_interview: "In interview",
  hired: "Selected",
  rejected: "Not selected",
};

const ROUND_LABEL: Record<PlatformRoundStatus, string> = {
  pending: "pending",
  shortlisted: "passed",
  rejected: "not passed",
};

const PLACEMENT_LABEL: Record<string, string> = {
  not_placed: "Not placed",
  placed: "Placed",
  offer_declined: "Offer declined",
};

function applicationTone(status: PlatformApplicationStatus): string {
  if (status === "hired") return "border-success/30 bg-success/10 text-success";
  if (status === "rejected") return "border-border text-muted-foreground";
  if (status === "shortlisted" || status === "in_interview")
    return "border-primary/30 bg-primary/5 text-primary";
  return "border-secondary/30 bg-secondary/10 text-secondary";
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

const roundName = (r: { type: string; mode: string }) =>
  `${r.type.charAt(0).toUpperCase()}${r.type.slice(1)} (${r.mode === "ai" ? "AI" : "live"})`;

/**
 * What the companies' drives at this college look like on the platform, and how the college's own
 * (rostered) students are doing in them. Read-only: nothing here changes a drive, an application or the
 * roster. Shows statuses only — never scores, resumes or answers. The numbers come from the platform's
 * own records and are NOT merged into the roster's placement figures; the two are shown side by side
 * and a mismatch is flagged for the TPO to review.
 */
export function PlatformPanel() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    platformService
      .overview()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load platform activity."),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="space-y-4" aria-labelledby="platform-heading">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="platform-heading" className="font-display text-xl font-semibold">
            Platform drives
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Drives companies have opened for your college on Mirracle, and how your students are
            doing in them. Read-only — companies run the process; this only shows each application's
            status, never scores, resumes or answers.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <Card className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </Card>
      ) : error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : data && data.drives.length === 0 ? (
        <Card className="grid h-32 place-items-center p-6 text-center text-sm text-muted-foreground">
          No company has opened a drive for your college on Mirracle yet. Drives appear here once a
          company publishes one.
        </Card>
      ) : data ? (
        <>
          <Summary data={data} />
          {data.totals.needsRosterUpdate > 0 && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {data.totals.needsRosterUpdate} student
                {data.totals.needsRosterUpdate === 1 ? " was" : "s were"} selected on the platform
                but {data.totals.needsRosterUpdate === 1 ? "isn't" : "aren't"} marked Placed in your
                roster. Review them on the Students page and update the status yourself — nothing
                here changes your roster.
              </span>
            </div>
          )}
          <DrivesTable drives={data.drives} />
          <StudentsTable students={data.students} />
        </>
      ) : null}
    </section>
  );
}

function Summary({ data }: { data: PlatformOverview }) {
  const tiles: [string, number][] = [
    ["Drives", data.drives.length],
    ["Your students applying", data.studentsOnPlatform],
    ["Applications", data.totals.applications],
    ["Selected", data.totals.selected],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map(([label, value]) => (
        <Card key={label} className="p-3 text-center">
          <div className="font-display text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </Card>
      ))}
    </div>
  );
}

function DrivesTable({ drives }: { drives: PlatformDrive[] }) {
  return (
    <Card className="overflow-hidden">
      <Table aria-label="Platform drives at your college">
        <TableHeader>
          <TableRow>
            <TableHead>Company · Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Apply by</TableHead>
            <TableHead>Rounds</TableHead>
            <TableHead className="text-right">Your students</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drives.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <div className="font-medium">{d.companyName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {[d.jobTitle, d.location, d.isOnCampus ? "On campus" : "Off campus"]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    d.status === "live"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border text-muted-foreground"
                  }
                >
                  {d.status === "live" ? "Live" : "Closed"}
                </Badge>
              </TableCell>
              <TableCell>{fmtDate(d.applyDeadline)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {d.rounds.length ? d.rounds.map(roundName).join(" → ") : "—"}
              </TableCell>
              <TableCell className="text-right text-xs">
                <div>
                  {d.funnel.applicants} applied · {d.funnel.shortlisted + d.funnel.inInterview} in
                  progress
                </div>
                <div className="text-muted-foreground">
                  {d.funnel.selected} selected · {d.funnel.rejected} not selected
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function StudentsTable({ students }: { students: PlatformStudent[] }) {
  return (
    <div className="space-y-2">
      <h3 className="font-display text-lg font-semibold">Your students on the platform</h3>
      {students.length === 0 ? (
        <Card className="grid h-24 place-items-center p-4 text-center text-sm text-muted-foreground">
          None of your rostered students has applied to these drives yet. A student appears here
          only when their Mirracle account uses the email on your roster.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table aria-label="Your students' platform applications">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Roster status</TableHead>
                <TableHead>Applications</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.studentId}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.branch} · {s.graduationYear}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {s.placementStatus
                        ? (PLACEMENT_LABEL[s.placementStatus] ?? s.placementStatus)
                        : "—"}
                    </div>
                    {s.rosterNeedsReview && (
                      <Badge variant="outline" className="mt-1 border-warning/40 bg-warning/10">
                        Selected on platform — review
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-1.5">
                      {s.applications.map((a) => (
                        <ApplicationLine key={a.driveId} application={a} />
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function ApplicationLine({ application: a }: { application: PlatformApplication }) {
  return (
    <li className="text-xs">
      <span className="font-medium">{a.jobTitle ?? "Role"}</span>
      <span className="text-muted-foreground"> · {a.companyName ?? "Company"} </span>
      <Badge variant="outline" className={applicationTone(a.status)}>
        {APPLICATION_LABEL[a.status]}
      </Badge>
      {a.rounds.length > 0 && (
        <div className="mt-0.5 text-muted-foreground">
          {a.rounds.map((r) => `Round ${r.number} ${ROUND_LABEL[r.status]}`).join(" · ")}
        </div>
      )}
    </li>
  );
}
