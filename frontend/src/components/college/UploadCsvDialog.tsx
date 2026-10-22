import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CsvUploadError, studentsService } from "@/services/api/college/college";
import type {
  CsvUploadDuplicate,
  CsvUploadInvalidRow,
  CsvUploadResult,
} from "@/types/college/college";

interface UploadProblem {
  message: string;
  invalidRows?: CsvUploadInvalidRow[];
  duplicates?: CsvUploadDuplicate[];
}

/** What the user is told when a real import fails. Honest about the cases where the outcome is unknown. */
function describeImportFailure(err: unknown): UploadProblem {
  if (err instanceof CsvUploadError) {
    // A 5xx (or a gateway page) does not say whether the database committed anything.
    const unknown = err.status >= 500 && !/unknown|may have been/i.test(err.message);
    return {
      message: unknown
        ? `${err.message} The result of the import is unknown — it may have been applied in full or in part. The roster has been reloaded; check it before uploading again.`
        : err.message,
      invalidRows: err.invalidRows,
      duplicates: err.duplicates,
    };
  }
  if (err instanceof Error) {
    return {
      message: `The connection failed before the server answered (${err.message}), so it is unknown whether the import was applied. The roster has been reloaded; check it before uploading again.`,
    };
  }
  return { message: "CSV upload failed" };
}

/**
 * Roster CSV upload in two steps: check the file (a dry run that saves nothing and shows how many
 * students would be added, updated or left as they are), then confirm to import. The import is
 * non-destructive — a field the file leaves out or leaves blank keeps its stored value — and the
 * confirmation is tied to the preview: if the file or the roster has changed since, the server
 * refuses it and nothing is written.
 */
export function UploadCsvDialog({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<CsvUploadResult | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  // The chosen file itself is unusable (empty / not a CSV). Unlike a failed request, retrying
  // cannot help, so only this blocks the Check button.
  const [fileUnusable, setFileUnusable] = useState(false);
  // State updates are asynchronous, so a double click could start two requests before `busy`
  // re-renders; the ref closes that gap.
  const inFlight = useRef(false);
  const busy = checking || importing;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setProblem(null);
    setFileUnusable(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return; // never abandon a request that may be writing
    setOpen(next);
    if (!next) reset();
  };

  const handleFile = (picked: File | null) => {
    // A preview belongs to the file it was made from, so choosing another file discards it.
    setPreview(null);
    setProblem(null);
    setFileUnusable(false);
    setFile(picked);
    if (!picked) return;
    const message = !picked.name.toLowerCase().endsWith(".csv")
      ? "Choose a .csv file."
      : picked.size === 0
        ? "This file is empty."
        : null;
    if (message) {
      setProblem({ message });
      setFileUnusable(true);
    }
  };

  const handleCheck = async () => {
    if (!file || fileUnusable || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setProblem(null);
    setPreview(null);
    try {
      setPreview(await studentsService.uploadCsv(file, { dryRun: true }));
    } catch (err: unknown) {
      setProblem({
        message: err instanceof Error ? err.message : "Could not check this file.",
        invalidRows: err instanceof CsvUploadError ? err.invalidRows : undefined,
        duplicates: err instanceof CsvUploadError ? err.duplicates : undefined,
      });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  const handleConfirm = async () => {
    if (!file || !preview || inFlight.current) return;
    inFlight.current = true;
    setImporting(true);
    setProblem(null);
    try {
      const result = await studentsService.uploadCsv(file, { expectedPlan: preview.planId });
      toast.success(result.message, {
        description: `${result.created} added, ${result.updated} updated, ${result.unchanged} unchanged.`,
      });
      setOpen(false);
      reset();
      onUploaded();
    } catch (err: unknown) {
      // The roster may have changed (or partly saved), so the old preview no longer applies and
      // the table behind the dialog has to be reloaded to show what is really there.
      setPreview(null);
      setProblem(describeImportFailure(err));
      toast.error("Import failed");
      onUploaded();
    } finally {
      inFlight.current = false;
      setImporting(false);
    }
  };

  const changes = preview ? preview.created + preview.updated : 0;
  const hiddenNotes = preview ? preview.warningsTotal - preview.warnings.length : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" /> Upload CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload student roster</DialogTitle>
          <DialogDescription>
            CSV must include name, email, branch, graduationYear columns (optional score columns,
            verificationStatus and placementStatus). Students are matched by email. Anything the
            file leaves out or leaves blank keeps its current value — nothing is reset.
          </DialogDescription>
        </DialogHeader>

        <Input
          type="file"
          accept=".csv"
          disabled={busy}
          aria-label="Roster CSV file"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />

        {problem && (
          <div
            role="alert"
            className="max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
          >
            <div className="font-medium">{problem.message}</div>
            {problem.invalidRows && problem.invalidRows.length > 0 && (
              <div className="mt-1">
                <div className="mb-1">Fix these rows and choose the file again:</div>
                {problem.invalidRows.map((r) => (
                  <div key={r.line}>
                    Line {r.line}: missing or invalid {r.missing.join(", ")}
                  </div>
                ))}
              </div>
            )}
            {problem.duplicates && problem.duplicates.length > 0 && (
              <div className="mt-1">
                <div className="mb-1">Keep one row per student, then choose the file again:</div>
                {problem.duplicates.map((d) => (
                  <div key={d.email}>
                    Lines {d.lines.join(", ")} all use {d.email} but disagree on{" "}
                    {d.conflicts.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-3" aria-live="polite">
            <div className="grid grid-cols-3 gap-2 text-center">
              <PreviewCount label="Will be added" value={preview.created} />
              <PreviewCount label="Will be updated" value={preview.updated} />
              <PreviewCount label="Already up to date" value={preview.unchanged} />
            </div>
            {changes === 0 && (
              <p className="text-sm text-muted-foreground">
                Every student in this file already matches the roster, so there is nothing to
                import.
              </p>
            )}
            {preview.warnings.length > 0 && (
              <div className="max-h-32 overflow-auto rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <div className="mb-1 font-medium">
                  Worth a look before you confirm (the stored value is kept for anything ignored):
                </div>
                {preview.warnings.map((w) => (
                  <div key={`${w.line}-${w.column}`}>
                    Line {w.line}, {w.column}: "{w.value}" —{" "}
                    {w.reason ?? "not valid, so it is ignored"}
                  </div>
                ))}
                {hiddenNotes > 0 && <div>…and {hiddenNotes} more.</div>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              This is a preview — nothing has been saved. Confirming imports exactly this result: if
              the file or the roster changes first, the import is refused and nothing is written. It
              can still be refused by a database rule.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button
              onClick={handleConfirm}
              disabled={busy || changes === 0}
              className="bg-gradient-brand text-primary-foreground"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                `Confirm import (${changes} ${changes === 1 ? "student" : "students"})`
              )}
            </Button>
          ) : (
            <Button
              onClick={handleCheck}
              disabled={!file || fileUnusable || busy}
              className="bg-gradient-brand text-primary-foreground"
            >
              {checking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
                </>
              ) : (
                "Check file"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="font-display text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
