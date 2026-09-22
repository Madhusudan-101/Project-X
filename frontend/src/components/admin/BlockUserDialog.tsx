import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, addHours } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { adminService } from "@/services/api/admin/admin";
import type { BlockDuration, UserRow } from "@/types/admin/admin";
import { ApiClientError } from "@/services/api/client";

const DURATIONS: { value: BlockDuration; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

/** Block (temporarily or permanently) a user account. Enforced on the very
 * next request the account makes, not just its next sign-in — see
 * backend/app/deps.py. A temporary block expires on its own; there is
 * nothing to "clean up" later. */
export function BlockUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [permanent, setPermanent] = useState(false);
  const [duration, setDuration] = useState<BlockDuration>("24h");
  const [customUntil, setCustomUntil] = useState("");
  const [reason, setReason] = useState("");

  const reset = () => {
    setPermanent(false);
    setDuration("24h");
    setCustomUntil("");
    setReason("");
  };

  const block = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user selected");
      return adminService.users.block(user.user_id, {
        permanent,
        duration: permanent ? undefined : duration,
        until: !permanent && duration === "custom" && customUntil ? new Date(customUntil).toISOString() : undefined,
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      toast.success(permanent ? `${user?.name ?? "User"} has been permanently blocked.` : `${user?.name ?? "User"} has been temporarily blocked.`);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      reset();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not block this account."),
  });

  if (!user) return null;
  const reasonOk = reason.trim().length > 0;
  const customOk = permanent || duration !== "custom" || !!customUntil;
  const now = new Date();
  const preview = permanent
    ? "until an Admin unblocks it"
    : duration === "custom"
      ? customUntil
        ? `until ${new Date(customUntil).toLocaleString()}`
        : "— pick a date and time below"
      : `until ${
          { "1h": addHours(now, 1), "24h": addHours(now, 24), "7d": addDays(now, 7), "30d": addDays(now, 30) }[duration].toLocaleString()
        }`;

  const handleOpenChange = (o: boolean) => {
    if (block.isPending) return;
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Block {user.name}</DialogTitle>
          <DialogDescription>
            {user.email} ({user.role}) will lose access to the platform {preview}. This takes effect immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Block type</Label>
            <RadioGroup value={permanent ? "permanent" : "temporary"} onValueChange={(v) => setPermanent(v === "permanent")}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="temporary" id="block-temp" />
                <Label htmlFor="block-temp" className="font-normal">Temporary</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="permanent" id="block-perm" />
                <Label htmlFor="block-perm" className="font-normal">Permanent</Label>
              </div>
            </RadioGroup>
          </div>

          {!permanent && (
            <div className="space-y-2">
              <Label>Duration</Label>
              <RadioGroup value={duration} onValueChange={(v) => setDuration(v as BlockDuration)} className="grid grid-cols-2 gap-2">
                {DURATIONS.map((d) => (
                  <div key={d.value} className="flex items-center gap-2">
                    <RadioGroupItem value={d.value} id={`dur-${d.value}`} />
                    <Label htmlFor={`dur-${d.value}`} className="font-normal">{d.label}</Label>
                  </div>
                ))}
              </RadioGroup>
              {duration === "custom" && (
                <Input
                  type="datetime-local"
                  value={customUntil}
                  min={new Date(now.getTime() + 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  aria-label="Blocked until"
                />
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="block-reason">Reason (required)</Label>
            <Textarea
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Why is this account being blocked? This is recorded in the audit log."
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={block.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={block.isPending || !reasonOk || !customOk}
            onClick={() => block.mutate()}
          >
            {block.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {permanent ? "Permanently block" : "Block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
