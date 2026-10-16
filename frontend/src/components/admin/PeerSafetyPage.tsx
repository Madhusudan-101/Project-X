import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { adminQueryOptions } from "@/hooks/admin/query";
import {
  adminPeerSafetyService,
  validateResolution,
  type PeerReportRow,
  type PeerReportStatus,
  type PersonRef,
  type ResolveAction,
} from "@/services/api/admin/peerSafety";
import { REPORT_REASONS } from "@/services/api/candidate/peerSafety";
import { PageHeader } from "./controls";
import { fmtRelative } from "./format";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

const TABS: { id: PeerReportStatus | "all"; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "reviewing", label: "Under review" },
  { id: "actioned", label: "Actioned" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];
const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
const person = (p: PersonRef | null) => (p ? p.name || p.email || p.id : "Unknown");

export function PeerSafetyPage() {
  const [tab, setTab] = useState<PeerReportStatus | "all">("open");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "peer-safety", "list", tab],
    queryFn: () => adminPeerSafetyService.list(tab),
    ...adminQueryOptions,
  });
  const items = q.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Peer safety"
        description="Reports from candidates about people they met in peer interviews. Review the evidence and the reported person's history, then dismiss, warn or suspend. Three different people reporting the same person within 30 days suspends them automatically until you review."
      />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Report status">
        {TABS.map((t) => (
          <Button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <Card className="p-0">
        {q.isLoading ? (
          <ChartSkeleton className="h-40" />
        ) : q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyBlock
            title="No reports here"
            hint="Reports appear as soon as a candidate files one."
          />
        ) : (
          <ul className="divide-y">
            {items.map((r) => (
              <ReportListRow key={r.id} row={r} onOpen={() => setOpen(r.id)} />
            ))}
          </ul>
        )}
      </Card>
      <ReportSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ReportListRow({ row, onOpen }: { row: PeerReportRow; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
      >
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">{reasonLabel(row.reason)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {person(row.reporter)} reported {person(row.reported)} · {fmtRelative(row.created_at)}
            {row.source === "meeting" ? " · from inside the meeting" : ""}
          </div>
        </div>
        <Badge variant={row.status === "open" ? "default" : "outline"}>{row.status}</Badge>
      </button>
    </li>
  );
}

function ReportSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<ResolveAction | "">("");
  const [days, setDays] = useState<number | null>(7);
  const [note, setNote] = useState("");
  const q = useQuery({
    queryKey: ["admin", "peer-safety", "detail", id],
    queryFn: () => adminPeerSafetyService.detail(id as string),
    enabled: !!id,
    ...adminQueryOptions,
  });
  const resolve = useMutation({
    mutationFn: () =>
      adminPeerSafetyService.resolve(id as string, {
        action: action as ResolveAction,
        days: action === "suspend" ? (days ?? undefined) : undefined,
        note,
      }),
    onSuccess: () => {
      toast.success("Report resolved");
      setAction("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin", "peer-safety"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not resolve this report."),
  });
  const d = q.data;
  const problem = validateResolution(action, days);

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{d ? reasonLabel(d.reason) : "Report"}</SheetTitle>
          <SheetDescription>
            {d ? `${person(d.reporter)} reported ${person(d.reported)}` : "Loading the report"}
          </SheetDescription>
        </SheetHeader>
        {q.isLoading && <ChartSkeleton className="mt-6 h-40" />}
        {q.isError && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <div className="mt-6 space-y-5 text-sm">
            {d.details && (
              <section>
                <h3 className="mb-1 font-semibold">What they said</h3>
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3">{d.details}</p>
              </section>
            )}
            <section>
              <h3 className="mb-1 font-semibold">Reported person</h3>
              <p>
                {d.history.total_reports} report{d.history.total_reports === 1 ? "" : "s"} from{" "}
                {d.history.distinct_reporters} different{" "}
                {d.history.distinct_reporters === 1 ? "person" : "people"}.
                {d.active_suspension && (
                  <Badge className="ml-2" variant="destructive">
                    Currently suspended
                  </Badge>
                )}
              </p>
              {d.sanctions.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {d.sanctions.map((s) => (
                    <li key={s.id}>
                      {s.kind} · {fmtRelative(s.created_at)}
                      {s.lifted_at
                        ? " (lifted)"
                        : s.ends_at
                          ? ` until ${new Date(s.ends_at).toLocaleDateString()}`
                          : ""}
                      : {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {d.evidence?.transcript && d.evidence.transcript.length > 0 && (
              <details>
                <summary className="cursor-pointer font-semibold">
                  Transcript attached to the report ({d.evidence.transcript.length} lines)
                </summary>
                <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs">
                  {d.evidence.transcript.join("\n")}
                </pre>
              </details>
            )}
            <section className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Decision</h3>
              {d.status !== "open" && d.status !== "reviewing" && (
                <p className="text-muted-foreground">
                  Already {d.status}
                  {d.resolution_note ? `: ${d.resolution_note}` : ""}. You can still change the
                  outcome below.
                </p>
              )}
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Action">
                {(
                  [
                    ["dismiss", "Dismiss"],
                    ["warn", "Warn"],
                    ["suspend", "Suspend"],
                    ["lift", "Lift suspension"],
                  ] as const
                ).map(([a, label]) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={action === a}
                    variant={action === a ? "default" : "outline"}
                    onClick={() => setAction(a)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {action === "suspend" && (
                <div className="space-y-1.5">
                  <Label htmlFor="suspend-days">Days</Label>
                  <input
                    id="suspend-days"
                    type="number"
                    min={1}
                    max={365}
                    value={days ?? ""}
                    onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
                    className="h-9 w-24 rounded-md border bg-background px-2"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="resolve-note">Note (kept with the report)</Label>
                <Textarea
                  id="resolve-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {action && problem && (
                <p role="alert" className="text-destructive">
                  {problem}
                </p>
              )}
              <Button
                size="sm"
                disabled={!!problem || resolve.isPending}
                onClick={() => resolve.mutate()}
              >
                Save decision
              </Button>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
