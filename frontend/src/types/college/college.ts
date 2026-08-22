// Types for the College (TPO) Portal — Phase 4.
// Field names mirror the FastAPI response shapes exactly (see backend/app/routers/{students,drives,dashboard,shortlist}.py).

export type VerificationStatus = "pending" | "verified" | "rejected";
export type DriveStatus = "Active" | "Closed" | "Draft";

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
  created_at?: string;
  updated_at?: string;
}

export interface StudentListFilters {
  branch?: string;
  graduationYear?: number;
  minimumScore?: number;
}

export interface CsvUploadResult {
  message: string;
  addedStudents: number;
  students: Student[];
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
  verifiedStudents: number;
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
