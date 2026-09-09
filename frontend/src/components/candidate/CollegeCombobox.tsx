import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { candidateJobsService } from "@/services/api/candidate/jobs";

// Fallback used only if the colleges endpoint is unavailable / empty.
const FALLBACK_COLLEGES = [
  "LNMIIT Jaipur",
  "NIT Jalandhar",
  "Chitkara University",
  "IIIT Hyderabad",
];
const OTHER = "Other";

interface CollegeComboboxProps {
  /** Resolved college name — either a listed option or the custom-typed one.
   *  The backend resolves this name to a public.colleges row (case-insensitive),
   *  which is the SAME table a company picks a drive's college from. */
  value: string;
  onChange: (name: string) => void;
}

export function CollegeCombobox({ value, onChange }: CollegeComboboxProps) {
  const [open, setOpen] = useState(false);

  const { data: colleges, isLoading } = useQuery({
    queryKey: ["candidate-colleges"],
    queryFn: () => candidateJobsService.listColleges(),
    staleTime: 10 * 60 * 1000,
  });

  const names = useMemo(() => {
    const fromApi = (colleges ?? []).map((c) => c.name).filter(Boolean);
    return fromApi.length > 0 ? fromApi : FALLBACK_COLLEGES;
  }, [colleges]);

  // "Other" mode: a non-empty value that isn't one of the listed colleges
  // (covers a fresh "Other" pick and re-opening a saved custom value). While
  // the list is still loading we don't flip to Other for an existing value.
  const isOtherMode = value !== "" && !isLoading && !names.includes(value);
  const [customDraft, setCustomDraft] = useState(isOtherMode ? value : "");

  const selectListed = (name: string) => {
    setCustomDraft("");
    onChange(name);
    setOpen(false);
  };

  const selectOther = () => {
    onChange(customDraft.trim());
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!value && "text-muted-foreground")}>
              {isOtherMode ? OTHER : value || "Select your college..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search colleges..." />
            <CommandList>
              <CommandEmpty>No match — pick &quot;Other&quot; below.</CommandEmpty>
              <CommandGroup>
                {names.map((college) => (
                  <CommandItem key={college} value={college} onSelect={() => selectListed(college)}>
                    <Check
                      className={cn("h-4 w-4", value === college ? "opacity-100" : "opacity-0")}
                    />
                    {college}
                  </CommandItem>
                ))}
                <CommandItem value={OTHER} onSelect={() => selectOther()}>
                  <Check className={cn("h-4 w-4", isOtherMode ? "opacity-100" : "opacity-0")} />
                  {OTHER}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {isOtherMode && (
        <Input
          placeholder="Enter your college name"
          value={customDraft || value}
          onChange={(e) => {
            setCustomDraft(e.target.value);
            onChange(e.target.value.trim());
          }}
        />
      )}
    </div>
  );
}
