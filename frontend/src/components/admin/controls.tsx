import { useState, type ReactNode } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadCsvBlob } from "@/services/api/client";
import type { CsvExport } from "@/types/admin/admin";
import { fmtInt } from "./format";
import type { Tone } from "./status";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
        maxLength={100}
      />
    </div>
  );
}

const ALL = "__all__";

/** A dropdown filter. `value` undefined = "All" (radix Select can't hold an empty string). */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  className = "w-full sm:w-44",
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className} aria-label={allLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Downloads the currently filtered dataset as CSV. The backend fetches it in chunks up to a hard
 * cap; if the cap cut the export short the file is still saved, but the user is told loudly that it
 * is incomplete and how to narrow it — never a silent partial export. */
export function ExportButton({ onExport, filename }: { onExport: () => Promise<CsvExport>; filename: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await onExport();
          downloadCsvBlob(result.blob, filename);
          if (result.truncated) {
            toast.warning(
              `Export incomplete: only the first ${fmtInt(result.rows)} of ${fmtInt(result.total)} rows were exported (the export limit was reached). Narrow the date range or filters and export again.`,
              { duration: 15000 },
            );
          } else {
            toast.success(`Exported ${fmtInt(result.rows)} row${result.rows === 1 ? "" : "s"}.`);
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Export failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      Export CSV
    </Button>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

const TONES: Record<Tone, string> = {
  success: "border-transparent bg-success/15 text-success",
  warning: "border-transparent bg-warning/15 text-warning",
  primary: "border-transparent bg-primary/15 text-primary",
  muted: "border-transparent bg-muted text-muted-foreground",
  destructive: "border-transparent bg-destructive/15 text-destructive",
  outline: "text-muted-foreground",
};

/** Status is always a labelled badge — never colour alone. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-medium ${TONES[tone]}`}>
      {children}
    </Badge>
  );
}

export function ActivityBadge({ active }: { active: boolean }) {
  return <StatusBadge tone={active ? "success" : "muted"}>{active ? "Active" : "Inactive"}</StatusBadge>;
}
