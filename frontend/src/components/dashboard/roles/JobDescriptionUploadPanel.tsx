import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rolesService } from "@/services/api/roles";
import { ApiClientError } from "@/services/api/client";
import type { JdExtractionResult } from "@/types/role";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB, matches backend limit

interface JobDescriptionUploadPanelProps {
  onExtracted: (result: JdExtractionResult) => void;
  disabled?: boolean;
}

export function JobDescriptionUploadPanel({
  onExtracted,
  disabled,
}: JobDescriptionUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setWarnings([]);
    if (!selected) {
      setFile(null);
      return;
    }
    const isPdf =
      selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Only PDF files are supported.");
      e.target.value = "";
      setFile(null);
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      toast.error("File too large. Maximum size is 5 MB.");
      e.target.value = "";
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true);
    setWarnings([]);
    try {
      const result = await rolesService.extractJobDescription(file);
      onExtracted(result);
      setWarnings(result.warnings);
      toast.success("Extracted! Review the pre-filled fields below before saving.");
    } catch (err: unknown) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Failed to extract the job description. Please try again.";
      toast.error(message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Upload a job description (optional)</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Upload a PDF and we&apos;ll use AI to pre-fill the title, description, skills, experience
        level, role type and preferred qualifications below — you can edit everything before saving.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileInputRef}
          id="jd-file-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          disabled={disabled || extracting}
          className="block w-full flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
          aria-label="Job description PDF"
        />
        <Button
          type="button"
          onClick={handleExtract}
          disabled={!file || disabled || extracting}
          className="shrink-0 bg-gradient-brand text-primary-foreground shadow-soft"
        >
          {extracting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Extracting…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Extract with AI
            </>
          )}
        </Button>
      </div>

      {file && !extracting && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          {file.name}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2.5">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
