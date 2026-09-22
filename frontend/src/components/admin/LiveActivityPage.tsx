import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Loader2, Pause, Play } from "lucide-react";
import {
  Award, Building2, CalendarPlus, FileCheck2, FileDown, GraduationCap, LogIn, ShieldCheck as ShieldCheckIcon,
  ShieldOff, UserPlus, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import type { FeedItem } from "@/types/admin/admin";
import { FilterSelect, PageHeader, StatusBadge } from "./controls";
import { EVENT_TYPE_LABEL } from "./status";
import { EmptyBlock, ErrorBlock } from "./StateViews";

const POLL_MS = 20_000; // deliberately not aggressive — see the module docstring on the backend route.

const ICONS: Record<string, LucideIcon> = {
  candidate_registered: UserPlus,
  company_registered: Building2,
  college_registered: GraduationCap,
  drive_created: CalendarPlus,
  application_submitted: FileCheck2,
  candidate_selected: Award,
  user_login: LogIn,
  account_provisioned: UserPlus,
  user_blocked: ShieldOff,
  user_unblocked: ShieldCheckIcon,
  csv_exported: FileDown,
  report_generated: FileDown,
};

const KIND_OPTIONS = Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => ({ value, label }));

function describe(item: FeedItem): string {
  switch (item.kind) {
    case "candidate_registered": return `${item.subject} registered as a candidate`;
    case "company_registered": return `${item.subject} joined${item.detail ? ` (${item.detail})` : ""}`;
    case "college_registered": return `${item.subject} was onboarded as a college`;
    case "drive_created": return `${item.subject} opened a drive: ${item.detail}`;
    case "application_submitted": return `Application submitted to ${item.subject}${item.detail ? ` — ${item.detail}` : ""}`;
    case "candidate_selected": return `A candidate was selected at ${item.subject}${item.detail ? ` — ${item.detail}` : ""}`;
    case "user_login": return `${item.subject} signed in`;
    case "account_provisioned": return `${item.subject} provisioned an account${item.detail ? ` for ${item.detail}` : ""}`;
    case "user_blocked": return `${item.subject} blocked ${item.detail ?? "a user"}`;
    case "user_unblocked": return `${item.subject} unblocked ${item.detail ?? "a user"}`;
    case "csv_exported": return `${item.subject} exported ${item.detail ?? "a CSV"}`;
    case "report_generated": return `${item.subject} generated ${item.detail ?? "a report"}`;
    default: return `${item.subject}${item.detail ? ` — ${item.detail}` : ""}`;
  }
}

/** Live Activity: newest first, polled (never aggressively) with pause/resume,
 * plus keyset paging into history. "Live" is shown ONLY while polling is
 * actually on — never claimed when paused or on an error. */
export function LiveActivityPage() {
  const { range } = useAdminRange();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string>();
  const [live, setLive] = useState(true);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const head = useQuery({
    queryKey: ["admin", "live-activity", "head", range, kind],
    queryFn: () => adminService.liveActivity(range, { kind, limit: 30 }),
    refetchInterval: live ? POLL_MS : false,
    refetchOnWindowFocus: live,
  });

  // Reset the accumulated feed whenever the filter/range changes.
  useEffect(() => {
    setItems([]);
    seenIds.current = new Set();
  }, [range.from, range.to, kind]);

  useEffect(() => {
    if (!head.data) return;
    const fresh = head.data.items.filter((i) => !seenIds.current.has(i.id));
    if (fresh.length === 0) return;
    fresh.forEach((i) => seenIds.current.add(i.id));
    setItems((prev) => [...fresh, ...prev]);
  }, [head.data]);

  const loadOlder = async () => {
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await queryClient.fetchQuery({
        queryKey: ["admin", "live-activity", "older", oldest.occurred_at, range, kind],
        queryFn: () => adminService.liveActivity(range, { kind, before: oldest.occurred_at, limit: 30 }),
      });
      const fresh = res.items.filter((i) => !seenIds.current.has(i.id));
      fresh.forEach((i) => seenIds.current.add(i.id));
      setItems((prev) => [...prev, ...fresh]);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Live Activity"
        description="Every kind of platform event, newest first. Polled automatically while Live is on — pause any time; nothing is missed while paused, it just stops refreshing."
        actions={
          <Button variant="outline" size="sm" onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {live ? "Pause" : "Resume"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={kind} onChange={setKind} options={KIND_OPTIONS} allLabel="All event types" className="w-full sm:w-56" />
        {live ? (
          <StatusBadge tone="success">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden /> Live
          </StatusBadge>
        ) : (
          <StatusBadge tone="muted">Paused</StatusBadge>
        )}
      </div>

      <Card className="p-5">
        {head.isError && items.length === 0 ? (
          <ErrorBlock error={head.error} onRetry={() => head.refetch()} />
        ) : head.isLoading && items.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyBlock title="No activity yet" hint="Events appear here as the platform is used." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const Icon = ICONS[item.kind] ?? FileCheck2;
                return (
                  <li key={item.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 break-words">{describe(item)}</span>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.occurred_at}>
                      {formatDistanceToNow(parseISO(item.occurred_at), { addSuffix: true })}
                    </time>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Load older
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
