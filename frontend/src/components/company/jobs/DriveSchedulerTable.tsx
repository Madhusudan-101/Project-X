import { useMemo, useState } from "react";
import { Copy, Plus, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  BRANCH_OPTIONS,
  ROUND_MODE_LABELS,
  ROUND_MODES,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  type CollegeOption,
  type DriveTemplate,
  type RoundMode,
  type RoundType,
} from "@/types/jobs";

// datetime-local strings ("YYYY-MM-DDTHH:mm"); converted to ISO on submit.
export interface DraftRound {
  roundType: RoundType;
  mode: RoundMode;
  windowStart: string;
  windowEnd: string;
}

export interface DraftDrive {
  collegeId: string;
  isOnCampus: boolean;
  applyDeadline: string;
  oaWindowStart: string;
  oaWindowEnd: string;
  minCgpa: string;
  eligibleBranches: string[];
  eligibleBatchYears: number[];
  rounds: DraftRound[];
}

const currentYear = new Date().getFullYear();
const BATCH_YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);

export function emptyDrive(collegeId: string): DraftDrive {
  return {
    collegeId,
    isOnCampus: true,
    applyDeadline: "",
    oaWindowStart: "",
    oaWindowEnd: "",
    minCgpa: "",
    eligibleBranches: [],
    eligibleBatchYears: [],
    rounds: [],
  };
}

function addDays(local: string, days: number): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  // back to a datetime-local value in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

interface DriveSchedulerTableProps {
  value: DraftDrive[];
  onChange: (next: DraftDrive[]) => void;
  colleges: CollegeOption[];
  templates?: DriveTemplate[];
  /** "schedule" shows dates + rounds; "eligibility" shows CGPA/branch/batch. */
  section: "schedule" | "eligibility";
}

