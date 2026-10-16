import { useState } from "react";
import { Check, Clock, FileText, ShieldCheck, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { AiInterviewConfig, AiInterviewDomain } from "@/types/candidate/aiInterview";
import { DOMAINS, domainInfo } from "./domains";

interface Props {
  domain: AiInterviewDomain | null;
  onDomain: (d: AiInterviewDomain) => void;
  onContinue: () => void;
  error: string | null;
  /** Live limits from the backend; null while loading or if the request failed. */
  config: AiInterviewConfig | null;
  configError: string | null;
  onRetryConfig: () => void;
}

const RULES_DO = [
  "Join from a quiet room. Headphones are recommended to avoid echo.",
  "Sit alone, facing the camera, with your face clearly visible and well lit.",
  "Keep your camera and microphone on, and stay on this page for the whole session.",
  "Answer in your own words. You can ask for a question to be repeated or think aloud.",
];

const RULES_DONT = [
  "Do not use AI assistants, search engines, notes or another person to help you answer.",
  "Do not have anyone else in the room, or speak on your behalf.",
  "Do not switch tabs or windows, cover the camera or leave the frame.",
  "Do not copy, record or share the interview questions.",
];

const SUPERVISION = [
  "This session is supervised. Your camera is live in the interview room from start to finish.",
  "Leaving the interview tab or window is detected and flagged on screen while it happens.",
  "If your camera stops, you are asked to restore it. Repeated violations can invalidate the interview.",
];

const DATA_NOTES = [
  "You are speaking with an AI interviewer. Scores are generated automatically and can contain errors.",
  "Your voice is transcribed live. The transcript and your scored report are saved to your account.",
  "Your camera video is streamed to the live interview session.",
  "Closing this tab or ending the call finishes the interview. You cannot resume it.",
];

function Bullets({ items, tone }: { items: string[]; tone: "ok" | "no" | "info" }) {
  const dot =
    tone === "no" ? "bg-destructive" : tone === "ok" ? "bg-success" : "bg-muted-foreground";
  return (
    <ul className="space-y-2 text-sm">
      {items.map((t) => (
        <li key={t} className="flex gap-3">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function InterviewBriefing({
  domain,
  onDomain,
  onContinue,
  error,
  config,
  configError,
  onRetryConfig,
}: Props) {
  const [agreed, setAgreed] = useState(false);
  const selected = domain ? domainInfo(domain) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Step 1 of 3 · Interview briefing
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">Choose your interview track</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You will be interviewed for the role below. The interviewer asks structured,
              role-specific questions and scores every answer against the same rubric.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Interview track">
            {DOMAINS.map((d) => {
              const on = domain === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onDomain(d.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    on
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{d.role}</span>
                    {on && <Check className="h-4 w-4 text-primary" aria-hidden />}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{d.blurb}</div>
                </button>
              );
            })}
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
            {[
              {
                icon: Clock,
                k: "Duration",
                v: config ? `Up to ${config.maxMinutes} min` : "Loading…",
              },
              { icon: Video, k: "Format", v: "Live voice and video" },
              { icon: FileText, k: "Outcome", v: "Scored report" },
              { icon: ShieldCheck, k: "Interviewer", v: "AI" },
            ].map(({ icon: Icon, k, v }) => (
              <div key={k} className="flex flex-col gap-1 bg-card p-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {k}
                </dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {selected && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">Topics for {selected.role}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {selected.topics.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="space-y-6 p-6">
          <div>
            <h2 className="font-display text-xl font-semibold">
              Interview rules and academic integrity
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Read these before you continue. They apply for the whole session.
            </p>
          </div>
          <section aria-labelledby="rules-do" className="space-y-2">
            <h3 id="rules-do" className="text-sm font-semibold">
              You should
            </h3>
            <Bullets items={RULES_DO} tone="ok" />
          </section>
          <section aria-labelledby="rules-dont" className="space-y-2">
            <h3 id="rules-dont" className="text-sm font-semibold">
              You must not
            </h3>
            <Bullets items={RULES_DONT} tone="no" />
          </section>
          <section aria-labelledby="rules-watch" className="space-y-2">
            <h3 id="rules-watch" className="text-sm font-semibold">
              Supervision and plagiarism checks
            </h3>
            <Bullets items={SUPERVISION} tone="info" />
          </section>
          <section aria-labelledby="rules-data" className="space-y-2">
            <h3 id="rules-data" className="text-sm font-semibold">
              AI disclosure and your data
            </h3>
            <Bullets items={DATA_NOTES} tone="info" />
          </section>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="space-y-3 p-5">
          <h2 className="font-display text-base font-semibold">Before you begin</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>Chrome, Edge or Safari, latest version</li>
            <li>Working camera and microphone</li>
            <li>Stable internet connection</li>
            <li>About {config ? config.maxMinutes : "…"} uninterrupted minutes</li>
          </ul>
        </Card>
        <Card className="space-y-4 p-5">
          <label htmlFor="ai-consent" className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              id="ai-consent"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span>
              I have read the rules. I agree to complete this interview on my own, without outside
              help, with my camera on, and to have my voice transcribed and saved.
            </span>
          </label>
          {config && (
            <p className="text-sm text-muted-foreground">
              {config.remainingToday > 0
                ? `${config.remainingToday} of ${config.dailyLimit} interviews left today.`
                : `You have used all ${config.dailyLimit} interviews for today. Try again tomorrow.`}
            </p>
          )}
          {configError && (
            <p className="text-sm text-destructive" role="alert">
              {configError}{" "}
              <button type="button" className="underline" onClick={onRetryConfig}>
                Retry
              </button>
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full bg-gradient-brand text-primary-foreground"
            disabled={!agreed || !domain || !config || config.remainingToday === 0}
            onClick={onContinue}
          >
            Continue to equipment check
          </Button>
          {!domain && (
            <p className="text-xs text-muted-foreground">Choose an interview track to continue.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}
