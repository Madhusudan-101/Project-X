import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { peerService, type PeerPreferences } from "@/services/api/candidate/peer";

export const DEFAULT_PREFERENCES: PeerPreferences = {
  default_private: true,
  timezone: null,
  email_invites: true,
  email_reminders: true,
};

/** The browser's own timezone, used when the person has not chosen one. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The timezones the browser knows about, with the person's current one always included. */
export function timezoneChoices(current: string | null): string[] {
  let all: string[] = [];
  try {
    all =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        "timeZone",
      ) ?? [];
  } catch {
    all = [];
  }
  const set = new Set(all);
  set.add(browserTimezone());
  if (current) set.add(current);
  return [...set].sort();
}

export function PeerSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [prefs, setPrefs] = useState<PeerPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setError(null);
    peerService
      .getPreferences()
      .then((p) => {
        setPrefs(p);
        setLoaded(true);
      })
      .catch(() => setError("Could not load your settings."));
  }, [open]);

  const zones = useMemo(() => timezoneChoices(prefs.timezone), [prefs.timezone]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await peerService.setPreferences(prefs);
      toast.success("Settings saved");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Peer interview settings</DialogTitle>
          <DialogDescription>These apply to every peer interview you do.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="ps-private"
              checked={prefs.default_private}
              onCheckedChange={(v) => setPrefs((p) => ({ ...p, default_private: v === true }))}
            />
            <Label htmlFor="ps-private" className="font-normal">
              Keep my identity private by default. Your partner sees “Anonymous Candidate” instead
              of your name.
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ps-timezone">Your timezone</Label>
            <select
              id="ps-timezone"
              className="h-10 w-full rounded-md border bg-card px-3 text-sm"
              value={prefs.timezone ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, timezone: e.target.value || null }))}
            >
              <option value="">Use my browser’s ({browserTimezone()})</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Times in emails are shown in this timezone.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Emails</legend>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ps-invites"
                checked={prefs.email_invites}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, email_invites: v === true }))}
              />
              <Label htmlFor="ps-invites" className="font-normal">
                When someone invites me, moves or cancels a meeting
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ps-reminders"
                checked={prefs.email_reminders}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, email_reminders: v === true }))}
              />
              <Label htmlFor="ps-reminders" className="font-normal">
                Reminders before a meeting, and if my partner does not show up
              </Label>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !loaded}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
