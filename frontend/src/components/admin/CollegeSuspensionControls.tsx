import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminService } from "@/services/api/admin/admin";
import { ApiClientError } from "@/services/api/client";
import type { CollegeSuspension } from "@/types/admin/admin";
import { StatusBadge } from "./controls";

const STATE_BADGE: Record<
  CollegeSuspension["state"],
  { tone: "success" | "destructive" | "warning" | "muted"; label: string }
> = {
  active: { tone: "success", label: "College portal active" },
  suspended: { tone: "destructive", label: "Suspended" },
  partial: { tone: "warning", label: "Partly suspended" },
  no_accounts: { tone: "muted", label: "No TPO account" },
};

/** Whether the signed-in admin may suspend THIS college. A convenience only — the API is the real gate
 * (POST /admin/colleges/{id}/suspend needs `colleges.suspend`, global or scoped to this college). */
function useCanSuspendCollege(collegeId: string): boolean {
  const me = useQuery({
    queryKey: ["admin", "me"],
    queryFn: () => adminService.me(),
    staleTime: 60_000,
  });
  if (!me.data) return false;
  if (me.data.is_super_admin) return true;
  return me.data.permissions.some(
    (g) =>
      g.is_active &&
      g.permission === "colleges.suspend" &&
      (g.scope_type === "global" || g.scope_id === collegeId),
  );
}

/**
 * Status of a college's portal access and, for an admin who may use them, the Suspend / Reactivate actions.
 * Suspending blocks every TPO account of the college (nothing is deleted); it does not affect students or
 * companies — the dialog says so, so nobody expects more than it does.
 */
export function CollegeSuspensionControls({
  collegeId,
  collegeName,
  suspension,
}: {
  collegeId: string;
  collegeName: string;
  suspension: CollegeSuspension | undefined;
}) {
  const canSuspend = useCanSuspendCollege(collegeId);
  const [dialog, setDialog] = useState<"suspend" | "reactivate" | null>(null);
  if (!suspension) return null;

  const badge = STATE_BADGE[suspension.state];
  const canDoSuspend = canSuspend && suspension.accounts_active > 0;
  const canDoReactivate = canSuspend && suspension.accounts_suspended > 0;

  return (
    <>
      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      {canDoSuspend && (
        <Button variant="destructive" size="sm" onClick={() => setDialog("suspend")}>
          Suspend college
        </Button>
      )}
      {canDoReactivate && (
        <Button variant="outline" size="sm" onClick={() => setDialog("reactivate")}>
          Reactivate college
        </Button>
      )}
      <ActionDialog
        kind={dialog}
        collegeId={collegeId}
        collegeName={collegeName}
        suspension={suspension}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function ActionDialog({
  kind,
  collegeId,
  collegeName,
  suspension,
  onClose,
}: {
  kind: "suspend" | "reactivate" | null;
  collegeId: string;
  collegeName: string;
  suspension: CollegeSuspension;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const run = useMutation({
    mutationFn: () =>
      kind === "suspend"
        ? adminService.colleges.suspend(collegeId, reason.trim())
        : adminService.colleges.reactivate(collegeId, reason.trim() || undefined),
    onSuccess: () => {
      toast.success(
        kind === "suspend"
          ? `${collegeName} has been suspended.`
          : `${collegeName} has been reactivated.`,
      );
      setReason("");
      onClose();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "That did not work. Nothing was changed — please try again.",
      ),
    // Whatever happened (even a conflict because someone else got there first), show the truth.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin", "college", collegeId] }),
  });

  const open = kind !== null;
  const reasonOk = kind === "reactivate" || reason.trim().length > 0;
  const handleOpenChange = (o: boolean) => {
    if (run.isPending) return; // a request that may be writing is never abandoned
    if (!o) {
      setReason("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {kind === "suspend" ? (
          <>
            <DialogHeader>
              <DialogTitle>Suspend {collegeName}?</DialogTitle>
              <DialogDescription>
                {suspension.accounts_active} TPO account
                {suspension.accounts_active === 1 ? "" : "s"} will be blocked immediately: they can
                no longer sign in or use the College Portal. Nothing is deleted, and reactivating
                restores access. Students and companies are not affected, and the college stays
                listed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="suspend-reason">Reason (required)</Label>
              <Textarea
                id="suspend-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={450}
                rows={3}
                placeholder="Why is this college being suspended? It is shown to the TPO and recorded in the audit log."
              />
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reactivate {collegeName}?</DialogTitle>
              <DialogDescription>
                The {suspension.accounts_suspended} TPO account
                {suspension.accounts_suspended === 1 ? "" : "s"} that this suspension blocked will
                be able to sign in again. A TPO blocked separately for another reason stays blocked.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reactivate-reason">Note (optional)</Label>
              <Textarea
                id="reactivate-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Recorded in the audit log."
              />
            </div>
          </>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={run.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={kind === "suspend" ? "destructive" : "default"}
            disabled={run.isPending || !reasonOk}
            onClick={() => run.mutate()}
          >
            {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {kind === "suspend" ? "Suspend college" : "Reactivate college"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
