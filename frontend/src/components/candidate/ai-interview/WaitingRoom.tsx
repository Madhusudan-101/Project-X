import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AiInterviewDomain } from "@/types/candidate/aiInterview";
import { domainInfo } from "./domains";

/** Shown while the LiveKit room connects and the voice agent is dispatched. */
export function WaitingRoom({ domain }: { domain: AiInterviewDomain }) {
  const role = domainInfo(domain)?.role;
  return (
    <Card className="mx-auto max-w-xl space-y-4 p-10 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-brand font-display text-2xl font-semibold text-primary-foreground">
        AI
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Step 3 of 3 · Waiting room
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">Your interviewer is joining</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {role} interview. The timer starts once you are connected. Keep this page open.
        </p>
      </div>
      <p
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Connecting securely…
      </p>
    </Card>
  );
}
