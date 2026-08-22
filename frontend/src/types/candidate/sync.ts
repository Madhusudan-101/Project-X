// ── Types for the unified resume analyzer (POST /api/v1/analyze-resume) ──

export interface ConsistencyAnalysis {
  rating: "Sustained" | "Fragmented" | "Spiky";
  evaluation: string;
}

export interface DsaSkills {
  strong_topics: string[];
  growth_areas: string[];
  algorithmic_depth_summary: string;
}

export interface ProjectRigorEntry {
  repo_name: string;
  inferred_complexity: "Low" | "Medium" | "High" | "Advanced";
  skills_developed: string[];
  analysis: string;
}

export interface CareerAlignment {
  recommended_roles: string[];
  green_flags: string[];
  red_flags: string[];
}

export interface AnalysisResult {
  overall_score: number;
  consistency_analysis: ConsistencyAnalysis;
  dsa_skills: DsaSkills;
  project_rigor: ProjectRigorEntry[];
  career_alignment: CareerAlignment;
  actionable_feedback: string;
}

export interface Discrepancy {
  resume_claim: string;
  portfolio_reality: string;
}

export interface RoleFitAssessment {
  matched_skills: string[];
  missing_skills: string[];
  fit_summary: string;
}

export interface OverallRating {
  score: number;
  verdict: string;
  summary: string;
}

export interface ResumeAnalysisResult {
  detected_discrepancies: Discrepancy[];
  role_fit: RoleFitAssessment;
  strengths: string[];
  weaknesses: string[];
  resume_corrections: string[];
  next_week_action_plan: string[];
  overall_rating: OverallRating;
}

export type MissingPlatform = "github" | "leetcode" | "codeforces";

export interface DetectedProfiles {
  github?: string;
  leetcode?: string;
  codeforces?: string;
}

/** Response of POST /api/v1/analyze-resume — one unified analysis. */
export interface CombinedAnalysisResponse {
  resume_analysis: ResumeAnalysisResult;
  profile_analysis: AnalysisResult | null;
  detected_profiles: DetectedProfiles;
  missing_platforms: MissingPlatform[];
  warnings: string[];
}

/** Tech-only target roles a candidate can pick before running the resume analyzer. */
export const TECH_ROLES = [
  "Software Engineer (SWE / SDE)",
  "AI / ML Engineer",
  "Data Engineer",
  "Data Scientist",
  "Quant Developer",
  "DevOps / SRE / Cloud Engineer",
  "Cybersecurity Engineer",
  "Full-Stack / Frontend Engineer",
] as const;

export type TechRole = (typeof TECH_ROLES)[number];
