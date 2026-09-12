// ── Jobs / Job board / Applications / Job-scoped scoring — TS types ───
// Mirrors backend schemas in backend/app/schemas.py (Jobs section) and
// db/jobs_and_applications_migration.sql. Distinct from types/company/role.ts.

export const JOB_EXPERIENCE_LEVELS = ["fresher", "0-1", "1-3", "3-5", "5+"] as const;
export const JOB_STATUSES = ["draft", "live", "closed"] as const;
export const JOB_VISIBILITIES = ["all", "restricted"] as const;
export const JOB_DOMAINS = ["tech", "non-tech"] as const;
export const JOB_EMPLOYMENT_TYPES = ["full-time", "intern", "contract"] as const;
export const JOB_INTERVIEW_DURATIONS = [30, 60, 90] as const;
export const JOB_INTERVIEW_MODES = ["ai", "live", "both"] as const;
export const DRIVE_STATUSES = ["draft", "live", "closed"] as const;
export const ROUND_TYPES = ["tech", "hr", "managerial", "other"] as const;
export const ROUND_MODES = ["ai", "live"] as const;
export const ROUND_RESULT_STATUSES = ["pending", "shortlisted", "rejected"] as const;

export type JobInterviewMode = (typeof JOB_INTERVIEW_MODES)[number];
export type DriveStatus = (typeof DRIVE_STATUSES)[number];
export type RoundType = (typeof ROUND_TYPES)[number];
export type RoundMode = (typeof ROUND_MODES)[number];
export type RoundResultStatus = (typeof ROUND_RESULT_STATUSES)[number];

export const INTERVIEW_MODE_LABELS: Record<JobInterviewMode, string> = {
  ai: "AI interview",
  live: "Live interview",
  both: "AI + live",
};

export const ROUND_TYPE_LABELS: Record<RoundType, string> = {
  tech: "Technical",
  hr: "HR",
  managerial: "Managerial",
  other: "Other",
};

export const ROUND_MODE_LABELS: Record<RoundMode, string> = {
  ai: "AI",
  live: "Live",
};

export type JobExperienceLevel = (typeof JOB_EXPERIENCE_LEVELS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobVisibility = (typeof JOB_VISIBILITIES)[number];
export type JobDomain = (typeof JOB_DOMAINS)[number];
export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPES)[number];
export type JobInterviewDuration = (typeof JOB_INTERVIEW_DURATIONS)[number];

export const EXPERIENCE_LEVEL_LABELS: Record<JobExperienceLevel, string> = {
  fresher: "Fresher",
  "0-1": "0–1 yr",
  "1-3": "1–3 yr",
  "3-5": "3–5 yr",
  "5+": "5+ yr",
};

export const EMPLOYMENT_TYPE_LABELS: Record<JobEmploymentType, string> = {
  "full-time": "Full-time",
  intern: "Internship",
  contract: "Contract",
};

// Branch codes — mirrors the alias taxonomy in
// backend/app/utils/college/branch.py (stored as text[] in jobs.eligible_branches).
export const BRANCH_OPTIONS = [
  { code: "CSE", label: "Computer Science" },
  { code: "IT", label: "Information Technology" },
  { code: "ECE", label: "Electronics & Communication" },
  { code: "EE", label: "Electrical" },
  { code: "MECH", label: "Mechanical" },
  { code: "CIV", label: "Civil" },
] as const;

export interface ScreeningQuestion {
  id: string;
  questionText: string;
  required: boolean;
  position: number;
}

export interface ScreeningQuestionInput {
  questionText: string;
  required: boolean;
  position: number;
}

export interface JobWeights {
  resumeWeight: number;
  githubWeight: number;
  leetcodeWeight: number;
  interviewWeight: number;
  assessmentWeight: number;
}

export const ZERO_WEIGHTS: JobWeights = {
  resumeWeight: 40,
  githubWeight: 25,
  leetcodeWeight: 15,
  interviewWeight: 10,
  assessmentWeight: 10,
};

export function weightsTotal(w: JobWeights): number {
  return (
    w.resumeWeight + w.githubWeight + w.leetcodeWeight + w.interviewWeight + w.assessmentWeight
  );
}

