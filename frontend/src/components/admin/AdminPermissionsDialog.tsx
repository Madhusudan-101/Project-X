import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { adminService } from "@/services/api/admin/admin";
import { ApiClientError } from "@/services/api/client";
import type { PermissionGrant, ScopeType, UserRow } from "@/types/admin/admin";
import { StatusBadge } from "./controls";
import { fmtDate } from "./format";

const SCOPE_LABEL: Record<ScopeType, string> = { global: "Global (every record)", college: "One college", company: "One company" };

function scopeText(grant: PermissionGrant, collegeNames: Map<string, string>, companyNames: Map<string, string>): string {
  if (grant.scope_type === "global" || !grant.scope_id) return "Global";
  const names = grant.scope_type === "college" ? collegeNames : companyNames;
  return `${grant.scope_type === "college" ? "College" : "Company"}: ${names.get(grant.scope_id) ?? grant.scope_id}`;
}

/** View, grant, and revoke a delegated admin's permissions. The Super Admin
 * viewing this is the ONLY one who can grant/revoke (enforced on the
 * backend, not just here — see require_super_admin in
 * services/admin/permissions.py); a delegated admin who opens their own row
 * sees the same data read-only via GET .../permissions. */
export function AdminPermissionsDialog({
  user,
  open,
  onOpenChange,
  readOnly = false,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const userId = user?.user_id;

  const detail = useQuery({
    queryKey: ["admin", "adminUsers", userId, "permissions"],
    queryFn: () => adminService.adminUsers.permissions(userId!),
    enabled: open && !!userId,
  });
  const catalog = useQuery({
    queryKey: ["admin", "permissionsCatalog"],
    queryFn: () => adminService.permissionsCatalog(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const options = useQuery({
    queryKey: ["admin", "options"],
    queryFn: () => adminService.options(),
    enabled: open && !readOnly,
    staleTime: 5 * 60_000,
  });
  const collegeNames = useMemo(() => new Map((options.data?.colleges ?? []).map((c) => [c.id, c.name])), [options.data]);
  const companyNames = useMemo(() => new Map((options.data?.companies ?? []).map((c) => [c.id, c.name])), [options.data]);

  const [permission, setPermission] = useState<string>("");
  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [scopeId, setScopeId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");

  const resetForm = () => {
    setPermission("");
    setScopeType("global");
    setScopeId("");
    setExpiresAt("");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "adminUsers", userId, "permissions"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
  };

  const grant = useMutation({
    mutationFn: () =>
      adminService.adminUsers.grant(userId!, {
        permission,
        scope_type: scopeType,
        scope_id: scopeType === "global" ? undefined : scopeId || undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success(`Granted ${permission}.`);
      resetForm();
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not grant this permission."),
  });

  const revoke = useMutation({
    mutationFn: (permissionId: string) => adminService.adminUsers.revoke(userId!, permissionId),
    onSuccess: () => {
      toast.success("Permission revoked.");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not revoke this permission."),
  });

  const revokeAll = useMutation({
    mutationFn: () => adminService.adminUsers.revokeAll(userId!),
    onSuccess: (res) => {
      toast.success(res.revoked_count ? `Revoked ${res.revoked_count} permission(s).` : "This admin had no permissions to revoke.");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not revoke this admin's permissions."),
  });

  if (!user) return null;

  const activeGrants = (detail.data?.permissions ?? []).filter((g) => g.is_active);
  const selectedModule = catalog.data?.modules.find((m) => m.permissions.includes(permission));
  const scopeOptions: ScopeType[] = ["global", ...(selectedModule?.scopable_as ?? [])];
  const canGrant = !!permission && (scopeType === "global" || !!scopeId);

  return (
    <Dialog open={open} onOpenChange={(o) => !grant.isPending && !revokeAll.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permissions — {user.name}</DialogTitle>
          <DialogDescription>
            {user.email}. {readOnly
              ? "Your current access — only a Super Admin can change this."
              : "Exactly what this admin can view and do in the Admin Portal. Enforced on the backend, not just hidden here."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Current permissions</Label>
            {detail.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : activeGrants.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No permissions granted yet.</p>
            ) : (
              <div className="space-y-1.5">
                {activeGrants.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{g.permission}</div>
                      <div className="text-xs text-muted-foreground">
                        {scopeText(g, collegeNames, companyNames)}
                        {g.expires_at ? ` · until ${fmtDate(g.expires_at)}` : " · no expiry"}
                      </div>
                    </div>
                    {!readOnly && (
                      <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)} aria-label={`Revoke ${g.permission}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {!readOnly && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Grant a permission</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Permission</Label>
                    <Select value={permission} onValueChange={(v) => { setPermission(v); setScopeType("global"); setScopeId(""); }}>
                      <SelectTrigger><SelectValue placeholder="Choose a permission" /></SelectTrigger>
                      <SelectContent>
                        {catalog.data?.modules.map((m) => (
                          <SelectGroup key={m.module}>
                            <SelectLabel>{m.label}</SelectLabel>
                            {m.permissions.map((p) => (
                              <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Scope</Label>
                    <Select value={scopeType} onValueChange={(v) => { setScopeType(v as ScopeType); setScopeId(""); }} disabled={!permission}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {scopeOptions.map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {scopeType !== "global" && (
                  <div className="space-y-1.5">
                    <Label>{scopeType === "college" ? "College" : "Company"}</Label>
                    <Select value={scopeId} onValueChange={setScopeId}>
                      <SelectTrigger><SelectValue placeholder={`Choose a ${scopeType}`} /></SelectTrigger>
                      <SelectContent>
                        {(scopeType === "college" ? options.data?.colleges : options.data?.companies)?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="perm-expiry">Expires (optional)</Label>
                  <Input id="perm-expiry" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)} />
                </div>

                <Button type="button" disabled={!canGrant || grant.isPending} onClick={() => grant.mutate()}>
                  {grant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Grant permission
                </Button>
              </div>
            </>
          )}

          {detail.data?.history && detail.data.history.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">History</Label>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {detail.data.history.slice(0, 15).map((e) => (
                    <div key={e.id}>
                      {fmtDate(e.occurred_at)} — {e.event_type === "permission_granted" ? "granted" : "revoked"}{" "}
                      <span className="font-medium text-foreground">{String(e.metadata?.permission ?? "")}</span> by {e.actor_label ?? "—"}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {!readOnly ? (
            <Button
              type="button" variant="outline" className="text-destructive"
              disabled={revokeAll.isPending || activeGrants.length === 0}
              onClick={() => revokeAll.mutate()}
            >
              <ShieldAlert className="mr-2 h-4 w-4" /> Revoke all
            </Button>
          ) : <span />}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
