import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Key, MoreHorizontal, ShieldCheck as ShieldCheckIcon, ShieldOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { adminQueryOptions, adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService } from "@/services/api/admin/admin";
import type { UserRow } from "@/types/admin/admin";
import { AdminPermissionsDialog } from "./AdminPermissionsDialog";
import { BlockUserDialog } from "./BlockUserDialog";
import { CreateDelegatedAdminDialog } from "./CreateDelegatedAdminDialog";
import { DataTable, type Column } from "./DataTable";
import { PageHeader, SearchBox, StatusBadge, Toolbar } from "./controls";
import { fmtDate } from "./format";
import { UnblockUserDialog } from "./UnblockUserDialog";

/** Super Admin: full management — create delegated admins, grant/revoke
 * their permissions, disable/re-enable them (reuses the existing Users &
 * Access block/unblock). Delegated admin: a read-only view of their own
 * access, via GET /admin/me. Every action here is a UI convenience; the
 * backend independently enforces all of it (require_super_admin /
 * require_permission — see services/admin/permissions.py). */
export function AdminManagementPage() {
  const { range } = useAdminRange();
  const [createOpen, setCreateOpen] = useState(false);
  const [permsTarget, setPermsTarget] = useState<UserRow | null>(null);
  const [blockTarget, setBlockTarget] = useState<UserRow | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<UserRow | null>(null);
  const t = useTableState({ sort: "created_at", dir: "desc" }, [range]);

  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => adminService.me(), ...adminQueryOptions });
  const isSuperAdmin = !!me.data?.is_super_admin;

  const q = useQuery({
    queryKey: ["admin", "adminUsers", range, t.params],
    queryFn: () => adminService.adminUsers.list(range, t.params),
    enabled: isSuperAdmin,
    ...adminTableQueryOptions,
  });

  if (me.isLoading) return null;

  if (!isSuperAdmin) {
    // A delegated admin: no management UI, just their own permissions.
    const self: UserRow = {
      user_id: me.data!.id, email: me.data!.email, name: me.data!.email, role: "admin",
      college_id: null, college_name: null, company_id: null, company_name: null,
      created_at: "", onboarded: true, is_blocked: false, blocked_permanent: false,
      blocked_until: null, blocked_at: null, blocked_reason: null, blocked_by_email: null,
      last_activity: null,
    };
    return (
      <>
        <PageHeader title="Your permissions" description="What you can currently view and do in the Admin Portal. Only a Super Admin can change this." />
        <Button onClick={() => setPermsTarget(self)}>
          <Key className="mr-2 h-4 w-4" /> View my permissions
        </Button>
        <AdminPermissionsDialog user={permsTarget} open={!!permsTarget} onOpenChange={(o) => !o && setPermsTarget(null)} readOnly />
      </>
    );
  }

  const columns: Column<UserRow>[] = [
    {
      key: "name", header: "Admin", sortKey: "name", text: true,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    { key: "created_at", header: "Created", sortKey: "created_at", cell: (r) => fmtDate(r.created_at) },
    {
      key: "status", header: "Status",
      cell: (r) => r.is_blocked
        ? <StatusBadge tone="destructive" >{r.blocked_permanent ? "Disabled (permanent)" : "Disabled (temporary)"}</StatusBadge>
        : <StatusBadge tone="success">Active</StatusBadge>,
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
            <DropdownMenuItem onSelect={() => setPermsTarget(r)}>
              <Key className="mr-2 h-4 w-4" /> Permissions
            </DropdownMenuItem>
            {r.is_blocked ? (
              <DropdownMenuItem onSelect={() => setUnblockTarget(r)}>
                <ShieldCheckIcon className="mr-2 h-4 w-4" /> Re-enable
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setBlockTarget(r)} className="text-destructive focus:text-destructive">
                <ShieldOff className="mr-2 h-4 w-4" /> Disable
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
        title="Admin Management"
        description="Delegated admins see and can do only what you grant them here — enforced on the backend, not just hidden in this UI. You (Super Admin) always have full access and cannot be disabled by a delegated admin."
        actions={<Button onClick={() => setCreateOpen(true)}><UserPlus className="mr-2 h-4 w-4" /> Add delegated admin</Button>}
      />

      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search name or email" />
      </Toolbar>

      <DataTable
        label="Admins"
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
        empty={{ title: "No delegated admins yet", hint: "Add one with the button above — they start with zero permissions." }}
      />

      <CreateDelegatedAdminDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AdminPermissionsDialog user={permsTarget} open={!!permsTarget} onOpenChange={(o) => !o && setPermsTarget(null)} />
      <BlockUserDialog user={blockTarget} open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)} />
      <UnblockUserDialog user={unblockTarget} open={!!unblockTarget} onOpenChange={(o) => !o && setUnblockTarget(null)} />
    </>
  );
}
