import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * The page every pre-test screen sits in: the assessment title and test facts on the left, one card
 * on the right, and the step dots with Back / Continue underneath (the layout candidates know from
 * other assessment platforms). On a phone it stacks.
 */
export function StartShell({
  title,
  subtitle,
  facts,
  children,
  step,
  steps,
  actions,
}: {
  title: string;
  subtitle: string;
  facts: ReactNode;
  children: ReactNode;
  /** 0-based index of the current step; omit for status screens (no dots) */
  step?: number;
  steps?: number;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[5fr_7fr]">
      <aside className="relative flex flex-col justify-between gap-10 overflow-hidden border-b border-border bg-gradient-to-br from-primary/15 via-background to-background p-6 sm:p-10 lg:min-h-screen lg:border-b-0 lg:p-14">
        <div>
          <Link
            to="/candidate"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="mt-10 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
        </div>
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card/70 p-4 text-sm backdrop-blur">
            {facts}
          </div>
          <p className="text-xs text-muted-foreground">
            Powered by <span className="font-semibold text-foreground">Mirracle</span>
          </p>
        </div>
      </aside>

      <section className="flex flex-col gap-5 p-4 sm:p-8 lg:h-screen lg:p-12">
        <div className="min-h-[24rem] flex-1 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8 lg:min-h-0 lg:p-10">
          {children}
        </div>
        {(actions || steps) && (
          <div className="flex items-center justify-between gap-4">
            {steps ? (
              <div
                className="flex gap-2"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={steps}
                aria-valuenow={(step ?? 0) + 1}
                aria-label={`Step ${(step ?? 0) + 1} of ${steps}`}
              >
                {Array.from({ length: steps }, (_, i) => (
                  <span
                    key={i}
                    className={
                      "h-2 w-7 rounded-full transition-colors " +
                      (i <= (step ?? 0) ? "bg-primary" : "bg-border")
                    }
                  />
                ))}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">{actions}</div>
          </div>
        )}
      </section>
    </div>
  );
}