export function DriveSchedulerTable({
  value,
  onChange,
  colleges,
  templates = [],
  section,
}: DriveSchedulerTableProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clonePickerFor, setClonePickerFor] = useState<number | null>(null);

  const collegeName = useMemo(() => {
    const m = new Map(colleges.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? "Unknown college";
  }, [colleges]);

  const chosenIds = new Set(value.map((d) => d.collegeId));

  const patch = (idx: number, next: Partial<DraftDrive>) => {
    onChange(value.map((d, i) => (i === idx ? { ...d, ...next } : d)));
  };

  const patchRound = (drvIdx: number, rndIdx: number, next: Partial<DraftRound>) => {
    onChange(
      value.map((d, i) =>
        i === drvIdx
          ? { ...d, rounds: d.rounds.map((r, j) => (j === rndIdx ? { ...r, ...next } : r)) }
          : d,
      ),
    );
  };

  const toggleCollege = (id: string) => {
    if (chosenIds.has(id)) {
      onChange(value.filter((d) => d.collegeId !== id));
    } else {
      onChange([...value, emptyDrive(id)]);
    }
  };

  const addRound = (idx: number) => {
    const drive = value[idx];
    const nextRound: DraftRound = {
      roundType: "tech",
      mode: "ai",
      windowStart: "",
      windowEnd: "",
    };
    // Smart default: suggest +5 days after the previous round's start.
    const prev = drive.rounds[drive.rounds.length - 1];
    if (prev?.windowStart) nextRound.windowStart = addDays(prev.windowStart, 5);
    patch(idx, { rounds: [...drive.rounds, nextRound] });
  };

  const removeRound = (drvIdx: number, rndIdx: number) => {
    patch(drvIdx, { rounds: value[drvIdx].rounds.filter((_, j) => j !== rndIdx) });
  };

  const applyTemplate = (idx: number, tmpl: DriveTemplate) => {
    patch(idx, {
      rounds: tmpl.roundsJson
        .slice()
        .sort((a, b) => a.roundNumber - b.roundNumber)
        .map((r) => ({ roundType: r.roundType, mode: r.mode, windowStart: "", windowEnd: "" })),
      minCgpa:
        value[idx].minCgpa || (tmpl.defaultMinCgpa != null ? String(tmpl.defaultMinCgpa) : ""),
      eligibleBranches:
        value[idx].eligibleBranches.length > 0
          ? value[idx].eligibleBranches
          : tmpl.defaultEligibleBranches,
    });
  };

  const applyTemplateToAll = (tmpl: DriveTemplate) => {
    onChange(
      value.map((d) => ({
        ...d,
        rounds: tmpl.roundsJson
          .slice()
          .sort((a, b) => a.roundNumber - b.roundNumber)
          .map((r) => ({ roundType: r.roundType, mode: r.mode, windowStart: "", windowEnd: "" })),
        minCgpa: d.minCgpa || (tmpl.defaultMinCgpa != null ? String(tmpl.defaultMinCgpa) : ""),
        eligibleBranches:
          d.eligibleBranches.length > 0 ? d.eligibleBranches : tmpl.defaultEligibleBranches,
      })),
    );
  };

  const cloneRow = (idx: number, targetCollegeId: string) => {
    const src = value[idx];
    onChange([
      ...value,
      { ...src, collegeId: targetCollegeId, rounds: src.rounds.map((r) => ({ ...r })) },
    ]);
    setClonePickerFor(null);
  };

  return (
    <div className="space-y-4">
      {/* Add colleges */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" role="combobox">
              <Plus className="mr-1.5 h-4 w-4" />
              Add college
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search colleges…" />
              <CommandList>
                <CommandEmpty>No colleges found.</CommandEmpty>
                <CommandGroup>
                  {colleges.map((c) => (
                    <CommandItem key={c.id} value={c.name} onSelect={() => toggleCollege(c.id)}>
                      <Checkbox className="mr-2" checked={chosenIds.has(c.id)} />
                      {c.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {section === "schedule" && templates.length > 0 && value.length > 0 && (
          <Select
            onValueChange={(id) => {
              const t = templates.find((x) => x.id === id);
              if (t) applyTemplateToAll(t);
            }}
          >
            <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
              <Wand2 className="h-3.5 w-3.5" />
              <SelectValue placeholder="Apply template to all rows" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border/70 bg-surface/40 p-4 text-center text-xs text-muted-foreground">
          Add at least one college — each runs as its own drive with its own dates.
        </p>
      )}

      {value.map((drive, idx) => (
        <div key={drive.collegeId} className="rounded-lg border border-border/70 bg-surface/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{collegeName(drive.collegeId)}</span>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  checked={drive.isOnCampus}
                  onCheckedChange={(v) => patch(idx, { isOnCampus: v })}
                />
                On-campus
              </label>
            </div>
            <div className="flex items-center gap-1">
              {section === "schedule" && (
                <Popover
                  open={clonePickerFor === idx}
                  onOpenChange={(o) => setClonePickerFor(o ? idx : null)}
                >
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      Duplicate
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Copy to college…" />
                      <CommandList>
                        <CommandEmpty>No colleges left.</CommandEmpty>
                        <CommandGroup>
                          {colleges
                            .filter((c) => !chosenIds.has(c.id))
                            .map((c) => (
                              <CommandItem
                                key={c.id}
                                value={c.name}
                                onSelect={() => cloneRow(idx, c.id)}
                              >
                                {c.name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                aria-label="Remove college"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {section === "schedule" ? (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Apply deadline</Label>
                  <Input
                    type="datetime-local"
                    value={drive.applyDeadline}
                    onChange={(e) => {
                      const applyDeadline = e.target.value;
                      // OA window auto-suggests the day after the deadline.
                      const oaWindowStart = drive.oaWindowStart || addDays(applyDeadline, 1);
                      patch(idx, { applyDeadline, oaWindowStart });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">OA window start</Label>
                  <Input
                    type="datetime-local"
                    value={drive.oaWindowStart}
                    onChange={(e) => patch(idx, { oaWindowStart: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">OA window end</Label>
                  <Input
                    type="datetime-local"
                    value={drive.oaWindowEnd}
                    onChange={(e) => patch(idx, { oaWindowEnd: e.target.value })}
                  />
                </div>
              </div>

              {/* Rounds */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">Interview rounds</Label>
                  <div className="flex items-center gap-1.5">
                    {templates.length > 0 && (
                      <Select
                        onValueChange={(id) => {
                          const t = templates.find((x) => x.id === id);
                          if (t) applyTemplate(idx, t);
                        }}
                      >
                        <SelectTrigger className="h-7 w-auto gap-1 text-[11px]">
                          <Wand2 className="h-3 w-3" />
                          <SelectValue placeholder="Load template" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => addRound(idx)}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Round
                    </Button>
                  </div>
                </div>

                {drive.rounds.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No rounds yet. A drive needs every round&apos;s dates set before it can go live.
                  </p>
                )}

                {drive.rounds.map((rnd, rndIdx) => (
                  <div
                    key={rndIdx}
                    className="grid items-end gap-2 rounded-md border border-border/60 bg-background p-2 sm:grid-cols-[auto_1fr_1fr_1fr_1fr_auto]"
                  >
                    <Badge
                      variant="outline"
                      className="h-8 justify-center text-[11px] tabular-nums"
                    >
                      R{rndIdx + 1}
                    </Badge>
                    <Select
                      value={rnd.roundType}
                      onValueChange={(v) => patchRound(idx, rndIdx, { roundType: v as RoundType })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROUND_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {ROUND_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={rnd.mode}
                      onValueChange={(v) => patchRound(idx, rndIdx, { mode: v as RoundMode })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROUND_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {ROUND_MODE_LABELS[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={rnd.windowStart}
                      onChange={(e) => patchRound(idx, rndIdx, { windowStart: e.target.value })}
                    />
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={rnd.windowEnd}
                      onChange={(e) => patchRound(idx, rndIdx, { windowEnd: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeRound(idx, rndIdx)}
                      aria-label={`Remove round ${rndIdx + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Minimum CGPA (0–10)</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step="0.01"
                  className="h-8 w-32 text-xs"
                  placeholder="e.g. 7.00"
                  value={drive.minCgpa}
                  onChange={(e) => patch(idx, { minCgpa: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Eligible branches</Label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {BRANCH_OPTIONS.map((b) => {
                    const checked = drive.eligibleBranches.includes(b.code);
                    return (
                      <label key={b.code} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            patch(idx, {
                              eligibleBranches:
                                v === true
                                  ? [...drive.eligibleBranches, b.code]
                                  : drive.eligibleBranches.filter((c) => c !== b.code),
                            })
                          }
                        />
                        {b.code}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Leave all unchecked to allow every branch.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Eligible batch years</Label>
                <div className="flex flex-wrap gap-1.5">
                  {BATCH_YEAR_OPTIONS.map((y) => {
                    const on = drive.eligibleBatchYears.includes(y);
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() =>
                          patch(idx, {
                            eligibleBatchYears: on
                              ? drive.eligibleBatchYears.filter((v) => v !== y)
                              : [...drive.eligibleBatchYears, y],
                          })
                        }
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                          on
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
