import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Users, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type { CameraSnapshot, CameraSnapshots } from "@/types/company/assessment";

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function flag(s: CameraSnapshot): "none" | "multi" | null {
  if (s.faces === 0) return "none";
  if (s.faces !== null && s.faces > 1) return "multi";
  return null;
}

/**
 * A candidate's camera snapshots. Loaded only when the recruiter opens the result, because
 * every photo needs a signed URL. "No face" / "several faces" come from the candidate's
 * browser, so they point at frames worth a look; they are not findings.
 */
export function CameraGallery({
  jobId,
  driveId,
  applicationId,
  mode,
}: {
  jobId: string;
  driveId: string;
  applicationId: string;
  mode: "off" | "optional" | "required";
}) {
  const { data, isLoading, isError } = useQuery<CameraSnapshots>({
    queryKey: ["company-oa", jobId, driveId, "snapshots", applicationId],
    queryFn: () => companyAssessmentService.cameraSnapshots(jobId, driveId, applicationId),
    enabled: mode !== "off",
    retry: false,
    staleTime: 4 * 60_000, // signed URLs last 10 minutes
  });
  const [open, setOpen] = useState<CameraSnapshot | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  if (mode === "off") return null;

  const items = data?.items ?? [];
  const noFace = items.filter((s) => flag(s) === "none").length;
  const multi = items.filter((s) => flag(s) === "multi").length;
  const shown = onlyFlagged ? items.filter((s) => flag(s)) : items;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">Camera snapshots</h3>
        {noFace > 0 && <Badge variant="destructive">{noFace} with nobody in frame</Badge>}
        {multi > 0 && <Badge variant="destructive">{multi} with several people</Badge>}
        {items.some((s) => flag(s)) && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Only flagged
          </label>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError || !data ? (
        <p className="text-xs text-destructive">Couldn&apos;t load the snapshots.</p>
      ) : !data.consentedAt ? (
        <p className="text-xs text-muted-foreground">
          This candidate did not agree to camera monitoring, so no photos were taken.
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No snapshots were stored
          {data.retentionDays ? ` (or they were deleted after ${data.retentionDays} days)` : ""}.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {shown.map((s) => {
              const f = flag(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(s)}
                    className={
                      "relative block w-full overflow-hidden rounded-md border " +
                      (f ? "border-destructive" : "border-border")
                    }
                    title={s.question ? `Q${s.question.position} · ${s.question.title}` : undefined}
                  >
                    {s.url ? (
                      <img
                        src={s.url}
                        alt={`Camera at ${clock(s.offsetSeconds)}`}
                        loading="lazy"
                        className="aspect-[4/3] w-full -scale-x-100 object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center text-[10px] text-muted-foreground">
                        unavailable
                      </div>
                    )}
                    <span className="absolute bottom-0 left-0 flex items-center gap-1 rounded-tr bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {f === "none" && <UserX className="h-3 w-3" />}
                      {f === "multi" && <Users className="h-3 w-3" />}
                      {clock(s.offsetSeconds)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Flags come from the candidate&apos;s browser and can be wrong (lighting, glasses, a
            browser that can&apos;t count faces). Photos are deleted {data.retentionDays} days after
            the test.
          </p>
        </>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {open ? `At ${clock(open.offsetSeconds)}` : "Snapshot"}
              {open?.question ? ` · Q${open.question.position} ${open.question.title}` : ""}
            </DialogTitle>
          </DialogHeader>
          {open?.url && (
            <img src={open.url} alt="Camera snapshot" className="w-full -scale-x-100 rounded-md" />
          )}
          {open && open.faces !== null && (
            <p className="text-xs text-muted-foreground">
              The browser counted {open.faces} face{open.faces === 1 ? "" : "s"}.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
