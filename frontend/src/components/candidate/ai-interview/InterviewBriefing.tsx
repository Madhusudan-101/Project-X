import { useState } from "react";
import { Check, Clock, FileText, ShieldCheck, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  AiInterviewAssignment,
  AiInterviewConfig,
  AiInterviewDomain,
} from "@/types/candidate/aiInterview";
import { DOMAINS, domainInfo } from "./domains";
import type { BrowserSupport } from "./supportCheck";

interface Props {
  domain: AiInterviewDomain | null;
  onDomain: (d: AiInterviewDomain) => void;
  onContinue: () => void;
  error: string | null;
  /** Live limits from the backend; null while loading or if the request failed. */
  config: AiInterviewConfig | null;
  configError: string | null;
  onRetryConfig: () => void;
  /** Set when the candidate is taking an interview a company sent them (not practice). */
  assignment?: AiInterviewAssignment | null;
  /** Browser capability check; problems block Continue. Defaults to "fine". */
  support?: BrowserSupport;
  /** Open the no-attempt-used equipment test. */
  onTestSetup?: () => void;
  /** Ask the company for an accommodation (assignments only). */
  onRequestAccommodation?: (message: string) => Promise<void>;
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
  "With your permission, the AI interviewer views your camera to check that your face is visible and that you are alone. You are told on screen if there is a problem.",
  "Leaving the interview tab or window is detected and flagged on screen while it happens.",
  "If your camera or microphone stops, you are asked to restore it. Repeated violations can invalidate the interview.",
];

const DATA_NOTES = [
  "You are speaking with an AI interviewer. Scores are generated automatically and can contain errors.",
  "Your voice is transcribed live. The transcript and your scored report are saved to your account.",
  "Every few seconds, one small frame from your camera is checked by an AI model (Google Gemini) for three things: a face is visible, more than one person is in frame, and the camera is not blocked. Frames are not saved. Only the type of problem and its time are kept.",
  "The camera check does not look at your expression, gaze or appearance, and it does not affect your interview score.",
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
  assignment,
  support = { problems: [], warnings: [] },
  onTestSetup,
  onRequestAccommodation,
}: Props) {
  const [accOpen, setAccOpen] = useState(false);
  const [accText, setAccText] = useState("");
  const [accState, setAccState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [agreed, setAgreed] = useState(false);
  const [audioAgreed, setAudioAgreed] = useState(false);
  const [videoAgreed, setVideoAgreed] = useState(false);
  const selected = domain ? domainInfo(domain) : null;
  const company = assignment?.company_name ?? "";
  const minutes = assignment ? assignment.duration_minutes : config?.maxMinutes;
  const notes = assignment
    ? DATA_NOTES.map((n) =>
        n.startsWith("Your voice is transcribed live")
          ? `Your voice is transcribed live. The transcript, your scored report and any integrity flags are shared with ${company}'s hiring team. You will not see the report.`
          : n,
      )
    : DATA_NOTES;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {assignment
                ? `Step 1 of 3 · Interview for ${company}`
                : "Step 1 of 3 · Practice interview"}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">
              {assignment ? assignment.role_title : "Choose your interview track"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {assignment
                ? `${company} invited you to this interview. You can take it once, so start when you are ready and have time to finish.`
                : "Practice before the real thing. The interviewer asks structured, role-specific questions and scores every answer. Only you see the report."}
            </p>
            {assignment?.instructions && (
              <p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">{assignment.instructions}</p>
            )}
          </div>

          {!assignment && (
            <div
              className="grid gap-3 md:grid-cols-3"
              role="radiogroup"
              aria-label="Interview track"
            >
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
          )}

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
            {[
              {
                icon: Clock,
                k: "Duration",
                v: minutes ? `Up to ${minutes} min` : "Loading…",
              },
              { icon: Video, k: "Format", v: "Live voice and video" },
              {
                icon: FileText,
                k: "Outcome",
                v: assignment ? `Sent to ${company}` : "Scored report",
              },
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

          {!assignment && selected && (
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
            <Bullets items={notes} tone="info" />
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
            <li>About {minutes ?? "…"} uninterrupted minutes</li>
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
              help.
            </span>
          </label>
          <label
            htmlFor="ai-audio-consent"
            className="flex cursor-pointer items-start gap-3 text-sm"
          >
            <Checkbox
              id="ai-audio-consent"
              checked={audioAgreed}
              onCheckedChange={(v) => setAudioAgreed(v === true)}
              className="mt-0.5"
            />
            <span>
              I allow the AI interviewer to listen through my microphone during the interview and to
              transcribe my voice. I understand the transcript is saved to my account.
            </span>
          </label>
          <label
            htmlFor="ai-video-consent"
            className="flex cursor-pointer items-start gap-3 text-sm"
          >
            <Checkbox
              id="ai-video-consent"
              checked={videoAgreed}
              onCheckedChange={(v) => setVideoAgreed(v === true)}
              className="mt-0.5"
            />
            <span>
              I allow the AI interviewer to view my camera during the interview to check that I am
              visible and alone. I understand video is checked live and not recorded.
            </span>
          </label>
          {config && !assignment && (
            <p className="text-sm text-muted-foreground">
              {config.remainingToday > 0
                ? `${config.remainingToday} of ${config.dailyLimit} interviews left today.`
                : `You have used all ${config.dailyLimit} interviews for today. Try again tomorrow.`}
            </p>
          )}
          {support.problems.map((p) => (
            <p key={p} className="text-sm text-destructive" role="alert">
              {p}
            </p>
          ))}
          {support.warnings.map((w) => (
            <p key={w} className="text-sm text-muted-foreground">
              {w}
            </p>
          ))}
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
            disabled={
              support.problems.length > 0 ||
              !agreed ||
              !audioAgreed ||
              !videoAgreed ||
              !(domain || assignment) ||
              !config ||
              (!assignment && config.remainingToday === 0)
            }
            onClick={onContinue}
          >
            Continue to equipment check
          </Button>
          {!domain && !assignment && (
            <p className="text-xs text-muted-foreground">Choose an interview track to continue.</p>
          )}
          {onTestSetup && (
            <Button variant="outline" className="w-full" onClick={onTestSetup}>
              Test my camera and microphone
            </Button>
          )}
          {assignment && (
            <p className="text-xs text-muted-foreground">
              A person at {company} makes the hiring decision. The AI interviewer only gathers and
              scores your answers.
            </p>
          )}
          {assignment && onRequestAccommodation && (
            <div className="space-y-2 border-t pt-3 text-sm">
              {assignment.accommodation_requested || accState === "sent" ? (
                <p className="text-muted-foreground">
                  Accommodation requested. {company} has been told.
                </p>
              ) : !accOpen ? (
                <button type="button" className="underline" onClick={() => setAccOpen(true)}>
                  Need extra time or another format? Ask {company}
                </button>
              ) : (
                <>
                  <label htmlFor="ai-accommodation" className="font-medium">
                    What do you need?
                  </label>
                  <textarea
                    id="ai-accommodation"
                    className="min-h-20 w-full rounded-md border bg-background p-2"
                    maxLength={1000}
                    value={accText}
                    onChange={(e) => setAccText(e.target.value)}
                  />
                  {accState === "error" && (
                    <p className="text-destructive" role="alert">
                      Could not send. Try again.
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={accText.trim().length < 5 || accState === "sending"}
                    onClick={() => {
                      setAccState("sending");
                      onRequestAccommodation(accText.trim()).then(
                        () => setAccState("sent"),
                        () => setAccState("error"),
                      );
                    }}
                  >
                    Send request
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}
