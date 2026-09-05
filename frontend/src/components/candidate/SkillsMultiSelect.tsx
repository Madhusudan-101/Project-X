import { useState } from "react";
import { Check, ChevronsUpDown, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { SKILLS_MASTER_LIST, type MasterSkill } from "@/lib/skillsMasterList";

export interface SelectedSkill {
  name: string;
  /** true if typed by the candidate and not found in the master list —
   * unverified against the taxonomy, shown with a distinct badge. */
  isCustom: boolean;
}

interface SkillsMultiSelectProps {
  value: SelectedSkill[];
  onChange: (next: SelectedSkill[]) => void;
  max?: number;
}

export function SkillsMultiSelect({ value, onChange, max = 30 }: SkillsMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedNames = new Set(value.map((s) => s.name.toLowerCase()));

  const addSkill = (skill: SelectedSkill) => {
    if (selectedNames.has(skill.name.toLowerCase()) || value.length >= max) return;
    onChange([...value, skill]);
    setQuery("");
  };

  const removeSkill = (name: string) => {
    onChange(value.filter((s) => s.name.toLowerCase() !== name.toLowerCase()));
  };

  const grouped = SKILLS_MASTER_LIST.reduce<Record<string, MasterSkill[]>>((acc, skill) => {
    (acc[skill.category] ??= []).push(skill);
    return acc;
  }, {});

  const trimmedQuery = query.trim();
  const exactMatchExists = SKILLS_MASTER_LIST.some(
    (s) => s.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {value.length > 0 ? `${value.length} skill${value.length === 1 ? "" : "s"} selected` : "Search skills..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type to search skills..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {trimmedQuery && !exactMatchExists ? (
                  <button
                    type="button"
                    onClick={() => addSkill({ name: trimmedQuery, isCustom: true })}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Add "{trimmedQuery}" as a custom skill
                  </button>
                ) : (
                  "No matching skills."
                )}
              </CommandEmpty>
              {Object.entries(grouped).map(([category, skills]) => (
                <CommandGroup key={category} heading={category}>
                  {skills.map((skill) => {
                    const isSelected = selectedNames.has(skill.name.toLowerCase());
                    return (
                      <CommandItem
                        key={skill.name}
                        value={skill.name}
                        onSelect={() => addSkill({ name: skill.name, isCustom: false })}
                      >
                        <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                        {skill.name}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Selected skills">
          {value.map((s) => (
            <Badge
              key={s.name}
              variant="outline"
              role="listitem"
              className={cn(
                "gap-1 pr-1",
                s.isCustom
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-400"
                  : "border-primary/30 bg-primary/5 text-primary",
              )}
              title={s.isCustom ? "Custom skill — not in the standard list, unverified" : undefined}
            >
              {s.isCustom && <Sparkles className="h-2.5 w-2.5" />}
              {s.name}
              <button
                type="button"
                onClick={() => removeSkill(s.name)}
                aria-label={`Remove ${s.name}`}
                className="ml-1 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
