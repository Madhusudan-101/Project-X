// Types for the College (TPO) Portal — Phase 4.
// Field names mirror the FastAPI response shapes exactly (see backend/app/routers/{students,drives,dashboard,shortlist}.py).

export type VerificationStatus = "pending" | "verified" | "rejected";
export type DriveStatus = "Active" | "Closed" | "Draft";
export type PlacementStatus = "not_placed" | "placed" | "offer_declined";

/** Raw row shape returned by GET /api/students/ and /api/students/{id} (snake_case, unmodified DB columns). */
export interface Student {
  id: string;
  college_id: string;
  name: string;
  email: string;
  branch: string;
  graduation_year: number;
  employability_score: number;
  resume_score: number;
  github_score: number;
  leetcode_score: number;
  interview_score: number;
  assessment_score: number;
  verification_status: VerificationStatus;
  placement_status: PlacementStatus;
  status: StudentAccessStatus;
  blocked_until: string | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  invited_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export type StudentAccessStatus = "active" | "temporarily_blocked" | "restricted";

export type BlockDuration = "1h" | "24h" | "7d" | "30d" | "custom";

export interface StudentBlockInput {
  duration: BlockDuration;
  until?: string;
  reason: string;
}

export interface StudentActionResult {
  message: string;
  student: Student;
  accountRestricted: boolean;
}

export interface StudentOnboardResult {
  message: string;
  collegeName: string;
  plan: string;
  considered: number;
  invited: number;
  skippedBlocked: number;
  skippedInvalidEmail: number;
  skippedAlreadyRegistered: number;
  skippedAlreadyInvited: number;
  failed: number;
}

export interface StudentListFilters {
  branch?: string;
  graduationYear?: number;
  minimumScore?: number;
}

/** Payload for POST /api/students/ (camelCase, mapped to DB columns on the backend). */
export interface StudentCreateInput {
  name: string;
  email: string;
  branch: string;
  graduationYear: number;
}

/** A note about one CSV cell: an optional value that could not be used (unknown status, a score that
 * is not a number or outside 0-100), which is left out of the import — the stored value is kept —
 * rather than silently replaced by a default; or a row that repeats an earlier student and was merged. */
export interface CsvUploadWarning {
  line: number;
  column: string;
  value: string;
  reason?: string;
}

/** An email the file lists more than once. `conflicts` names the columns where the rows disagree. */
export interface CsvUploadDuplicate {
  email: string;
  lines: number[];
  conflicts: string[];
}

/** POST /api/students/upload — also the shape of the ?dryRun=true preview (`dryRun: true`, nothing saved). */
export interface CsvUploadResult {
  message: string;
  /** created + updated: the students written (or, in a preview, that would be). Students already up to
   * date are in `unchanged`, not here — an older server counted every row in the file. */
  addedStudents: number;
  created: number;
  updated: number;
  unchanged: number;
  /** At most the first 20 notes; `warningsTotal` is how many there are in all. */
  warnings: CsvUploadWarning[];
  warningsTotal: number;
  /** Fingerprint of what the import writes. Send it back as `expectedPlan` to import exactly what was previewed. */
  planId: string;
  dryRun: boolean;
  students: Student[];
}

// ── Platform drives and outcomes — GET /api/dashboard/platform (read-only) ──

export type PlatformApplicationStatus =
  "applied" | "scoring" | "scored" | "shortlisted" | "in_interview" | "hired" | "rejected";

export type PlatformRoundStatus = "pending" | "shortlisted" | "rejected";

export interface PlatformRound {
  number: number;
  type: string;
  mode: "ai" | "live";
}

/** A drive a company opened at this college through the platform (live or closed; never a draft). */
export interface PlatformDrive {
  id: string;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  employmentType: string | null;
  status: "live" | "closed";
  isOnCampus: boolean;
  applyDeadline: string | null;
  eligibility: { minCgpa: number | null; branches: string[]; batchYears: number[] };
  rounds: (PlatformRound & { windowStart: string | null; windowEnd: string | null })[];
  /** Counts only students who are on THIS college's roster. */
  funnel: {
    applicants: number;
    inProgress: number;
    shortlisted: number;
    inInterview: number;
    selected: number;
    rejected: number;
  };
}

export interface PlatformApplication {
  driveId: string;
  jobTitle: string | null;
  companyName: string | null;
  status: PlatformApplicationStatus;
  appliedAt: string | null;
  rounds: (PlatformRound & { status: PlatformRoundStatus })[];
}

/** A roster student with at least one platform application. Statuses only — never scores or answers. */
export interface PlatformStudent {
  /** The roster row's id (public.students), not the platform account's. */
  studentId: string;
  name: string;
  email: string;
  branch: string;
  graduationYear: number;
  placementStatus: PlacementStatus | null;
  selectedOnPlatform: boolean;
  /** Selected on the platform while the roster does not say "placed": a prompt to review; never changed automatically. */
  rosterNeedsReview: boolean;
  applications: PlatformApplication[];
}

export interface PlatformOverview {
  drives: PlatformDrive[];
  students: PlatformStudent[];
  studentsOnPlatform: number;
  totals: { applications: number; selected: number; needsRosterUpdate: number };
}

// ── Onboarding — GET / PUT /api/dashboard/onboarding ──

export interface CollegeOnboardingInput {
  website?: string;
  city: string;
  state: string;
  /** One of the listed types, or "Other" together with `customType`. */
  type: string;
  customType?: string;
  designation: string;
  customDesignation?: string;
  phone?: string;
  studentStrength: string;
  departments: string[];
  intents: string[];
  tosAccepted: true;
  dataConsentAccepted: true;
}

/** What has been saved so far. Fields that were never saved are null / empty. */
export interface CollegeOnboardingState {
  college: {
    name: string | null;
    website: string | null;
    city: string | null;
    state: string | null;
    type: string | null;
    customType: string | null;
    studentStrength: string | null;
    onboardingCompleted: boolean;
  };
  contact: {
    designation: string | null;
    customDesignation: string | null;
    phone: string | null;
  } | null;
  departments: string[];
  intents: string[];
  /** Present when the current wording of the terms and the data acknowledgement has been accepted. */
  consent: { tosVersion: string; consentVersion: string; acceptedAt: string | null } | null;
  consentVersions: { tos: string; dataConsent: string };
}

export interface CsvUploadInvalidRow {
  line: number;
  missing: string[];
  row: Record<string, string>;
}

export interface DriveEligibility {
  branch?: string[] | string;
  graduationYear?: number;
  minimumScore?: number;
}

/** Shape returned by GET/POST /api/drives (camelCase, mapped by _drive_to_out on the backend). */
export interface Drive {
  id: string;
  companyName: string;
  role: string;
  eligibility: DriveEligibility;
  date: string;
  status: DriveStatus;
}

export interface DriveCreateInput {
  companyName: string;
  role: string;
  eligibility: DriveEligibility;
  date: string;
  status: DriveStatus;
}

export interface DriveEligibleResponse {
  drive: Drive;
  eligibleStudents: Student[];
}

export interface DashboardStats {
  totalStudents: number;
  averageEmployabilityScore: number;
  activeCompanyDrives: number;
  totalDrives: number;
  draftDrives: number;
  closedDrives: number;
  verifiedStudents: number;
  placedStudents: number;
  notPlacedStudents: number;
  offerDeclinedStudents: number;
  placementPercentage: number;
  activeStudents: number;
  temporarilyBlockedStudents: number;
  restrictedStudents: number;
}

export interface ScoreDistribution {
  "0-20": number;
  "20-40": number;
  "40-60": number;
  "60-80": number;
  "80-100": number;
}

export interface ShortlistFilters {
  branch?: string;
  graduationYear?: number;
  minimumScore?: number;
  verificationStatus?: VerificationStatus;
}

export interface ShortlistResult {
  total: number;
  students: Student[];
}

export interface Department {
  id: string;
  name: string;
  code?: string | null;
  hodName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  studentCount: number;
  avgEmployabilityScore: number;
  placedStudents: number;
  placementRate: number;
}

export interface DepartmentDetail extends Department {
  students: Student[];
}

export interface DepartmentInput {
  name: string;
  code?: string;
  hodName?: string;
}
