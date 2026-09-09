import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BRANCH_OPTIONS,
  INTERVIEW_MODE_LABELS,
  JOB_INTERVIEW_MODES,
  ROUND_MODE_LABELS,
  ROUND_MODES,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  type DriveTemplateRound,
  type JobInterviewMode,
  type RoundMode,
  type RoundType,
} from "@/types/jobs";
import { driveTemplatesService } from "@/services/api/company/drives";
import { ApiClientError } from "@/services/api/client";

export function DriveTemplateManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [interviewMode, setInterviewMode] = useState<JobInterviewMode>("ai");
  const [rounds, setRounds] = useState<Omit<DriveTemplateRound, "roundNumber">[]>([
    { roundType: "tech", mode: "ai" },
  ]);
  const [minCgpa, setMinCgpa] = useState("");
  const [branches, setBranches] = useState<string[]>([]);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["company-drive-templates"],
    queryFn: () => driveTemplatesService.list(),
  });

  const reset = () => {
    setName("");
    setInterviewMode("ai");
    setRounds([{ roundType: "tech", mode: "ai" }]);
    setMinCgpa("");
    setBranches([]);
    setShowForm(false);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      driveTemplatesService.create({
        name: name.trim(),
        interviewMode,
        roundsJson: rounds.map((r, i) => ({ ...r, roundNumber: i + 1 })),
        defaultMinCgpa: minCgpa.trim() === "" ? null : Number(minCgpa),
        defaultEligibleBranches: branches.length ? branches : null,
      }),
    onSuccess: () => {
      toast.success("Template saved.");
      queryClient.invalidateQueries({ queryKey: ["company-drive-templates"] });
      reset();
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof ApiClientError || e instanceof Error ? e.message : "Could not save template.",
      ),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Give the template a name.");
      return;
    }
    if (rounds.length === 0) {
      toast.error("Add at least one round.");
      return;
    }
    createMutation.mutate();
  };

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold">Drive templates</h3>
          <p className="text-xs text-muted-foreground">
            Reusable round structures you can drop into any drive — dates get filled in per drive.
          </p>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New template
          </Button>
        )}
      </div>

      {/* Existing templates */}
      <div className="mt-3 space-y-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (templates ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No templates yet.</p>
        ) : (
          (templates ?? []).map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-surface/40 p-2 text-xs"
            >
              <span className="font-medium">{t.name}</span>
              {t.interviewMode && (
                <Badge variant="outline" className="text-[10px]">
                  {INTERVIEW_MODE_LABELS[t.interviewMode]}
                </Badge>
              )}
              {t.roundsJson
                .slice()
                .sort((a, b) => a.roundNumber - b.roundNumber)
                .map((r) => (
                  <Badge key={r.roundNumber} variant="secondary" className="text-[10px]">
                    {ROUND_TYPE_LABELS[r.roundType]} · {ROUND_MODE_LABELS[r.mode]}
                  </Badge>
                ))}
              {t.defaultMinCgpa != null && (
                <span className="text-muted-foreground">CGPA ≥ {t.defaultMinCgpa}</span>
              )}
              {t.defaultEligibleBranches.length > 0 && (
                <span className="text-muted-foreground">
                  {t.defaultEligibleBranches.join(", ")}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mt-4 space-y-3 rounded-lg border border-border/70 bg-surface/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Template name</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. Standard SDE — 3 rounds"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Interview mode</Label>
              <Select
                value={interviewMode}
                onValueChange={(v) => setInterviewMode(v as JobInterviewMode)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_INTERVIEW_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {INTERVIEW_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">Rounds</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => setRounds((r) => [...r, { roundType: "tech", mode: "ai" }])}
              >
                <Plus className="mr-1 h-3 w-3" />
                Round
              </Button>
            </div>
            {rounds.map((rnd, i) => (
              <div
                key={i}
                className="grid items-center gap-2 rounded-md border border-border/60 bg-background p-2 sm:grid-cols-[auto_1fr_1fr_auto]"
              >
                <Badge variant="outline" className="justify-center text-[11px] tabular-nums">
                  R{i + 1}
                </Badge>
                <Select
                  value={rnd.roundType}
                  onValueChange={(v) =>
                    setRounds((rs) =>
                      rs.map((x, j) => (j === i ? { ...x, roundType: v as RoundType } : x)),
                    )
                  }
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
                  onValueChange={(v) =>
                    setRounds((rs) =>
                      rs.map((x, j) => (j === i ? { ...x, mode: v as RoundMode } : x)),
                    )
                  }
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
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setRounds((rs) => rs.filter((_, j) => j !== i))}
                  aria-label={`Remove round ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Default minimum CGPA</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step="0.01"
                className="h-8 w-28 text-xs"
                placeholder="e.g. 7.00"
                value={minCgpa}
                onChange={(e) => setMinCgpa(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Default eligible branches</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {BRANCH_OPTIONS.map((b) => (
                  <label key={b.code} className="flex items-center gap-1.5 text-[11px]">
                    <Checkbox
                      checked={branches.includes(b.code)}
                      onCheckedChange={(v) =>
                        setBranches((prev) =>
                          v === true ? [...prev, b.code] : prev.filter((c) => c !== b.code),
                        )
                      }
                    />
                    {b.code}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={reset} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save template
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
