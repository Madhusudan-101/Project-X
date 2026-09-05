import { useState } from "react";
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

const PREDEFINED_COLLEGES = ["LNMIIT Jaipur", "NIT Jalandhar", "Chitkara University", "IIIT Hyderabad"];
const OTHER = "Other";

interface CollegeComboboxProps {
  /** Resolved college name — either a predefined option or the custom-typed one. */
  value: string;
  onChange: (name: string) => void;
}

export function CollegeCombobox({ value, onChange }: CollegeComboboxProps) {
  const [open, setOpen] = useState(false);
  // "Other" mode is active once the current value isn't one of the predefined
  // options (covers both a fresh "Other" pick and re-opening a saved custom value).
  const isOtherMode = value !== "" && !PREDEFINED_COLLEGES.includes(value);
  const [customDraft, setCustomDraft] = useState(isOtherMode ? value : "");

  const selectPredefined = (name: string) => {
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
              <CommandEmpty>No match — pick "Other" below.</CommandEmpty>
              <CommandGroup>
                {PREDEFINED_COLLEGES.map((college) => (
                  <CommandItem key={college} value={college} onSelect={() => selectPredefined(college)}>
                    <Check className={cn("h-4 w-4", value === college ? "opacity-100" : "opacity-0")} />
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