export interface Job {
  id: string;
  companyId: string;
  title: string;
  description: string;
  domain: JobDomain;
  experienceLevel: JobExperienceLevel;
  location: string;
  openingsCount: number;
  deadline: string; // YYYY-MM-DD
  visibility: JobVisibility;
  status: JobStatus;
  skills: string[];
  visibleCollegeIds: string[];
  weights: JobWeights | null;
  applicationCount: number;
  // Eligibility & offer detail (jobs_eligibility_migration.sql)
  employmentType: JobEmploymentType;
  interviewDurationMinutes: JobInterviewDuration;
  interviewMode: JobInterviewMode;
  isOnCampus: boolean;
  minCgpa: number | null;
  eligibleBranches: string[];
  eligibleBatchYears: number[];
  ctcMin: number | null;
  ctcMax: number | null;
  ctcCurrency: string | null;
  // Internship offer detail (only meaningful when employmentType === "intern")
  stipendMin: number | null;
  stipendMax: number | null;
  internshipDurationMonths: number | null;
  ppoCtcMin: number | null;
  ppoCtcMax: number | null;
  // Perks / benefits — free-form list, any job
  perks: string[];
  screeningQuestions: ScreeningQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface JobCreatePayload {
  title: string;
  description: string;
  domain: JobDomain;
  experienceLevel: JobExperienceLevel;
  location: string;
  openingsCount: number;
  deadline: string;
  visibility: JobVisibility;
  skills: string[];
  visibleCollegeIds: string[];
  weights: JobWeights;
  publish?: boolean;
  // Eligibility & offer detail
  employmentType: JobEmploymentType;
  interviewDurationMinutes: JobInterviewDuration;
  interviewMode: JobInterviewMode;
  isOnCampus: boolean;
  minCgpa?: number | null;
  eligibleBranches?: string[];
  eligibleBatchYears?: number[];
  ctcMin?: number | null;
  ctcMax?: number | null;
  ctcCurrency?: string | null;
  stipendMin?: number | null;
  stipendMax?: number | null;
  internshipDurationMonths?: number | null;
  ppoCtcMin?: number | null;
  ppoCtcMax?: number | null;
  perks?: string[];
  screeningQuestions?: ScreeningQuestionInput[];
}

export type JobUpdatePayload = Partial<JobCreatePayload>;

export interface JobBoardCard {
  id: string;
  title: string;
  companyName: string;
  location: string;
  domain: JobDomain;
  experienceLevel: JobExperienceLevel;
  deadline: string; // = the student's college drive apply_deadline
  summary: string;
  alreadyApplied: boolean;
  employmentType: JobEmploymentType;
  ctcMin: number | null;
  ctcMax: number | null;
  ctcCurrency: string | null;
  isOnCampus: boolean;
  eligible: boolean;
  hasScreeningQuestions: boolean;
}

export interface DriveRound {
  id: string;
  driveId: string;
  roundNumber: number;
  roundType: RoundType;
  mode: RoundMode;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface JobDetail extends JobBoardCard {
  description: string;
  requiredSkills: string[];
  openingsCount: number;
  applicationStatus: ApplicationStatus | null;
  applicationId: string | null;
  interviewMode: JobInterviewMode;
  driveId: string | null;
  applyDeadline: string | null;
  oaWindowStart: string | null;
  oaWindowEnd: string | null;
  rounds: DriveRound[];
  ineligibleReason: string | null;
  stipendMin: number | null;
  stipendMax: number | null;
  internshipDurationMonths: number | null;
  ppoCtcMin: number | null;
  ppoCtcMax: number | null;
  perks: string[];
  screeningQuestions: ScreeningQuestion[];
}

// ── Application draft (cover letter + screener answers) at apply time ──

export interface DraftedScreenerAnswer {
  questionId: string;
  questionText: string;
  required: boolean;
  answer: string;
  studentInputRequired: boolean;
}

export interface ApplicationDraft {
  coverLetter: string;
  screeningAnswers: DraftedScreenerAnswer[];
}

export interface ApplySubmission {
  coverLetter?: string | null;
  screeningAnswers: { questionId: string; answer: string }[];
}

// ── Resume tailoring (diff + PDF) ──────────────────────────────────

export type TailorDecision = "pending" | "accepted" | "rejected";

export interface TailorWordToken {
  op: "equal" | "insert" | "delete";
  text: string;
}

export interface TailorHunk {
  id: string;
  hunkIndex: number;
  section: string | null;
  originalBullet: string;
  rewrittenBullet: string;
  wordDiff: TailorWordToken[];
  decision: TailorDecision;
}

export type TailorSegment = { kind: "keep"; text: string } | { kind: "hunk"; i: number };

export interface TailorRun {
  runId: string;
  applicationId: string;
  originalText: string;
  rewrittenText: string | null;
  finalText: string | null;
  pdfReady: boolean;
  segments: TailorSegment[];
  hunks: TailorHunk[];
  generatedAt: string;
}

export interface CollegeOption {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

export const APPLICATION_STATUSES = [
  "applied",
  "scoring",
  "scored",
  "shortlisted",
  "in_interview",
  "hired",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const COMPANY_SETTABLE_STATUSES: ApplicationStatus[] = [
  "applied",
  "shortlisted",
  "in_interview",
  "hired",
  "rejected",
];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  scoring: "Scoring…",
  scored: "Scored",
  shortlisted: "Shortlisted",
  in_interview: "In interview",
  hired: "Hired",
  rejected: "Not selected",
};

export interface Application {
  id: string;
  studentId: string;
  jobId: string;
  companyId: string;
  status: ApplicationStatus;
  appliedAt: string;
  updatedAt: string;
  jobTitle?: string | null;
  companyName?: string | null;
  placementProbability?: number | null;
  currentRound?: number | null;
  totalRounds?: number | null;
}

export interface ApplicationRoundResult {
  id: string;
  applicationId: string;
  roundId: string;
  roundNumber: number;
  roundType: RoundType;
  mode: RoundMode;
  status: RoundResultStatus;
  roundScore: number | null;
  decidedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface ScoringDimension {
  score: number | null;
  rationale: string;
  evidence: string[];
}

export interface ApplicationAnalysisJson {
  dimensions: {
    resume: ScoringDimension;
    github: ScoringDimension;
    leetcode: ScoringDimension;
    interview: ScoringDimension;
    assessment: ScoringDimension;
  };
  skills_match: { matched: string[]; missing: string[]; coverage_pct: number };
  placement_probability: number;
  recruiter_verdict: { label: string; summary: string; recommendation: string };
}

export interface ApplicationAnalysis {
  id: string;
  applicationId: string;
  studentId: string;
  jobId: string;
  companyId: string;
  analysisJson: ApplicationAnalysisJson;
  placementProbability: number;
  weightedComposite: number;
  weightsSnapshot: {
    resume_weight: number;
    github_weight: number;
    leetcode_weight: number;
    interview_weight: number;
    assessment_weight: number;
  };
  generatedAt: string;
  coverLetter: string | null;
  screeningAnswers: { questionText: string; required: boolean; answer: string | null }[];
}

export interface RankedApplicant {
  applicationId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  status: ApplicationStatus;
  appliedAt: string;
  placementProbability: number | null;
  weightedComposite: number | null;
  hasAnalysis: boolean;
}

// ── Job drives — per (job, college) instances ───────────────────────

export interface JobDrive {
  id: string;
  jobId: string;
  collegeId: string;
  collegeName: string | null;
  status: DriveStatus;
  isOnCampus: boolean;
  applyDeadline: string;
  oaWindowStart: string | null;
  oaWindowEnd: string | null;
  minCgpa: number | null;
  eligibleBranches: string[];
  eligibleBatchYears: number[];
  rounds: DriveRound[];
  applicantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DriveRoundPayload {
  roundNumber: number;
  roundType: RoundType;
  mode: RoundMode;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export interface DrivePayload {
  collegeId: string;
  isOnCampus: boolean;
  applyDeadline: string;
  oaWindowStart?: string | null;
  oaWindowEnd?: string | null;
  minCgpa?: number | null;
  eligibleBranches?: string[] | null;
  eligibleBatchYears?: number[] | null;
  rounds?: DriveRoundPayload[];
}

export type DriveUpdatePayload = Partial<Omit<DrivePayload, "collegeId" | "rounds">>;

export interface DriveClonePayload {
  targetCollegeId: string;
  applyDeadline: string;
  oaWindowStart?: string | null;
  oaWindowEnd?: string | null;
  roundDates: { window_start?: string | null; window_end?: string | null }[];
}

export interface DriveTemplateRound {
  roundNumber: number;
  roundType: RoundType;
  mode: RoundMode;
}

export interface DriveTemplate {
  id: string;
  companyId: string;
  name: string;
  interviewMode: JobInterviewMode | null;
  roundsJson: DriveTemplateRound[];
  defaultMinCgpa: number | null;
  defaultEligibleBranches: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DriveTemplatePayload {
  name: string;
  interviewMode?: JobInterviewMode | null;
  roundsJson: DriveTemplateRound[];
  defaultMinCgpa?: number | null;
  defaultEligibleBranches?: string[] | null;
}

export interface ApplyTemplatePayload {
  templateId: string;
  applyDeadline?: string | null;
  oaWindowStart?: string | null;
  oaWindowEnd?: string | null;
  roundDates: { round_number: number; window_start?: string | null; window_end?: string | null }[];
}

export interface RoundApplicant {
  applicationId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  appliedAt: string;
  roundStatus: RoundResultStatus;
  roundScore: number | null;
  placementProbability: number | null;
  weightedComposite: number | null;
  hasAnalysis: boolean;
  decidedAt: string | null;
}

export interface CompanyFunnel {
  newApplications: number;
  shortlisted: number;
  inInterview: number;
  hired: number;
}

// ── Personalized preparation plan ──────────────────────────────────

export interface PrepPriority {
  title: string;
  why: string;
}

export interface PrepPhase {
  name: string;
  applies: boolean;
  timeframe: string;
  actionItems: string[];
}

export interface PrepPlan {
  applicationId: string;
  headline: string;
  standingSummary: string;
  priorityFocus: PrepPriority;
  phases: PrepPhase[];
  estimatedPrepTime: string;
  generatedAt: string;
}
