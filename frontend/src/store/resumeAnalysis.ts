/**
 * Resume analysis Zustand store.
 * Persists the candidate's last resume-analyzer run so other views (e.g. Skill DNA)
 * can derive from it without re-running the analysis or prop-drilling through tabs
 * that unmount when inactive.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ResumeAnalysisResult } from "@/types/sync";

interface ResumeAnalysisState {
  result: ResumeAnalysisResult | null;
  role: string | null;
  setResult: (result: ResumeAnalysisResult, role: string) => void;
  clear: () => void;
}

export const useResumeAnalysisStore = create<ResumeAnalysisState>()(
  persist(
    (set) => ({
      result: null,
      role: null,
      setResult: (result, role) => set({ result, role }),
      clear: () => set({ result: null, role: null }),
    }),
    { name: "mirracle.resumeAnalysis" },
  ),
);
