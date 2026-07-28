/**
 * Practice API service — talks to POST /api/practice/:username/recommendations
 */

import { request } from "./client";
import type { PracticeRecommendations } from "@/types/practice";

export const practiceService = {
  getRecommendations: (username: string) =>
    request<PracticeRecommendations>(
      `/api/practice/${encodeURIComponent(username)}/recommendations`,
      { method: "POST" },
    ),
};
