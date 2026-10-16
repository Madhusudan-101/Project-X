import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { peerSafetyService, type BlockedPerson } from "@/services/api/candidate/peerSafety";

export function BlockedPeopleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    peerSafetyService
      .blocks()
      .then(setPeople)
      .catch(() => setError("Could not load your blocked people."));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const unblock = async (p: BlockedPerson) => {
    try {
      await peerSafetyService.unblock(p.id);
      setPeople((all) => (all ?? []).filter((x) => x.id !== p.id));
      toast.success("Unblocked");
    } catch {
      toast.error("Could not unblock. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Blocked people</DialogTitle>
          <DialogDescription>
            You will not be matched with these people, and they cannot see or join your meetings.
            They are never told that you blocked them.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {people === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {people?.length === 0 && (
          <p className="text-sm text-muted-foreground">You have not blocked anyone.</p>
        )}
        <ul className="space-y-2">
          {people?.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <div>
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">
                  Blocked {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => unblock(p)}
                aria-label={`Unblock ${p.label}`}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
