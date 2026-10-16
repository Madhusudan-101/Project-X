import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { peerSafetyService, type GuidelinesState } from "@/services/api/candidate/peerSafety";
import { usePeerGuidelinesStore } from "@/store/candidate/peerGuidelines";

export const CONDUCT_RULES = [
  "Be respectful. Harassment, abuse and inappropriate content are not allowed.",
  "This is practice. Do not share real interview questions from any company, and do not ask your partner to.",
  "Do not record the call or share what your partner says outside the meeting.",
  "Be on time and prepared. If you cannot make it, cancel so your partner is not left waiting.",
  "You can report or block your partner at any time. Reports are reviewed by people, and false reports can lead to penalties. Repeated reports can pause your access.",
];

export const DATA_NOTES = [
  "Your camera and microphone go directly to your partner. Mirracle does not record them.",
  "If you turn on live captions and AI feedback, your speech is converted to text by Deepgram and analysed by Google Gemini. The audio is not stored. A short transcript can be attached to a report if someone reports the call.",
  "Your partner sees your real name only if you leave “keep my identity private” off. Practice reports are visible only to you.",
];

/** Mounted once; opens whenever the server says the guidelines must be accepted first. */
export function PeerGuidelinesGate() {
  const open = usePeerGuidelinesStore((s) => s.open);
  const finish = usePeerGuidelinesStore((s) => s.finish);
  return <PeerGuidelinesDialog open={open} onFinish={finish} />;
}

export function PeerGuidelinesDialog({
  open,
  onFinish,
}: {
  open: boolean;
  onFinish: (accepted: boolean) => void;
}) {
  const [state, setState] = useState<GuidelinesState | null>(null);
  const [rules, setRules] = useState(false);
  const [media, setMedia] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRules(false);
    setMedia(false);
    setAi(false);
    setError(null);
    peerSafetyService
      .guidelines()
      .then(setState)
      .catch(() => setError("Could not load the guidelines. Check your connection and try again."));
  }, [open]);

  const accept = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      await peerSafetyService.acceptGuidelines(state.version);
      onFinish(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onFinish(false)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Peer interview guidelines</DialogTitle>
          <DialogDescription>
            Peer interviews put you on camera with another candidate. Please read how it works
            before you start.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="peer-rules-h" className="space-y-2">
          <h3 id="peer-rules-h" className="text-sm font-semibold">
            How we behave
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {CONDUCT_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="peer-data-h" className="space-y-2">
          <h3 id="peer-data-h" className="text-sm font-semibold">
            Your camera, microphone and data
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {DATA_NOTES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="pg-rules" checked={rules} onCheckedChange={(v) => setRules(v === true)} />
            <Label htmlFor="pg-rules" className="font-normal">
              I have read the guidelines and I will follow them.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="pg-media" checked={media} onCheckedChange={(v) => setMedia(v === true)} />
            <Label htmlFor="pg-media" className="font-normal">
              I understand my camera and microphone are shared live with the person I am matched
              with.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="pg-ai" checked={ai} onCheckedChange={(v) => setAi(v === true)} />
            <Label htmlFor="pg-ai" className="font-normal">
              I understand live captions and AI feedback send my speech to Deepgram and Google
              Gemini, and that I can turn them off before each meeting.
            </Label>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onFinish(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={accept} disabled={busy || !state || !(rules && media && ai)}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} I agree, continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
