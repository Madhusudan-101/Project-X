import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { companyAssessmentService } from "@/services/api/company/assessment";

const DIFF_STYLE: Record<string, string> = {
  Easy: "border-success/40 bg-success/10 text-success",
  Medium: "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  Hard: "border-destructive/30 bg-destructive/5 text-destructive",
};

/** Searchable list of validated library problems. */
export function ProblemPicker({
  chosen,
  onAdd,
}: {
  chosen: Set<string>;
  onAdd: (p: { id: string; title: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState<string>("");
  const debounced = useDebouncedValue(q, 250);

  const { data, isLoading } = useQuery({
    queryKey: ["company-oa-problems", debounced, difficulty],
    queryFn: () =>
      companyAssessmentService.listProblems({
        q: debounced || undefined,
        difficulty: difficulty || undefined,
      }),
  });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search problems…"
            className="pl-8"
            aria-label="Search problems"
          />
        </div>
        {["", "Easy", "Medium", "Hard"].map((d) => (
          <button
            key={d || "all"}
            onClick={() => setDifficulty(d)}
            className={
              "rounded-md border px-2.5 py-1.5 text-xs " +
              (difficulty === d
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted")
            }
          >
            {d || "All"}
          </button>
        ))}
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (data ?? []).length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No validated problems match. Run the import (see backend README) if the library is
            empty.
          </p>
        ) : (
          (data ?? []).map((p) => {
            const picked = chosen.has(p.id);
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                {p.difficulty && (
                  <Badge variant="outline" className={"text-[10px] " + DIFF_STYLE[p.difficulty]}>
                    {p.difficulty}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant={picked ? "secondary" : "outline"}
                  className="h-7 px-2 text-xs"
                  disabled={picked}
                  onClick={() => onAdd({ id: p.id, title: p.title })}
                >
                  {picked ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
