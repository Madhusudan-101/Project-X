import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck as ShieldCheckIcon, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import { ApiClientError } from "@/services/api/client";
import type { UserRow } from "@/types/admin/admin";
import { BlockUserDialog } from "./BlockUserDialog";
import { CollegeLink, CompanyLink } from "./EntityLinks";
import { DrivesTable } from "./DrivesTable";
import { PageHeader, StatusBadge } from "./controls";
import { fmtDate, fmtRelative } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { EVENT_TYPE_LABEL, RESULT_TONE, USER_ROLE_LABEL } from "./status";
import { EmptyBlock, ErrorBlock } from "./StateViews";
import { UnblockUserDialog } from "./UnblockUserDialog";

export function UserDetailPage({ userId }: { userId: string }) {
  const { range } = useAdminRange();
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const q = useQuery({
    queryKey: ["admin", "users", "detail", userId, range],
    queryFn: () => adminService.users.detail(userId, range),
    ...adminQueryOptions,
  });

  const u: UserRow | undefined = q.data?.user;

  if (q.isError) {
    return (
      <>
        <BackLink />
        {q.error instanceof ApiClientError && q.error.status === 404 ? (
          <EmptyBlock title="Account not found" hint="It may have been removed, or the link is wrong." />
        ) : (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        )}
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={u?.name ?? "Account"}
        description={
          u && (
            <span className="flex flex-wrap items-center gap-2">
              {u.email}
              <StatusBadge tone="outline">{USER_ROLE_LABEL[u.role]}</StatusBadge>
              {u.is_blocked ? (
                <StatusBadge tone="destructive">{u.blocked_permanent ? "Blocked (permanent)" : "Blocked (temporary)"}</StatusBadge>
              ) : (
                <StatusBadge tone="success">Active</StatusBadge>
              )}
            </span>
          )
        }
        actions={
          u && (
            u.is_blocked ? (
              <Button variant="outline" size="sm" onClick={() => setUnblockOpen(true)}>
                <ShieldCheckIcon className="mr-2 h-4 w-4" /> Unblock
              </Button>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setBlockOpen(true)}>
                <ShieldOff className="mr-2 h-4 w-4" /> Block
              </Button>
            )
          )
        }
      />

      {u && (
        <>
          <KpiGroup title="Account">
            <KpiCard label="Registered" loading={q.isLoading} value={fmtDate(u.created_at)} />
            <KpiCard label="Last activity" loading={q.isLoading} value={fmtRelative(u.last_activity)} definition="For candidates: their own applications and practice sessions. For company/college accounts: their organisation's activity. For every role: sign-ins recorded since this feature shipped." />
            <KpiCard label="College / Company" loading={q.isLoading} value={u.college_name || u.company_name || "—"} />
            <KpiCard label="Onboarding" loading={q.isLoading} value={u.onboarded ? "Complete" : "Pending"} />
          </KpiGroup>
          {(u.college_id || u.company_id) && (
            <p className="text-sm">
              {u.college_id && u.college_name ? <CollegeLink id={u.college_id} name={u.college_name} /> : null}
              {u.company_id && u.company_name ? <CompanyLink id={u.company_id} name={u.company_name} /> : null}
            </p>
          )}

          {u.is_blocked && (
            <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                {u.blocked_permanent ? "Permanently blocked" : `Temporarily blocked until ${u.blocked_until ? fmtDate(u.blocked_until) : "—"}`}
              </p>
              {u.blocked_reason && <p className="mt-1 text-muted-foreground">Reason: {u.blocked_reason}</p>}
              {u.blocked_by_email && <p className="mt-1 text-xs text-muted-foreground">Blocked by {u.blocked_by_email} on {fmtDate(u.blocked_at)}</p>}
            </Card>
          )}

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {u.role === "candidate" && <TabsTrigger value="applications">Applications</TabsTrigger>}
              {(u.role === "company" || u.role === "college") && <TabsTrigger value="drives">Drives</TabsTrigger>}
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <Card className="p-5 text-sm text-muted-foreground">
                {u.role === "admin" && "Admin accounts are provisioned by another Admin (or the bootstrap CLI) and have no roster, applications or drives of their own — their activity is what shows in the Audit tab."}
                {u.role === "candidate" && "See the Applications tab for what this candidate has applied to."}
                {(u.role === "company" || u.role === "college") && "See the Drives tab for this account's drives."}
              </Card>
            </TabsContent>

            {u.role === "candidate" && (
              <TabsContent value="applications" className="pt-4">
                <Card className="p-5">
                  {q.data?.applications.length ? (
                    <ul className="divide-y divide-border text-sm">
                      {q.data.applications.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                          <span className="text-muted-foreground">Applied {fmtDate(a.applied_at)}</span>
                          <StatusBadge tone="outline">{a.status}</StatusBadge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyBlock title="No applications yet" />
                  )}
                </Card>
              </TabsContent>
            )}

            {(u.role === "company" || u.role === "college") && (
              <TabsContent value="drives" className="pt-4">
                <Card className="p-5">
                  <DrivesTable companyId={u.role === "company" ? u.company_id ?? undefined : undefined} collegeId={u.role === "college" ? u.college_id ?? undefined : undefined} />
                </Card>
              </TabsContent>
            )}

            <TabsContent value="audit" className="pt-4">
              <Card className="p-5">
                {q.data?.audit.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {q.data.audit.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span>
                          <span className="font-medium">{EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}</span>
                          {e.actor_label && <span className="ml-2 text-muted-foreground">by {e.actor_label}</span>}
                          <StatusBadge tone={RESULT_TONE[e.result]}>{e.result}</StatusBadge>
                        </span>
                        <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.occurred_at}>{fmtRelative(e.occurred_at)}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyBlock title="No audit events for this account yet" hint="Sign-ins, blocks and other admin actions targeting this account appear here." />
                )}
              </Card>
            </TabsContent>
          </Tabs>

          <BlockUserDialog user={u} open={blockOpen} onOpenChange={setBlockOpen} />
          <UnblockUserDialog user={u} open={unblockOpen} onOpenChange={setUnblockOpen} />
        </>
      )}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> All users
    </Link>
  );
}
