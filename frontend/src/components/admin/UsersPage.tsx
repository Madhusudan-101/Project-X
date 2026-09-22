import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, ShieldOff, ShieldCheck as ShieldCheckIcon, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { adminQueryOptions, adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService } from "@/services/api/admin/admin";
import type { UserRole, UserRow } from "@/types/admin/admin";
import { BlockUserDialog } from "./BlockUserDialog";
import { DataTable, type Column } from "./DataTable";
import { ExportButton, FilterSelect, PageHeader, SearchBox, StatusBadge, Toolbar } from "./controls";
import { fmtDate, fmtInt, fmtRelative } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { USER_ROLE_LABEL } from "./status";
import { UnblockUserDialog } from "./UnblockUserDialog";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "college", label: "College" },
  { value: "company", label: "Company" },
  { value: "candidate", label: "Candidate" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
];

/** Every account on the platform, across all four roles. Block/unblock are
 * the only mutations here — role and college/company links are set once at
 * provisioning and never edited. See BlockUserDialog for what a block does
 * and how it's enforced. */
export function UsersPage() {
  const { range, label } = useAdminRange();
  const [role, setRole] = useState<UserRole>();
  const [status, setStatus] = useState<"active" | "blocked">();
  const [blockTarget, setBlockTarget] = useState<UserRow | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<UserRow | null>(null);
  const t = useTableState({ sort: "created_at", dir: "desc" }, [range, role, status]);

  const filters = { role, status };
  const overview = useQuery({ queryKey: ["admin", "overview", range], queryFn: () => adminService.overview(range), ...adminQueryOptions });
  const q = useQuery({
    queryKey: ["admin", "users", range, t.params, filters],
    queryFn: () => adminService.users.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const blockedCount = (q.data?.items ?? []).filter((u) => u.is_blocked).length;
  const totals = overview.data?.totals;

  const columns: Column<UserRow>[] = [
    {
      key: "name", header: "User", sortKey: "name", text: true,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    { key: "role", header: "Role", sortKey: "role", cell: (r) => <StatusBadge tone="outline">{USER_ROLE_LABEL[r.role]}</StatusBadge> },
    {
      key: "org", header: "College / Company",
      cell: (r) => <span className="text-muted-foreground">{r.college_name || r.company_name || "—"}</span>,
    },
    { key: "created_at", header: "Registered", sortKey: "created_at", cell: (r) => fmtDate(r.created_at) },
    { key: "last_activity", header: "Last activity", sortKey: "last_activity", cell: (r) => fmtRelative(r.last_activity) },
    {
      key: "status", header: "Status",
      cell: (r) =>
        r.is_blocked ? (
          <StatusBadge tone="destructive">{r.blocked_permanent ? "Blocked (permanent)" : "Blocked (temporary)"}</StatusBadge>
        ) : (
          <StatusBadge tone="success">Active</StatusBadge>
        ),
    },
    {
      key: "actions", header: "Actions", hideHeader: true, align: "right",
      cell: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Actions for ${r.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/admin/users/$userId" params={{ userId: r.user_id }}>
                <Eye className="mr-2 h-4 w-4" /> View
              </Link>
            </DropdownMenuItem>
            {r.is_blocked ? (
              <DropdownMenuItem onSelect={() => setUnblockTarget(r)}>
                <ShieldCheckIcon className="mr-2 h-4 w-4" /> Unblock
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setBlockTarget(r)} className="text-destructive focus:text-destructive">
                <ShieldOff className="mr-2 h-4 w-4" /> Block
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users & Access"
        description={
          <>
            Every account across Admin, College, Company and Candidate, registered in{" "}
            <span className="font-medium text-foreground">{label}</span> unless a role/status filter narrows it further. Block/unblock
            take effect immediately — see each account&apos;s page for its full history.
          </>
        }
        actions={<ExportButton onExport={() => adminService.users.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })} filename="users.csv" />}
      />

      <KpiGroup title="Platform accounts">
        <KpiCard label="Total accounts" loading={overview.isLoading} value={fmtInt(totals?.users)} />
        <KpiCard label="Candidates" loading={overview.isLoading} value={fmtInt(totals?.candidates)} />
        <KpiCard label="Companies / Colleges" loading={overview.isLoading} value={totals ? `${fmtInt(totals.recruiters)} / ${fmtInt(totals.college_accounts)}` : undefined} />
        <KpiCard label="Blocked (this page)" value={fmtInt(blockedCount)} definition="Counts only the accounts currently shown below, not the whole platform — switch Status to 'Blocked' and clear other filters for the full count." />
      </KpiGroup>

      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search name or email" />
        <FilterSelect value={role} onChange={(v) => setRole(v as UserRole | undefined)} options={ROLE_OPTIONS} allLabel="All roles" />
        <FilterSelect value={status} onChange={(v) => setStatus(v as "active" | "blocked" | undefined)} options={STATUS_OPTIONS} allLabel="Any status" />
      </Toolbar>

      <DataTable
        label="Users"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.user_id}
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
          t.debouncedSearch || role || status
            ? { title: "No accounts match these filters", hint: "Try widening the date range or clearing filters." }
            : { title: "No accounts registered yet" }
        }
      />

      <BlockUserDialog user={blockTarget} open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)} />
      <UnblockUserDialog user={unblockTarget} open={!!unblockTarget} onOpenChange={(o) => !o && setUnblockTarget(null)} />
    </>
  );
}
