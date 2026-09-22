import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminService } from "@/services/api/admin/admin";
import type { UserRow } from "@/types/admin/admin";
import { ApiClientError } from "@/services/api/client";

export function UnblockUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const unblock = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user selected");
      return adminService.users.unblock(user.user_id, reason.trim() || undefined);
    },
    onSuccess: () => {
      toast.success(`${user?.name ?? "User"} has been unblocked.`);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setReason("");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not unblock this account."),
  });

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!unblock.isPending) { if (!o) setReason(""); onOpenChange(o); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unblock {user.name}</DialogTitle>
          <DialogDescription>
            {user.email} will regain access immediately.
            {user.blocked_reason && <span className="mt-1 block">Currently blocked: &ldquo;{user.blocked_reason}&rdquo;</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="unblock-reason">Note (optional)</Label>
          <Textarea id="unblock-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="Recorded in the audit log." />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={unblock.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={unblock.isPending} onClick={() => unblock.mutate()}>
            {unblock.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Unblock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
