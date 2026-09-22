import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { adminService } from "@/services/api/admin/admin";
import type { AlertItem } from "@/types/admin/admin";
import { StatusBadge } from "./controls";
import { fmtRelative } from "./format";
import { ALERT_SEVERITY } from "./status";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

/** Alerts are computed live on every request — nothing is stored, so there is
 * no persistent per-admin "dismiss" (that would need its own table this
 * schema doesn't have). "Hide" here only hides it for this browser tab until
 * the page reloads or the underlying condition changes the alert's id —
 * it is a viewing convenience, not a record of who dismissed what. */
export function AlertsPanel({ limit, linkToAll = true }: { limit?: number; linkToAll?: boolean }) {
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: adminService.alerts, ...adminQueryOptions, refetchInterval: 60_000 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const items = (q.data?.items ?? []).filter((a) => !hidden.has(a.alert_id));
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Needs attention</h2>
          <p className="text-xs text-muted-foreground">Computed from current data — always current, not a saved list.</p>
        </div>
        {linkToAll && items.length > 0 && (
          <Link to="/admin/alerts" className="text-xs font-medium text-primary hover:underline">
            View all ({items.length})
          </Link>
        )}
      </div>
      {q.isLoading ? (
        <ChartSkeleton className="h-24" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyBlock title="Nothing needs attention right now" />
      ) : (
        <ul className="space-y-2">
          {shown.map((a) => (
            <AlertRow key={a.alert_id} alert={a} onHide={() => setHidden((s) => new Set(s).add(a.alert_id))} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertRow({ alert, onHide }: { alert: AlertItem; onHide: () => void }) {
  const sev = ALERT_SEVERITY[alert.severity] ?? ALERT_SEVERITY.info;
  return (
    <li className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
      <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>
      <div className="min-w-0 flex-1">
        <a href={alert.link} className="font-medium hover:underline">{alert.title}</a>
        <p className="mt-0.5 text-xs text-muted-foreground">{alert.description}</p>
        {alert.occurred_at && <p className="mt-0.5 text-xs text-muted-foreground">{fmtRelative(alert.occurred_at)}</p>}
      </div>
      <Button variant="ghost" size="sm" aria-label="Hide this alert for now" onClick={onHide} className="shrink-0">
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
