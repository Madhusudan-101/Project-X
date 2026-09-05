import { useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
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
import { ROLES_MASTER_LIST, type MasterRole } from "@/lib/rolesMasterList";

interface RolesMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}

export function RolesMultiSelect({ value, onChange, max = 10 }: RolesMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = new Set(value.map((r) => r.toLowerCase()));

  const addRole = (role: string) => {
    if (selected.has(role.toLowerCase()) || value.length >= max) return;
    onChange([...value, role]);
    setQuery("");
  };

  const removeRole = (role: string) => {
    onChange(value.filter((r) => r.toLowerCase() !== role.toLowerCase()));
  };

  const grouped = ROLES_MASTER_LIST.reduce<Record<string, MasterRole[]>>((acc, role) => {
    (acc[role.category] ??= []).push(role);
    return acc;
  }, {});

  const trimmedQuery = query.trim();
  const exactMatchExists = ROLES_MASTER_LIST.some(
    (r) => r.name.toLowerCase() === trimmedQuery.toLowerCase(),
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
            {value.length > 0 ? `${value.length} role${value.length === 1 ? "" : "s"} selected` : "Search roles..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type to search roles..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {trimmedQuery && !exactMatchExists ? (
                  <button
                    type="button"
                    onClick={() => addRole(trimmedQuery)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    Add "{trimmedQuery}" as a role
                  </button>
                ) : (
                  "No matching roles."
                )}
              </CommandEmpty>
              {Object.entries(grouped).map(([category, roles]) => (
                <CommandGroup key={category} heading={category}>
                  {roles.map((role) => {
                    const isSelected = selected.has(role.name.toLowerCase());
                    return (
                      <CommandItem key={role.name} value={role.name} onSelect={() => addRole(role.name)}>
                        <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                        {role.name}
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
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Selected roles">
          {value.map((r) => (
            <Badge
              key={r}
              variant="outline"
              role="listitem"
              className="gap-1 border-primary/30 bg-primary/5 pr-1 text-primary"
            >
              {r}
              <button
                type="button"
                onClick={() => removeRole(r)}
                aria-label={`Remove ${r}`}
                className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
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
