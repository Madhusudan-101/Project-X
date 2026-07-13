import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export interface TagListInputHandle {
  focus: () => void;
}

interface TagListInputProps {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
  /** External validation error (e.g. "at least one required") — takes priority over internal errors. */
  error?: string;
}

/**
 * Reusable tag-list input: type a value, press Enter or click + to add it
 * as a badge. Used for required skills and preferred qualifications.
 */
export const TagListInput = forwardRef<TagListInputHandle, TagListInputProps>(function TagListInput(
  { id, label, hint, values, onChange, placeholder, max = 30, error },
  ref,
) {
  const [inputValue, setInputValue] = useState("");
  const [internalError, setInternalError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const addValue = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setInputValue("");
      return;
    }
    if (values.length >= max) {
      setInternalError(`Maximum ${max} allowed`);
      return;
    }
    onChange([...values, trimmed]);
    setInputValue("");
    setInternalError("");
  };

  const removeValue = (value: string) => {
    onChange(values.filter((v) => v !== value));
    setInternalError("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addValue();
    }
    if (e.key === "Backspace" && inputValue === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const displayError = error || internalError;
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} {hint && <span className="text-muted-foreground">{hint}</span>}
      </Label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label={label}>
          {values.map((v) => (
            <Badge
              key={v}
              variant="outline"
              role="listitem"
              className="gap-1 border-primary/30 bg-primary/5 pr-1 text-primary"
            >
              {v}
              <button
                type="button"
                onClick={() => removeValue(v)}
                aria-label={`Remove ${v}`}
                className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-invalid={!!displayError}
          aria-describedby={displayError ? errorId : undefined}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={addValue}
          aria-label={`Add ${label.toLowerCase()}`}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {displayError && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {displayError}
        </p>
      )}
    </div>
  );
});
