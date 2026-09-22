import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type AuditLogFilters } from "@/services/api/admin/admin";
import type { EventItem, UserRole } from "@/types/admin/admin";
import { DataTable, type Column } from "./DataTable";
import { ExportButton, FilterSelect, PageHeader, SearchBox, StatusBadge, Toolbar } from "./controls";
import { fmtDate } from "./format";
import { EVENT_TYPE_LABEL, RESULT_TONE, USER_ROLE_LABEL } from "./status";

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_LABEL)
  // Only actor-attributable events — the six the backend logs to admin_events
  // (the others are derived timestamps merged only into Live Activity).
  .filter(([v]) => ["user_login", "account_provisioned", "user_blocked", "user_unblocked", "csv_exported", "report_generated"].includes(v))
  .map(([value, label]) => ({ value, label }));
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" }, { value: "college", label: "College" },
  { value: "company", label: "Company" }, { value: "candidate", label: "Candidate" },
];
const RESULT_OPTIONS = [{ value: "success", label: "Success" }, { value: "failure", label: "Failure" }];

/** The compliance-grade trail: every admin_events row, unfiltered by
 * "friendliness" — including failures (e.g. a blocked account's login
 * attempt), which Live Activity deliberately hides. */
export function AuditLogPage() {
  const { range, label } = useAdminRange();
  const [eventType, setEventType] = useState<string>();
  const [actorRole, setActorRole] = useState<UserRole>();
  const [result, setResult] = useState<string>();
  const t = useTableState({ sort: "created_at", dir: "desc" }, [range, eventType, actorRole, result]);
  const filters: AuditLogFilters = { event_type: eventType, actor_role: actorRole, result: result as "success" | "failure" | undefined };

  const q = useQuery({
    queryKey: ["admin", "audit-log", range, t.params, filters],
    queryFn: () => adminService.auditLog.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const columns: Column<EventItem>[] = [
    { key: "event", header: "Event", cell: (r) => <span className="font-medium">{EVENT_TYPE_LABEL[r.event_type] ?? r.event_type}</span> },
    {
      key: "actor", header: "Actor",
      cell: (r) => (
        <div>
          <div>{r.actor_label ?? "—"}</div>
          {r.actor_role && <div className="text-xs text-muted-foreground">{USER_ROLE_LABEL[r.actor_role]}</div>}
        </div>
      ),
    },
    {
      key: "target", header: "Target",
      cell: (r) => <span className="text-muted-foreground">{r.target_label ?? r.target_type ?? "—"}</span>,
    },
    { key: "result", header: "Result", cell: (r) => <StatusBadge tone={RESULT_TONE[r.result]}>{r.result}</StatusBadge> },
    { key: "when", header: "When", sortKey: "created_at", cell: (r) => fmtDate(r.occurred_at) },
  ];

  return (
    <>
      <PageHeader
        title="Audit Log"
        description={
          <>
            Every admin-relevant action in <span className="font-medium text-foreground">{label}</span>: sign-ins (including blocked
            attempts), account provisioning, blocking/unblocking, exports and reports — with the actor, the target and the result.
          </>
        }
        actions={<ExportButton onExport={() => adminService.auditLog.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })} filename="audit_log.csv" />}
      />

      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search actor or target" />
        <FilterSelect value={eventType} onChange={setEventType} options={EVENT_TYPE_OPTIONS} allLabel="All events" className="w-full sm:w-52" />
        <FilterSelect value={actorRole} onChange={(v) => setActorRole(v as UserRole | undefined)} options={ROLE_OPTIONS} allLabel="Any actor role" />
        <FilterSelect value={result} onChange={setResult} options={RESULT_OPTIONS} allLabel="Any result" />
      </Toolbar>

      <DataTable
        label="Audit log"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        sort={t.sort}
        dir={t.dir}
        onSort={t.toggleSort}
        page={t.page}
        pageSize={t.params.page_size}
        total={q.data?.total ?? 0}
        onPage={t.setPage}
        empty={
          t.debouncedSearch || eventType || actorRole || result
            ? { title: "No events match these filters" }
            : { title: "No audited actions in this period yet" }
        }
      />
    </>
  );
}
