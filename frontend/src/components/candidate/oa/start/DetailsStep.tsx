import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OADetailsForm } from "@/types/candidate/assessment";
import { validateDetails } from "./details";

const FIELDS: {
  key: keyof OADetailsForm;
  label: string;
  type?: string;
  inputMode?: "numeric" | "decimal" | "tel";
  readOnly?: boolean;
  autoComplete?: string;
}[] = [
  { key: "fullName", label: "Full name", autoComplete: "name" },
  { key: "email", label: "Email address", type: "email", readOnly: true },
  { key: "phone", label: "Contact number", type: "tel", inputMode: "tel", autoComplete: "tel" },
  { key: "college", label: "University / college name" },
  { key: "rollNumber", label: "Student roll number" },
  { key: "branch", label: "Stream / branch" },
  { key: "graduationYear", label: "Graduation year", inputMode: "numeric" },
  { key: "cgpa", label: "CGPA", inputMode: "decimal" },
];

/** Step 2: confirm who is taking the test, and accept the declaration. */
export function DetailsStep({
  value,
  onChange,
  pledge,
  onPledge,
  recording,
  onRecording,
  companyName,
}: {
  value: OADetailsForm;
  onChange: (next: OADetailsForm) => void;
  pledge: boolean;
  onPledge: (v: boolean) => void;
  recording: boolean;
  onRecording: (v: boolean) => void;
  companyName: string;
}) {
  const [touched, setTouched] = useState<Partial<Record<keyof OADetailsForm, boolean>>>({});
  const errors = validateDetails(value);

  return (
    <div className="space-y-7">
      <div>
        <h2 className="font-display text-2xl font-semibold">Please confirm your details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {companyName} uses these to match the test to you. Check that they are correct.
        </p>
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const err = touched[f.key] ? errors[f.key] : undefined;
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`oa-${f.key}`}>
                {f.label} <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`oa-${f.key}`}
                type={f.type ?? "text"}
                inputMode={f.inputMode}
                autoComplete={f.autoComplete}
                value={value[f.key]}
                readOnly={f.readOnly}
                aria-invalid={!!err}
                aria-describedby={err ? `oa-${f.key}-err` : undefined}
                className={f.readOnly ? "bg-muted/50 text-muted-foreground" : undefined}
                onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
              />
              {err && (
                <p id={`oa-${f.key}-err`} className="text-xs text-destructive">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed">
          <Checkbox
            checked={pledge}
            onCheckedChange={(v) => onPledge(v === true)}
            className="mt-0.5"
          />
          <span>
            I have read the instructions. I agree not to copy code from any source, including
            friends or colleagues, and not to use websites or AI tools for help. I will not copy or
            share any question or content from this assessment.{" "}
            <span className="text-destructive">*</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed">
          <Checkbox
            checked={recording}
            onCheckedChange={(v) => onRecording(v === true)}
            className="mt-0.5"
          />
          <span>
            I understand my activity during the test (tab and window changes, fullscreen exits, copy
            and paste, my code and its similarity to other candidates&apos;) is recorded and shared
            with {companyName}. <span className="text-destructive">*</span>
          </span>
        </label>
      </div>
    </div>
  );
}
