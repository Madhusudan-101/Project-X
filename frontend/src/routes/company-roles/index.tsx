import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Briefcase, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { useCompanyGuard } from "@/hooks/use-company-guard";
import { rolesService } from "@/services/api/roles";
import { RoleFormDialog } from "@/components/dashboard/roles/RoleFormDialog";
import { RoleStatusBadge } from "@/components/dashboard/roles/RoleStatusBadge";
import { RoleActionsMenu } from "@/components/dashboard/roles/RoleActionsMenu";
import { DeleteRoleDialog } from "@/components/dashboard/roles/DeleteRoleDialog";
import type { Role, RoleStatus } from "@/types/role";

export const Route = createFileRoute("/company-roles/")({
  head: () => ({
    meta: [
      { title: "Roles — Project X" },
      { name: "description", content: "Create, publish and manage the roles you're hiring for." },
    ],
  }),
  component: RolesListingPage,
});

type StatusFilter = "all" | RoleStatus;

const ROLES_QUERY_KEY = ["company-roles"] as const;

function RolesListingPage() {
  const session = useCompanyGuard();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const {
    data: roles,
    isLoading,
    isError,
  } = useQuery<Role[]>({
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => rolesService.list(),
    enabled: !!session,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });

  const publishMutation = useMutation({
    mutationFn: (roleId: string) => rolesService.publish(roleId),
    onSuccess: () => {
      toast.success("Role published.");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to publish role."),
  });

  const archiveMutation = useMutation({
    mutationFn: (roleId: string) => rolesService.archive(roleId),
    onSuccess: () => {
      toast.success("Role archived.");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to archive role."),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => rolesService.remove(roleId),
    onSuccess: () => {
      toast.success("Role deleted.");
      setDeletingRole(null);
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete role."),
  });

  if (!session) return null;

  const allRoles = roles ?? [];
  const filteredRoles = allRoles.filter((r) => filter === "all" || r.status === filter);

  const openCreate = () => {
    setEditingRole(null);
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setFormOpen(true);
  };

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Header */}
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
              Roles
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create, publish and manage the roles you&apos;re hiring for.
            </p>
          </div>
          <Button
            onClick={openCreate}
            className="bg-gradient-brand text-primary-foreground shadow-soft"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create role
          </Button>
        </div>

        {/* Status filter */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)} className="mt-6">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="mt-4 overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-6" aria-busy="true" aria-label="Loading roles">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-destructive">Couldn&apos;t load roles.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Please refresh the page to try again.
              </p>
            </div>
          ) : filteredRoles.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Briefcase className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium">
                {allRoles.length > 0 ? "No roles match this filter." : "No roles yet."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {allRoles.length > 0
                  ? "Try a different tab, or create a new role."
                  : "Post your first role to start building your hiring pipeline."}
              </p>
              {allRoles.length === 0 && (
                <Button onClick={openCreate} variant="outline" className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first role
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Experience</TableHead>
                  <TableHead className="hidden md:table-cell">Deadline</TableHead>
                  <TableHead className="hidden lg:table-cell">Min. score</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <Link
                        to="/company-roles/$roleId"
                        params={{ roleId: role.id }}
                        className="font-medium hover:underline"
                      >
                        {role.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RoleStatusBadge status={role.status} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {role.experienceLevel}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {new Date(role.deadline).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {role.minimumEmployabilityScore}
                    </TableCell>
                    <TableCell className="text-right">
                      <RoleActionsMenu
                        role={role}
                        onEdit={() => openEdit(role)}
                        onPublish={() => publishMutation.mutate(role.id)}
                        onArchive={() => archiveMutation.mutate(role.id)}
                        onDelete={() => setDeletingRole(role)}
                        disabled={
                          (publishMutation.isPending && publishMutation.variables === role.id) ||
                          (archiveMutation.isPending && archiveMutation.variables === role.id)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>

      <RoleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={editingRole ? "edit" : "create"}
        role={editingRole}
        onSuccess={() => invalidate()}
      />

      <DeleteRoleDialog
        role={deletingRole}
        open={!!deletingRole}
        onOpenChange={(open) => !open && setDeletingRole(null)}
        onConfirm={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
        deleting={deleteMutation.isPending}
      />
    </div>
  );
}
