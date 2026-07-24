import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Briefcase, Calendar, GaugeCircle, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyGuard } from "@/hooks/use-company-guard";
import { rolesService } from "@/services/api/roles";
import { RoleFormDialog } from "@/components/dashboard/roles/RoleFormDialog";
import { RoleStatusBadge } from "@/components/dashboard/roles/RoleStatusBadge";
import { RoleActionsMenu } from "@/components/dashboard/roles/RoleActionsMenu";
import { DeleteRoleDialog } from "@/components/dashboard/roles/DeleteRoleDialog";
import type { Role } from "@/types/role";

export const Route = createFileRoute("/company-roles/$roleId")({
  head: ({ params }) => ({
    meta: [{ title: `Role — ${params.roleId} — Mirracle` }],
  }),
  component: RoleDetailPage,
});

function RoleDetailPage() {
  const { roleId } = Route.useParams();
  const session = useCompanyGuard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    data: role,
    isLoading,
    isError,
  } = useQuery<Role>({
    queryKey: ["company-roles", roleId],
    queryFn: () => rolesService.getById(roleId),
    enabled: !!session,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["company-roles", roleId] });
    queryClient.invalidateQueries({ queryKey: ["company-roles"] });
  };

  const publishMutation = useMutation({
    mutationFn: () => rolesService.publish(roleId),
    onSuccess: () => {
      toast.success("Role published.");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to publish role."),
  });

  const archiveMutation = useMutation({
    mutationFn: () => rolesService.archive(roleId),
    onSuccess: () => {
      toast.success("Role archived.");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to archive role."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => rolesService.remove(roleId),
    onSuccess: () => {
      toast.success("Role deleted.");
      queryClient.invalidateQueries({ queryKey: ["company-roles"] });
      navigate({ to: "/company-roles" });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete role."),
  });

  if (!session) return null;

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 md:px-8">
          <Link
            to="/company-roles"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All roles
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading role">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError || !role ? (
          <Card className="p-10 text-center">
            <p className="text-sm font-medium text-destructive">Role not found.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              It may have been deleted, or you don&apos;t have access to it.
            </p>
            <Link
              to="/company-roles"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to roles
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Title + status + actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-2xl font-bold md:text-3xl">{role.title}</h1>
                  <RoleStatusBadge status={role.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Last updated {new Date(role.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <RoleActionsMenu
                role={role}
                onEdit={() => setFormOpen(true)}
                onPublish={() => publishMutation.mutate()}
                onArchive={() => archiveMutation.mutate()}
                onDelete={() => setDeleteOpen(true)}
                disabled={publishMutation.isPending || archiveMutation.isPending}
              />
            </div>

            {/* Key facts */}
            <Card className="grid gap-4 p-5 sm:grid-cols-3">
              <div className="flex items-start gap-2.5">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Experience level</p>
                  <p className="text-sm font-medium">{role.experienceLevel}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Deadline</p>
                  <p className="text-sm font-medium">
                    {new Date(role.deadline).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <GaugeCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Min. employability score</p>
                  <p className="text-sm font-medium">{role.minimumEmployabilityScore} / 100</p>
                </div>
              </div>
            </Card>

            {/* Description */}
            <Card className="p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Description
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {role.description}
              </p>
            </Card>

            {/* Required skills */}
            <Card className="p-5">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                Required skills
              </h2>
              <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Required skills">
                {role.requiredSkills.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    role="listitem"
                    className="border-primary/20 bg-primary/5 text-primary"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>
        )}
      </main>

      {role && (
        <>
          <RoleFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            mode="edit"
            role={role}
            onSuccess={() => invalidate()}
          />
          <DeleteRoleDialog
            role={role}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteMutation.mutate()}
            deleting={deleteMutation.isPending}
          />
        </>
      )}
    </div>
  );
}
