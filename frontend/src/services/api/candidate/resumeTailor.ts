/**
 * Resume tailoring API service — candidate side.
 *
 *   POST  /candidate/applications/{applicationId}/tailor-resume   start (or return cached) run
 *   PATCH /candidate/resume-tailoring/{runId}                     batch accept/reject
 *   POST  /candidate/resume-tailoring/{runId}/render-pdf          render + signed URL
 *
 * A plain `start` returns the existing run for the application (with saved
 * decisions) — no AI cost. `start(id, true)` regenerates.
 */

import { request } from "../client";
import type {
  TailorDecision,
  TailorHunk,
  TailorRun,
  TailorSegment,
  TailorWordToken,
} from "@/types/jobs";

type Raw = Record<string, unknown>;

function normalizeHunk(raw: Raw): TailorHunk {
  return {
    id: raw.id as string,
    hunkIndex: Number(raw.hunk_index),
    section: (raw.section as string | null) ?? null,
    originalBullet: (raw.original_bullet as string) ?? "",
    rewrittenBullet: (raw.rewritten_bullet as string) ?? "",
    wordDiff: ((raw.word_diff as Raw[]) ?? []).map((t) => ({
      op: t.op as TailorWordToken["op"],
      text: (t.text as string) ?? "",
    })),
    decision: (raw.decision as TailorDecision) ?? "pending",
  };
}

function normalizeRun(raw: Raw): TailorRun {
  return {
    runId: raw.run_id as string,
    applicationId: raw.application_id as string,
    originalText: (raw.original_text as string) ?? "",
    rewrittenText: (raw.rewritten_text as string | null) ?? null,
    finalText: (raw.final_text as string | null) ?? null,
    pdfReady: Boolean(raw.pdf_ready),
    segments: ((raw.segments as Raw[]) ?? []).map((s) =>
      s.kind === "keep"
        ? { kind: "keep", text: (s.text as string) ?? "" }
        : { kind: "hunk", i: Number(s.i) },
    ) as TailorSegment[],
    hunks: ((raw.hunks as Raw[]) ?? []).map(normalizeHunk),
    generatedAt: (raw.generated_at as string) ?? "",
  };
}

export const resumeTailorService = {
  // Plain call returns the existing run (cached, with saved decisions);
  // refresh=true regenerates a fresh run.
  start: (applicationId: string, refresh = false): Promise<TailorRun> =>
    request<Raw>(
      `/candidate/applications/${applicationId}/tailor-resume${refresh ? "?refresh=true" : ""}`,
      { method: "POST" },
    ).then(normalizeRun),

  applyDecisions: (
    runId: string,
    decisions: { hunkId: string; decision: "accepted" | "rejected" }[],
  ): Promise<{ runId: string; finalText: string }> =>
    request<Raw>(`/candidate/resume-tailoring/${runId}`, {
      method: "PATCH",
      body: {
        decisions: decisions.map((d) => ({ hunk_id: d.hunkId, decision: d.decision })),
      },
    }).then((raw) => ({
      runId: raw.run_id as string,
      finalText: (raw.final_text as string) ?? "",
    })),

  renderPdf: (runId: string): Promise<string> =>
    request<Raw>(`/candidate/resume-tailoring/${runId}/render-pdf`, { method: "POST" }).then(
      (raw) => raw.url as string,
    ),
};
