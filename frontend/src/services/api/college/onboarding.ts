/**
 * College onboarding — GET / PUT /api/dashboard/onboarding (backend/app/routers/college/onboarding.py).
 *
 * Kept apart from college.ts on purpose: that file holds the services the College Portal pages and
 * the demo share (each one switches to demo data under /demo/college). Onboarding runs once, before the
 * portal, on /auth/college-onboarding — it has no demo counterpart, and request() refuses to run on a
 * demo page anyway.
 */
import { request } from "../client";
import type { CollegeOnboardingInput, CollegeOnboardingState } from "@/types/college/college";

export const collegeOnboardingService = {
  /** What was saved so far, so a refresh or a return visit never starts from a blank form. */
  get: () => request<CollegeOnboardingState>("/api/dashboard/onboarding"),
  /** Saves everything and marks the college onboarded. Safe to repeat: submit again after a failure. */
  save: (payload: CollegeOnboardingInput) =>
    request<CollegeOnboardingState>("/api/dashboard/onboarding", { method: "PUT", body: payload }),
};
