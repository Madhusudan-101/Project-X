// ── Types for the LinkedIn analyzer (POST /api/v1/analyze-linkedin) ──

export interface LinkedInExperienceEntry {
  company: string | null;
  role: string | null;
  duration: string | null;
  description: string | null;
}

export interface LinkedInEducationEntry {
  institution: string | null;
  degree: string | null;
  duration: string | null;
}

export interface CrossCheckFlag {
  field: string;
  linkedin_value: string;
  resume_value: string;
  note: string;
}

export type LinkedInSectionRating = "Strong" | "Needs Work" | "Missing";

/** One rated LinkedIn section (Headline, About, Experience, ...) with click-to-expand detail. */
export interface LinkedInSectionAnalysis {
  section: string;
  present: boolean;
  rating: LinkedInSectionRating;
  current_summary: string;
  gap_reason: string;
  suggestions: string[];
}

/** Response of POST /api/v1/analyze-linkedin. */
export interface LinkedInAnalysisResult {
  is_valid_linkedin_export: boolean;
  invalid_reason: string | null;
  headline: string | null;
  experience: LinkedInExperienceEntry[];
  education: LinkedInEducationEntry[];
  skills: string[];
  certifications: string[];
  sections: LinkedInSectionAnalysis[];
  cross_check_flags: CrossCheckFlag[];
  green_flags: string[];
  red_flags: string[];
  overall_rating_score: number;
  overall_rating_summary: string;
}
