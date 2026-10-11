import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardStats } from "@/lib/demo/college/engine";
import { DEMO_BASE, DEMO_COLLEGE_NAME } from "@/lib/demo/college/mode";
import { buildSeedState } from "@/lib/demo/college/seed";

/**
 * "Explore Demo" entry on the College Portal sign-in page. The three figures are computed
 * from the same sample dataset the demo itself uses, so the teaser can never disagree with
 * what the visitor sees after clicking. It links to a public, read-from-sample-data route;
 * it creates no session and touches no account.
 */
export function ExploreDemoCard() {
  const [opening, setOpening] = useState(false);

  const preview = useMemo(() => {
    const s = dashboardStats(buildSeedState());
    return [
      { label: "Students", value: String(s.totalStudents) },
      { label: "Placement rate", value: `${s.placementPercentage.toFixed(0)}%` },
      { label: "Active drives", value: String(s.activeCompanyDrives) },
    ];
  }, []);

  // If navigation is somehow interrupted, don't leave the button stuck on "Opening…".
  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => setOpening(false), 4000);
    return () => clearTimeout(t);
  }, [opening]);

  return (
    <section
      aria-labelledby="explore-demo-title"
      className="mt-8 rounded-2xl border border-primary/25 bg-primary-soft/60 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <h2 id="explore-demo-title" className="font-display text-base font-semibold">
            Just looking around?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore the College Portal with sample placement data. No login required.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {preview.map((p) => (
          <div key={p.label} className="rounded-lg border border-border/60 bg-surface/80 px-2 py-2">
            <dd className="font-display text-lg font-semibold leading-none">{p.value}</dd>
            <dt className="mt-1 text-[11px] text-muted-foreground">{p.label}</dt>
          </div>
        ))}
      </dl>

      <Button
        asChild
        variant="outline"
        className="mt-4 w-full border-primary/40 bg-surface text-primary hover:bg-primary-soft"
      >
        <Link to={DEMO_BASE as never} onClick={() => setOpening(true)} aria-busy={opening}>
          {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {opening ? "Opening demo…" : "Explore demo"}
          {!opening && <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />}
        </Link>
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Fictional data for {DEMO_COLLEGE_NAME}. Changes are temporary and never touch real records.
      </p>
    </section>
  );
}
