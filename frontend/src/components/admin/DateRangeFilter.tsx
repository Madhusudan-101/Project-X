import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRESET_LABELS, useAdminRange } from "@/hooks/admin/use-admin-range";
import { useAdminRangeStore } from "@/store/admin/dateRange";

const PRESETS = Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[];

/** The global date filter. Every admin query is keyed on this range, so
 * changing it re-queries the backend — it is never a display-only label. */
export function DateRangeFilter() {
  const { label } = useAdminRange();
  const preset = useAdminRangeStore((s) => s.preset);
  const setPreset = useAdminRangeStore((s) => s.setPreset);
  const setCustom = useAdminRangeStore((s) => s.setCustom);
  const storedFrom = useAdminRangeStore((s) => s.customFrom);
  const storedTo = useAdminRangeStore((s) => s.customTo);

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(storedFrom);
  const [to, setTo] = useState(storedTo);
  const invalid = !from || !to || from > to;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Date range: ${label}`}>
          <CalendarDays className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <ul className="grid grid-cols-2 gap-1">
          {PRESETS.map((p) => (
            <li key={p}>
              <Button
                variant={preset === p ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setPreset(p);
                  setOpen(false);
                }}
              >
                {PRESET_LABELS[p]}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="text-xs">
                From
              </Label>
              <Input id="range-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="text-xs">
                To (inclusive)
              </Label>
              <Input id="range-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={invalid}
            variant={preset === "custom" ? "secondary" : "default"}
            onClick={() => {
              setCustom(from, to);
              setOpen(false);
            }}
          >
            Apply custom range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
