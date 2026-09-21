import type { ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NA } from "./format";

interface KpiCardProps {
  label: string;
  /** Pre-formatted. null/undefined → N/A (muted): the value cannot be calculated. */
  value: string | null | undefined;
  icon?: LucideIcon;
  /** Secondary line, e.g. "+12 in this period". */
  sub?: ReactNode;
  /** How the number is calculated / why it is N/A — shown on hover. */
  definition?: string;
  loading?: boolean;
}

export function KpiCard({ label, value, icon: Icon, sub, definition, loading }: KpiCardProps) {
  const isNa = value == null || value === NA;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {label}
          {definition && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`How ${label} is calculated`}
                  className="text-muted-foreground/70 hover:text-foreground"
                >
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">{definition}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div
          className={`mt-1.5 font-display text-2xl font-semibold tabular-nums ${isNa ? "text-muted-foreground" : ""}`}
        >
          {isNa ? NA : value}
        </div>
      )}
      {sub && !loading && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

/** A titled group of KPI cards. */
export function KpiGroup({ title, cols = 4, children }: { title: string; cols?: 3 | 4 | 5; children: ReactNode }) {
  const xl = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" }[cols];
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className={`grid gap-3 sm:grid-cols-2 ${xl}`}>{children}</div>
    </section>
  );
}
