/**
 * LinkedIn analyzer API service.
 * Mirrors sync.ts's analyzeResume — PDF upload, no parser, sent straight to Gemini.
 */

import { request } from "../client";
import type { LinkedInAnalysisResult } from "@/types/candidate/linkedin";

export const linkedinService = {
  /**
   * Upload a LinkedIn "Save to PDF" export and get a profile analysis
   * cross-checked against the candidate's most recent resume analysis (if any).
   */
  analyze: (file: File): Promise<LinkedInAnalysisResult> => {
    const formData = new FormData();
    formData.append("file", file);

    return request<LinkedInAnalysisResult>("/api/v1/analyze-linkedin", {
      method: "POST",
      body: formData,
    });
  },
};
