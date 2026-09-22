import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, GraduationCap, Search, Users, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService } from "@/services/api/admin/admin";
import type { SearchEntityType } from "@/types/admin/admin";

const GROUP_META: Record<SearchEntityType, { label: string; icon: typeof Search }> = {
  college: { label: "Colleges", icon: GraduationCap },
  company: { label: "Companies", icon: Building2 },
  candidate: { label: "Candidates", icon: Users },
  drive: { label: "Drives", icon: Briefcase },
};

/** Ctrl/Cmd+K command palette. Debounced so not every keystroke hits the
 * database (see /admin/search). Colleges and companies open their detail
 * page directly; candidates and drives (no dedicated detail page yet) open
 * their filtered list. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const q = useQuery({
    queryKey: ["admin", "search", debounced],
    queryFn: () => adminService.search(debounced),
    enabled: open && debounced.trim().length > 0,
    staleTime: 30_000,
  });

  const go = (type: SearchEntityType, id: string) => {
    setOpen(false);
    setQuery("");
    if (type === "college") navigate({ to: "/admin/colleges/$collegeId", params: { collegeId: id } });
    else if (type === "company") navigate({ to: "/admin/companies/$companyId", params: { companyId: id } });
    else if (type === "candidate") navigate({ to: "/admin/candidates" });
    else navigate({ to: "/admin/placements" });
  };

  const groups = Object.entries(q.data?.groups ?? {}) as [SearchEntityType, { id: string; title: string; subtitle: string }[]][];

  return (
    <>
      <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground sm:w-56" onClick={() => setOpen(true)}>
        <Search className="mr-2 h-4 w-4" /> Search…
        <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search colleges, companies, candidates, drives…" value={query} onValueChange={setQuery} />
        <CommandList>
          {debounced.trim().length === 0 ? (
            <CommandEmpty>Start typing to search.</CommandEmpty>
          ) : q.isFetching && groups.length === 0 ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : groups.length === 0 ? (
            <CommandEmpty>No results for &ldquo;{debounced}&rdquo;.</CommandEmpty>
          ) : (
            groups.map(([type, results]) => {
              const meta = GROUP_META[type];
              return (
                <CommandGroup key={type} heading={meta.label}>
                  {results.map((r) => (
                    <CommandItem key={r.id} value={`${type}-${r.id}-${r.title}`} onSelect={() => go(type, r.id)}>
                      <meta.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{r.title}</span>
                      {r.subtitle && <span className="ml-2 text-xs text-muted-foreground">{r.subtitle}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
