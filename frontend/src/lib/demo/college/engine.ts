/**
 * Demo Mode engine — the College Portal's backend rules, re-implemented as pure
 * functions over an in-memory DemoState. No network, no auth, no browser APIs.
 *
 * It mirrors the live routers (backend/app/routers/college/*.py) so the UI behaves
 * the same on sample data: same branch aliasing, same eligibility rules, same stat
 * rounding, same CSV columns, same validation messages. Every KPI and chart value
 * is derived from `state.students` / `state.drives` here — never stored.
 *
 * Read functions return deep copies; mutators change the `draft` they are given
 * (the store hands them a clone and commits it afterwards).
 */

import type {
  CsvUploadDuplicate,
  CsvUploadInvalidRow,
  CsvUploadResult,
  CsvUploadWarning,
  DashboardStats,
  Department,
  DepartmentDetail,
  DepartmentInput,
  Drive,
  DriveCreateInput,
  DriveEligibleResponse,
  DriveEligibility,
  PlacementStatus,
  PlatformApplication,
  PlatformDrive,
  PlatformOverview,
  PlatformStudent,
  ScoreDistribution,
  ShortlistFilters,
  ShortlistResult,
  Student,
  StudentActionResult,
  StudentBlockInput,
  StudentCreateInput,
  StudentListFilters,
  StudentOnboardResult,
  VerificationStatus,
} from "@/types/college/college";
import { DEMO_COLLEGE_ID, DEMO_COLLEGE_NAME } from "./mode.ts";
import type { DemoDepartment, DemoState } from "./seed.ts";

// ── Errors (the adapter turns these into the UI's normal error types) ──

export class DemoApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DemoApiError";
    this.status = status;
  }
}

export class DemoCsvError extends DemoApiError {
  readonly invalidRows?: CsvUploadInvalidRow[];
  readonly duplicates?: CsvUploadDuplicate[];
  constructor(
    message: string,
    invalidRows?: CsvUploadInvalidRow[],
    duplicates?: CsvUploadDuplicate[],
  ) {
    super(message, 400);
    this.name = "DemoCsvError";
    this.invalidRows = invalidRows;
    this.duplicates = duplicates;
  }
}

// ── Small helpers ──

const clone = <T>(v: T): T => structuredClone(v);
const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
const nowIso = () => new Date().toISOString();

export const MAX_DEMO_CSV_BYTES = 1024 * 1024; // 1 MB — the live limit is 5 MB; the demo lives in sessionStorage
export const MAX_DEMO_CSV_ROWS = 500;
const MIN_GRADUATION_YEAR = 1950;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLACEMENT_STATUSES: PlacementStatus[] = ["not_placed", "placed", "offer_declined"];
const VERIFICATION_STATUSES: VerificationStatus[] = ["pending", "verified", "rejected"];
const DRIVE_STATUSES = ["Active", "Closed", "Draft"] as const;

// Same alias table as backend/app/utils/college/branch.py.
const BRANCH_ALIASES: Record<string, string> = {
  cse: "computer science",
  cs: "computer science",
  "computer science and engineering": "computer science",
  it: "information technology",
  ece: "electronics and communication",
  electronics: "electronics and communication",
  "e&c": "electronics and communication",
  ee: "electrical",
  eee: "electrical",
  mech: "mechanical",
  civ: "civil",
};

export function normalizeBranch(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const key = String(value).toLowerCase().trim();
  return BRANCH_ALIASES[key] ?? key;
}

export function branchMatches(
  studentBranch: string | null | undefined,
  allowed: string[],
): boolean {
  const sb = normalizeBranch(studentBranch);
  if (!sb || allowed.length === 0) return allowed.length === 0;
  return allowed.some((a) => {
    const an = normalizeBranch(a);
    return an !== "" && (sb === an || sb.includes(an) || an.includes(sb));
  });
}

const byBranchNeedle = (rows: Student[], branch?: string) => {
  const needle = normalizeBranch(branch);
  return branch && needle ? rows.filter((r) => normalizeBranch(r.branch).includes(needle)) : rows;
};

function requireText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new DemoApiError(`${label} is required.`, 422);
  return text;
}

function checkGraduationYear(year: unknown): number {
  const max = new Date().getFullYear() + 10;
  if (!Number.isInteger(year) || (year as number) < MIN_GRADUATION_YEAR || (year as number) > max) {
    throw new DemoApiError(
      `graduationYear must be between ${MIN_GRADUATION_YEAR} and ${max}.`,
      422,
    );
  }
  return year as number;
}

function checkEmail(email: unknown): string {
  const text = typeof email === "string" ? email.trim() : "";
  if (!EMAIL_RE.test(text)) throw new DemoApiError("Enter a valid email address.", 422);
  return text.toLowerCase();
}

function findStudent(state: DemoState, id: string): Student {
  const row = state.students.find((s) => s.id === id);
  if (!row) throw new DemoApiError("Student not found", 404);
  return row;
}

// ── Students ──

export function listStudents(state: DemoState, f: StudentListFilters = {}): Student[] {
  let rows = state.students;
  if (f.graduationYear !== undefined)
    rows = rows.filter((s) => s.graduation_year === f.graduationYear);
  if (f.minimumScore !== undefined)
    rows = rows.filter((s) => s.employability_score >= f.minimumScore!);
  return clone(byBranchNeedle(rows, f.branch));
}

export function getStudent(state: DemoState, id: string): Student {
  return clone(findStudent(state, id));
}

export function createStudent(draft: DemoState, input: StudentCreateInput) {
  const email = checkEmail(input.email);
  const row: Student = {
    id: newId("demo-stu"),
    college_id: DEMO_COLLEGE_ID,
    name: requireText(input.name, "name"),
    email,
    branch: requireText(input.branch, "branch"),
    graduation_year: checkGraduationYear(input.graduationYear),
    employability_score: 0,
    resume_score: 0,
    github_score: 0,
    leetcode_score: 0,
    interview_score: 0,
    assessment_score: 0,
    verification_status: "pending",
    placement_status: "not_placed",
    status: "active",
    blocked_until: null,
    blocked_reason: null,
    blocked_at: null,
    invited_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (draft.students.some((s) => s.email === email)) {
    throw new DemoApiError("A student with this email already exists.", 409);
  }
  draft.students.push(row);
  return { message: "Student added successfully", student: clone(row) };
}

export function updateStudent(
  draft: DemoState,
  id: string,
  patch: Partial<StudentCreateInput> & { placementStatus?: PlacementStatus },
) {
  const row = findStudent(draft, id);
  if (patch.email !== undefined) {
    const email = checkEmail(patch.email);
    if (draft.students.some((s) => s.id !== id && s.email === email)) {
      throw new DemoApiError("A student with this email already exists.", 409);
    }
    row.email = email;
  }
  if (patch.name !== undefined) row.name = requireText(patch.name, "name");
  if (patch.branch !== undefined) row.branch = requireText(patch.branch, "branch");
  if (patch.graduationYear !== undefined)
    row.graduation_year = checkGraduationYear(patch.graduationYear);
  if (patch.placementStatus !== undefined) {
    if (!PLACEMENT_STATUSES.includes(patch.placementStatus)) {
      throw new DemoApiError(
        `placementStatus must be one of ${PLACEMENT_STATUSES.join(", ")}`,
        422,
      );
    }
    row.placement_status = patch.placementStatus;
  }
  row.updated_at = nowIso();
  return { message: "Student updated successfully", student: clone(row) };
}

export function removeStudent(draft: DemoState, id: string) {
  findStudent(draft, id);
  draft.students = draft.students.filter((s) => s.id !== id);
  return { message: "Student deleted successfully" };
}

export function bulkUpdatePlacement(draft: DemoState, ids: string[], status: PlacementStatus) {
  if (!ids.length) throw new DemoApiError("studentIds must contain at least one id", 422);
  if (!PLACEMENT_STATUSES.includes(status)) {
    throw new DemoApiError(`placementStatus must be one of ${PLACEMENT_STATUSES.join(", ")}`, 422);
  }
  const wanted = new Set(ids);
  let updatedCount = 0;
  for (const s of draft.students) {
    if (wanted.has(s.id)) {
      s.placement_status = status;
      s.updated_at = nowIso();
      updatedCount += 1;
    }
  }
  return {
    message: `Updated placement status for ${updatedCount} student${updatedCount === 1 ? "" : "s"}`,
    updatedCount,
  };
}

const BLOCK_DURATIONS_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

function blockUntil(input: StudentBlockInput): string {
  if (input.duration === "custom") {
    const until = input.until ? new Date(input.until) : null;
    if (!until || Number.isNaN(until.getTime()))
      throw new DemoApiError("'until' must be an ISO 8601 instant.", 422);
    const delta = until.getTime() - Date.now();
    if (delta <= 0) throw new DemoApiError("'until' must be in the future.", 422);
    if (delta > 3650 * 86_400_000)
      throw new DemoApiError("A custom block cannot be more than 10 years.", 422);
    return until.toISOString();
  }
  const ms = BLOCK_DURATIONS_MS[input.duration];
  if (!ms) throw new DemoApiError("Invalid block duration.", 422);
  return new Date(Date.now() + ms).toISOString();
}

function checkReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text || text.length > 500)
    throw new DemoApiError("A reason (1–500 characters) is required.", 422);
  return text;
}

export function blockStudent(
  draft: DemoState,
  id: string,
  input: StudentBlockInput,
): StudentActionResult {
  const row = findStudent(draft, id);
  const until = blockUntil(input);
  Object.assign(row, {
    status: "temporarily_blocked",
    blocked_until: until,
    blocked_reason: checkReason(input.reason),
    blocked_at: nowIso(),
    updated_at: nowIso(),
  });
  return { message: "Student temporarily blocked.", student: clone(row), accountRestricted: false };
}

export function restrictStudent(draft: DemoState, id: string, reason: string): StudentActionResult {
  const row = findStudent(draft, id);
  Object.assign(row, {
    status: "restricted",
    blocked_until: null,
    blocked_reason: checkReason(reason),
    blocked_at: nowIso(),
    updated_at: nowIso(),
  });
  return { message: "Student restricted.", student: clone(row), accountRestricted: false };
}

export function unblockStudent(draft: DemoState, id: string): StudentActionResult {
  const row = findStudent(draft, id);
  Object.assign(row, {
    status: "active",
    blocked_until: null,
    blocked_reason: null,
    blocked_at: null,
    updated_at: nowIso(),
  });
  return { message: "Student access restored.", student: clone(row), accountRestricted: false };
}

/**
 * The live endpoint emails onboarding invites. Demo Mode has no mail path at all, so
 * this changes nothing and says so: every counter is zero and nothing is marked invited.
 */
export function onboardStudents(state: DemoState, ids?: string[]): StudentOnboardResult {
  const considered = ids
    ? state.students.filter((s) => ids.includes(s.id)).length
    : state.students.length;
  return {
    message: "Onboarding invites are not sent in Demo Mode.",
    collegeName: DEMO_COLLEGE_NAME,
    plan: "demo",
    considered,
    invited: 0,
    skippedBlocked: 0,
    skippedInvalidEmail: 0,
    skippedAlreadyRegistered: 0,
    skippedAlreadyInvited: 0,
    failed: 0,
  };
}

// ── Shortlist ──

export function shortlist(state: DemoState, f: ShortlistFilters = {}): ShortlistResult {
  let rows = state.students;
  if (f.graduationYear !== undefined)
    rows = rows.filter((s) => s.graduation_year === f.graduationYear);
  if (f.minimumScore !== undefined)
    rows = rows.filter((s) => s.employability_score >= f.minimumScore!);
  if (f.verificationStatus) {
    const want = f.verificationStatus.toLowerCase();
    rows = rows.filter((s) => s.verification_status === want);
  }
  rows = byBranchNeedle(rows, f.branch);
  return { total: rows.length, students: clone(rows) };
}

// ── Dashboard ──

export function dashboardStats(state: DemoState): DashboardStats {
  const { students, drives } = state;
  const total = students.length;
  const totalScore = students.reduce((sum, s) => sum + (s.employability_score || 0), 0);
  const count = (pred: (s: Student) => boolean) => students.filter(pred).length;
  const placed = count((s) => s.placement_status === "placed");
  const driveCount = (status: string) => drives.filter((d) => d.status === status).length;
  return {
    totalStudents: total,
    averageEmployabilityScore: total ? roundTo(totalScore / total, 2) : 0,
    activeCompanyDrives: driveCount("Active"),
    totalDrives: drives.length,
    draftDrives: driveCount("Draft"),
    closedDrives: driveCount("Closed"),
    verifiedStudents: count((s) => s.verification_status === "verified"),
    placedStudents: placed,
    notPlacedStudents: count((s) => s.placement_status === "not_placed"),
    offerDeclinedStudents: count((s) => s.placement_status === "offer_declined"),
    placementPercentage: total ? roundTo((placed / total) * 100, 1) : 0,
    activeStudents: count((s) => (s.status || "active") === "active"),
    temporarilyBlockedStudents: count((s) => s.status === "temporarily_blocked"),
    restrictedStudents: count((s) => s.status === "restricted"),
  };
}

export function scoreDistribution(state: DemoState): ScoreDistribution {
  const buckets: ScoreDistribution = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
  for (const s of state.students) {
    const score = s.employability_score || 0;
    if (score < 20) buckets["0-20"] += 1;
    else if (score < 40) buckets["20-40"] += 1;
    else if (score < 60) buckets["40-60"] += 1;
    else if (score < 80) buckets["60-80"] += 1;
    else buckets["80-100"] += 1;
  }
  return buckets;
}

// ── Drives ──

function cleanEligibility(e: DriveEligibility | undefined): DriveEligibility {
  const out: DriveEligibility = {};
  if (e?.branch !== undefined && e.branch !== null && e.branch !== "") {
    out.branch = Array.isArray(e.branch) ? e.branch : [e.branch];
  }
  if (e?.graduationYear !== undefined && e.graduationYear !== null)
    out.graduationYear = Number(e.graduationYear);
  if (e?.minimumScore !== undefined && e.minimumScore !== null)
    out.minimumScore = Number(e.minimumScore);
  return out;
}

function checkDriveDate(date: unknown): string {
  const text = typeof date === "string" ? date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) {
    throw new DemoApiError("date must be a valid YYYY-MM-DD date.", 422);
  }
  return text;
}

function checkDriveStatus(status: unknown): Drive["status"] {
  if (!DRIVE_STATUSES.includes(status as Drive["status"])) {
    throw new DemoApiError(`status must be one of ${DRIVE_STATUSES.join(", ")}.`, 422);
  }
  return status as Drive["status"];
}

export function listDrives(state: DemoState): Drive[] {
  return clone([...state.drives].sort((a, b) => a.date.localeCompare(b.date)));
}

export function createDrive(draft: DemoState, input: DriveCreateInput) {
  const row: Drive = {
    id: newId("demo-drive"),
    companyName: requireText(input.companyName, "companyName"),
    role: requireText(input.role, "role"),
    eligibility: cleanEligibility(input.eligibility),
    date: checkDriveDate(input.date),
    status: checkDriveStatus(input.status ?? "Active"),
  };
  draft.drives.push(row);
  return { message: "Company drive created successfully", drive: clone(row) };
}

export function updateDrive(draft: DemoState, id: string, patch: Partial<DriveCreateInput>) {
  const row = draft.drives.find((d) => d.id === id);
  if (!row) throw new DemoApiError("Drive not found", 404);
  if (patch.companyName !== undefined)
    row.companyName = requireText(patch.companyName, "companyName");
  if (patch.role !== undefined) row.role = requireText(patch.role, "role");
  if (patch.eligibility !== undefined) row.eligibility = cleanEligibility(patch.eligibility);
  if (patch.date !== undefined) row.date = checkDriveDate(patch.date);
  if (patch.status !== undefined) row.status = checkDriveStatus(patch.status);
  return { message: "Company drive updated successfully", drive: clone(row) };
}

export function removeDrive(draft: DemoState, id: string) {
  if (!draft.drives.some((d) => d.id === id)) throw new DemoApiError("Drive not found", 404);
  draft.drives = draft.drives.filter((d) => d.id !== id);
  return { message: "Company drive deleted successfully" };
}

export function eligibleStudents(state: DemoState, driveId: string): DriveEligibleResponse {
  const drive = state.drives.find((d) => d.id === driveId);
  if (!drive) throw new DemoApiError("Drive not found", 404);
  const e = drive.eligibility ?? {};
  let rows = state.students;
  if (e.graduationYear !== undefined && e.graduationYear !== null) {
    rows = rows.filter((s) => s.graduation_year === Number(e.graduationYear));
  }
  if (e.minimumScore !== undefined && e.minimumScore !== null) {
    rows = rows.filter((s) => s.employability_score >= Number(e.minimumScore));
  }
  const allowed = e.branch ? (Array.isArray(e.branch) ? e.branch : [e.branch]) : [];
  if (allowed.length) rows = rows.filter((s) => branchMatches(s.branch, allowed));
  return { drive: clone(drive), eligibleStudents: clone(rows) };
}

// ── Departments ──

const departmentMatches = (studentBranch: string, dept: DemoDepartment) => {
  const sb = normalizeBranch(studentBranch);
  if (!sb) return false;
  if (dept.code && normalizeBranch(dept.code) === sb) return true;
  return normalizeBranch(dept.name) === sb;
};

function withStats(dept: DemoDepartment, students: Student[]): Department {
  const matched = students.filter((s) => departmentMatches(s.branch, dept));
  const total = matched.length;
  const placed = matched.filter((s) => s.placement_status === "placed").length;
  const avg = total
    ? roundTo(matched.reduce((sum, s) => sum + (s.employability_score || 0), 0) / total, 2)
    : 0;
  return {
    ...dept,
    studentCount: total,
    avgEmployabilityScore: avg,
    placedStudents: placed,
    placementRate: total ? roundTo((placed / total) * 100, 1) : 0,
  };
}

export function listDepartments(state: DemoState): Department[] {
  return clone(
    [...state.departments]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => withStats(d, state.students)),
  );
}

export function getDepartment(state: DemoState, id: string): DepartmentDetail {
  const dept = state.departments.find((d) => d.id === id);
  if (!dept) throw new DemoApiError("Department not found", 404);
  return clone({
    ...withStats(dept, state.students),
    students: state.students.filter((s) => departmentMatches(s.branch, dept)),
  });
}

function assertUniqueDepartment(draft: DemoState, name: string, selfId?: string) {
  if (
    draft.departments.some(
      (d) => d.id !== selfId && d.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new DemoApiError("A department with this name already exists.", 409);
  }
}

export function createDepartment(draft: DemoState, input: DepartmentInput) {
  const name = requireText(input.name, "name");
  assertUniqueDepartment(draft, name);
  const row: DemoDepartment = {
    id: newId("demo-dept"),
    name,
    code: input.code?.trim() || null,
    hodName: input.hodName?.trim() || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  draft.departments.push(row);
  return {
    message: "Department created successfully",
    department: withStats(clone(row), draft.students),
  };
}

export function updateDepartment(draft: DemoState, id: string, patch: Partial<DepartmentInput>) {
  const row = draft.departments.find((d) => d.id === id);
  if (!row) throw new DemoApiError("Department not found", 404);
  if (patch.name !== undefined) {
    const name = requireText(patch.name, "name");
    assertUniqueDepartment(draft, name, id);
    row.name = name;
  }
  if (patch.code !== undefined) row.code = patch.code.trim() || null;
  if (patch.hodName !== undefined) row.hodName = patch.hodName.trim() || null;
  row.updatedAt = nowIso();
  return {
    message: "Department updated successfully",
    department: withStats(clone(row), draft.students),
  };
}

export function removeDepartment(draft: DemoState, id: string) {
  if (!draft.departments.some((d) => d.id === id))
    throw new DemoApiError("Department not found", 404);
  draft.departments = draft.departments.filter((d) => d.id !== id);
  return { message: "Department deleted successfully" };
}

// ── CSV ──

/** Neutralise spreadsheet formula injection ( = + - @ ) and quote when needed. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns: [keyof Student, string][], rows: Student[]): string {
  const lines = [columns.map(([, header]) => header).join(",")];
  for (const r of rows) lines.push(columns.map(([key]) => csvCell(r[key])).join(","));
  return `${lines.join("\n")}\n`;
}

// Same columns as GET /api/students/export and GET /api/shortlist/export.
const ROSTER_COLUMNS: [keyof Student, string][] = [
  ["name", "name"],
  ["email", "email"],
  ["branch", "branch"],
  ["graduation_year", "graduationYear"],
  ["employability_score", "employabilityScore"],
  ["resume_score", "resumeScore"],
  ["github_score", "githubScore"],
  ["leetcode_score", "leetcodeScore"],
  ["interview_score", "interviewScore"],
  ["assessment_score", "assessmentScore"],
  ["verification_status", "verificationStatus"],
  ["placement_status", "placementStatus"],
];
const SHORTLIST_COLUMNS: [keyof Student, string][] = [
  ["name", "name"],
  ["email", "email"],
  ["branch", "branch"],
  ["graduation_year", "graduationYear"],
  ["employability_score", "employabilityScore"],
  ["verification_status", "verificationStatus"],
];

export function exportStudentsCsv(
  state: DemoState,
  f: StudentListFilters & { placementStatus?: PlacementStatus } = {},
): string {
  let rows = listStudents(state, f);
  if (f.placementStatus) rows = rows.filter((s) => s.placement_status === f.placementStatus);
  return toCsv(ROSTER_COLUMNS, rows);
}

export function exportShortlistCsv(state: DemoState, f: ShortlistFilters = {}): string {
  return toCsv(SHORTLIST_COLUMNS, shortlist(state, f).students);
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ── Roster CSV import ──
// The rules below are the ones backend/app/utils/college/csv_students.py applies to a real upload, so
// a file behaves the same in the demo as against the live API (the demo only adds its size limits).

const CSV_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const YEAR_RE = /^\d{1,4}(\.0+)?$/;
const CSV_MIN_YEAR = 1950;
const CSV_MAX_YEAR = 2100;

/** Column name in the file for each Student field a CSV row can carry (used to name conflicts). */
const COLUMN_FOR_FIELD: Partial<Record<keyof Student, string>> = {
  name: "name",
  email: "email",
  branch: "branch",
  graduation_year: "graduationYear",
  verification_status: "verificationStatus",
  placement_status: "placementStatus",
  employability_score: "employabilityScore",
  resume_score: "resumeScore",
  github_score: "githubScore",
  leetcode_score: "leetcodeScore",
  interview_score: "interviewScore",
  assessment_score: "assessmentScore",
};

const NUMERIC_COLUMNS = [
  ["employabilityScore", "employability_score"],
  ["resumeScore", "resume_score"],
  ["githubScore", "github_score"],
  ["leetcodeScore", "leetcode_score"],
  ["interviewScore", "interview_score"],
  ["assessmentScore", "assessment_score"],
] as const;

/**
 * A score cell as a number from 0 to 100 rounded half-up to two decimals (what the numeric(5,2) column
 * stores), or the reason it cannot be used. Rounds the decimal TEXT, not a float: 77.455 must give
 * 77.46 exactly as PostgreSQL does, and float rounding gives 77.45.
 */
function parseScore(cell: string): { value: number } | { reason: string } {
  if (!NUMBER_RE.test(cell)) return { reason: "not a number" };
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(cell)!;
  const negative = m[1] === "-";
  const frac = m[3] ?? "";
  const digits = BigInt((m[2] + frac).replace(/^0+(?=\d)/, "") || "0");
  const exp = Number(m[4] ?? 0);
  if (digits === 0n) return { value: 0 };
  if (exp > 1000) return { reason: "outside 0-100" };
  if (exp < -1000) return { value: 0 };
  const scale = exp - frac.length + 2; // the value in hundredths is digits * 10^scale
  let hundredths: bigint;
  if (scale >= 0) hundredths = digits * 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    hundredths = digits / divisor + ((digits % divisor) * 2n >= divisor ? 1n : 0n);
  }
  if (negative && hundredths > 0n) return { reason: "outside 0-100" };
  if (hundredths > 10000n) return { reason: "outside 0-100" };
  return { value: Number(hundredths) / 100 };
}

/** FNV-1a: a small, stable, dependency-free hash. Not for security. */
function fnv32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Short stable fingerprint of what an import would write — the demo's counterpart of the live planId. */
const fingerprint = (text: string): string => `demo-${fnv32(text).toString(16).padStart(8, "0")}`;

export interface UploadOptions {
  /** Check only: compute the counts and the plan, change nothing. */
  dryRun?: boolean;
  /** planId from the preview. A real import is refused (409, nothing written) when the plan has since changed. */
  expectedPlan?: string;
}

type CsvPatch = Partial<Student>;

/**
 * Mirrors backend parse + upload route. Throws DemoCsvError listing rejected rows or conflicting repeats.
 *
 * Non-destructive, like the live import: a row carries only the columns the file supplies with a
 * usable value. A blank cell, a missing column or an unusable value leaves a stored student's field
 * alone (and a new student gets the shell defaults). A repeated email that supplies two different values
 * for a field is refused; agreeing repeats merge. With `dryRun` the same comparison runs and the counts
 * and planId are returned, but `draft` is not touched.
 */
export function uploadStudentsCsv(
  draft: DemoState,
  text: string,
  options: UploadOptions = {},
): CsvUploadResult {
  const dryRun = options.dryRun === true;
  if (text.length > MAX_DEMO_CSV_BYTES)
    throw new DemoApiError("CSV too large for the demo (max 1 MB)", 413);
  const [header, ...body] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header) throw new DemoApiError("CSV contained no rows", 400);
  if (body.length > MAX_DEMO_CSV_ROWS) {
    throw new DemoApiError(`The demo accepts up to ${MAX_DEMO_CSV_ROWS} rows per upload.`, 413);
  }
  const cols = header.map((h) => h.trim());
  const repeated = [...new Set(cols.filter((c, i) => c && cols.indexOf(c) !== i))];
  if (repeated.length) {
    throw new DemoApiError(
      `Each column may appear only once, but this file repeats: ${repeated.sort().join(", ")}.`,
      400,
    );
  }
  const invalid: CsvUploadInvalidRow[] = [];
  const warnings: CsvUploadWarning[] = [];
  const rows: { line: number; email: string; patch: CsvPatch }[] = [];

  body.forEach((cells, idx) => {
    const line = idx + 2;
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()));
    if (!Object.values(row).some((v) => v)) return; // a row with nothing in it (",,,," from a spreadsheet)

    const bad = ["name", "email", "branch", "graduationYear"].filter((f) => !row[f]);
    if (!bad.length) {
      for (const f of ["name", "email", "branch"]) if (row[f].includes("\0")) bad.push(f);
      if (!bad.includes("email") && !CSV_EMAIL_RE.test(row.email)) bad.push("email");
      if (!YEAR_RE.test(row.graduationYear)) bad.push("graduationYear");
      else {
        const y = Number(row.graduationYear.split(".")[0]);
        if (y < CSV_MIN_YEAR || y > CSV_MAX_YEAR) bad.push("graduationYear");
      }
    }
    // Validate everything up front: an upload either applies completely or not at all.
    if (bad.length) {
      invalid.push({ line, missing: bad, row });
      return;
    }

    const patch: CsvPatch = {
      name: row.name,
      branch: row.branch,
      graduation_year: Number(row.graduationYear.split(".")[0]),
    };
    for (const [column, field] of NUMERIC_COLUMNS) {
      if (!row[column]) continue;
      const score = parseScore(row[column]);
      if ("value" in score) patch[field] = score.value;
      else warnings.push({ line, column, value: row[column], reason: score.reason });
    }
    // A column that is not in the file's header is undefined here, not blank.
    const verification = row.verificationStatus;
    if (verification) {
      const value = verification.toLowerCase() as VerificationStatus;
      if (VERIFICATION_STATUSES.includes(value)) patch.verification_status = value;
      else
        warnings.push({
          line,
          column: "verificationStatus",
          value: verification,
          reason: `must be one of ${[...VERIFICATION_STATUSES].sort().join(", ")}`,
        });
    }
    const placement = row.placementStatus;
    if (placement) {
      const value = placement.toLowerCase() as PlacementStatus;
      if (PLACEMENT_STATUSES.includes(value)) patch.placement_status = value;
      else
        warnings.push({
          line,
          column: "placementStatus",
          value: placement,
          reason: `must be one of ${[...PLACEMENT_STATUSES].sort().join(", ")}`,
        });
    }
    rows.push({ line, email: row.email.toLowerCase(), patch });
  });

  if (invalid.length) {
    throw new DemoCsvError("CSV file has missing or invalid required fields", invalid.slice(0, 20));
  }
  if (!rows.length) throw new DemoApiError("CSV contained no rows", 400);

  // One row per email: agreeing repeats merge (a blank never erases), conflicting ones are refused.
  const merged = new Map<string, CsvPatch>();
  const repeats = new Map<string, CsvUploadDuplicate>();
  for (const { line, email, patch } of rows) {
    const have = merged.get(email);
    if (!have) {
      merged.set(email, { ...patch });
      repeats.set(email, { email, lines: [line], conflicts: [] });
      continue;
    }
    const report = repeats.get(email)!;
    report.lines.push(line);
    for (const key of Object.keys(patch) as (keyof Student)[]) {
      if (key in have && have[key] !== patch[key]) {
        const column = COLUMN_FOR_FIELD[key] ?? String(key);
        if (!report.conflicts.includes(column)) report.conflicts.push(column);
      } else (have as Record<string, unknown>)[key] = patch[key];
    }
  }
  const duplicates = [...repeats.values()].filter((d) => d.lines.length > 1);
  const conflicts = duplicates.filter((d) => d.conflicts.length);
  if (conflicts.length) {
    throw new DemoCsvError(
      "CSV file repeats an email with different values — fix it so each student appears once",
      undefined,
      conflicts.slice(0, 20),
    );
  }
  for (const d of duplicates) {
    warnings.push({
      line: d.lines[d.lines.length - 1],
      column: "email",
      value: d.email,
      reason: `repeats line ${d.lines[0]} with the same values — counted once`,
    });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const plan: unknown[] = [];
  const writes: { email: string; at: number; patch: CsvPatch }[] = [];
  for (const [email, patch] of [...merged].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const at = draft.students.findIndex((s) => s.email === email);
    if (at < 0) {
      created += 1;
      plan.push([email, "created", Object.entries(patch).sort()]);
      writes.push({ email, at, patch });
      continue;
    }
    // Only fields that differ are written, so a value the file merely repeats cannot revert a newer edit.
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => draft.students[at][k as keyof Student] !== v),
    ) as CsvPatch;
    if (!Object.keys(changed).length) {
      unchanged += 1;
      plan.push([email, "unchanged"]);
    } else {
      updated += 1;
      plan.push([email, "updated", Object.entries(changed).sort()]);
      writes.push({ email, at, patch: changed });
    }
  }
  const planId = fingerprint(JSON.stringify(plan));

  if (!dryRun && options.expectedPlan !== undefined && options.expectedPlan !== planId) {
    throw new DemoApiError(
      "The file or the roster has changed since the preview, so nothing was imported. Check the file again to see the current result.",
      409,
    );
  }

  const written: Student[] = [];
  if (!dryRun) {
    for (const { email, at, patch } of writes) {
      if (at < 0) {
        const row = { ...createStudentShell(draft, email), ...patch, updated_at: nowIso() };
        draft.students.push(row);
        written.push(row);
      } else {
        draft.students[at] = { ...draft.students[at], ...patch, updated_at: nowIso() };
        written.push(draft.students[at]);
      }
    }
  }
  return {
    message: dryRun ? "Preview only — nothing was saved." : "Students uploaded successfully",
    addedStudents: created + updated,
    created,
    updated,
    unchanged,
    warnings: warnings.slice(0, 20),
    warningsTotal: warnings.length,
    planId,
    dryRun,
    students: clone(written),
  };
}

function createStudentShell(draft: DemoState, email: string): Student {
  return {
    id: newId("demo-stu"),
    college_id: DEMO_COLLEGE_ID,
    name: "",
    email,
    branch: "",
    graduation_year: 0,
    employability_score: 0,
    resume_score: 0,
    github_score: 0,
    leetcode_score: 0,
    interview_score: 0,
    assessment_score: 0,
    verification_status: "pending",
    placement_status: "not_placed",
    status: "active",
    blocked_until: null,
    blocked_reason: null,
    blocked_at: null,
    invited_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

// ── Platform drives & outcomes (the demo's counterpart of GET /api/dashboard/platform) ──
//
// Fictional companies, fictional drives, and applications derived deterministically from the sample
// roster, so the same student always has the same outcomes and a roster edit is reflected. Nothing here
// is stored: it is recomputed from `state.students` on every call, so a preview/confirm never needs it.

const DEMO_PLATFORM_DRIVES: {
  id: string;
  companyName: string;
  jobTitle: string;
  location: string;
  employmentType: string;
  status: "live" | "closed";
  isOnCampus: boolean;
  deadlineDays: number;
  minCgpa: number | null;
  rounds: { type: string; mode: "ai" | "live" }[];
}[] = [
  {
    id: "demo-pdrive-1",
    companyName: "Meridian Systems (sample)",
    jobTitle: "Associate Software Engineer",
    location: "Bengaluru",
    employmentType: "full-time",
    status: "live",
    isOnCampus: true,
    deadlineDays: 14,
    minCgpa: 7,
    rounds: [
      { type: "tech", mode: "ai" },
      { type: "hr", mode: "live" },
    ],
  },
  {
    id: "demo-pdrive-2",
    companyName: "Lumen Analytics (sample)",
    jobTitle: "Data Analyst",
    location: "Remote",
    employmentType: "full-time",
    status: "live",
    isOnCampus: false,
    deadlineDays: 30,
    minCgpa: null,
    rounds: [{ type: "tech", mode: "ai" }],
  },
  {
    id: "demo-pdrive-3",
    companyName: "Harbor & Co (sample)",
    jobTitle: "Graduate Trainee",
    location: "Pune",
    employmentType: "internship",
    status: "closed",
    isOnCampus: true,
    deadlineDays: -20,
    minCgpa: 6.5,
    rounds: [
      { type: "tech", mode: "ai" },
      { type: "hr", mode: "live" },
    ],
  },
];

const FUNNEL_BY_HASH: PlatformApplication["status"][] = [
  "applied",
  "applied",
  "applied",
  "applied",
  "shortlisted",
  "shortlisted",
  "in_interview",
  "hired",
  "rejected",
  "rejected",
  "rejected",
  "rejected",
];

/** How far a round-by-round status has got, for a given overall application status. */
function demoRoundStatuses(status: PlatformApplication["status"], rounds: number) {
  const out: ("pending" | "shortlisted" | "rejected")[] = Array(rounds).fill("pending");
  const passed =
    status === "hired" ? rounds : status === "in_interview" ? 1 : status === "shortlisted" ? 1 : 0;
  for (let i = 0; i < Math.min(passed, rounds); i++) out[i] = "shortlisted";
  if (status === "rejected") out[0] = "rejected";
  return out;
}

export function platformOverview(state: DemoState): PlatformOverview {
  // Anchor the sample dates on the roster itself (its rows were created ~120 days before "today").
  const base = Date.parse(state.students[0]?.created_at ?? "") + 120 * 86_400_000;
  const anchor = Number.isFinite(base) ? base : Date.UTC(2026, 9, 11);
  const iso = (days: number) => new Date(anchor + days * 86_400_000).toISOString();

  const applicationsByStudent = new Map<string, PlatformApplication[]>();
  for (const s of state.students) {
    if (s.status !== "active") continue;
    const h = fnv32(s.id);
    DEMO_PLATFORM_DRIVES.forEach((d, k) => {
      // about a third of the roster applies to each drive; placed students tend to have been selected
      if ((h >>> (k * 3)) % 3 !== 0) return;
      const pick = FUNNEL_BY_HASH[(h >>> (k * 5 + 1)) % FUNNEL_BY_HASH.length];
      const status =
        d.status === "closed" && (pick === "applied" || pick === "in_interview")
          ? s.placement_status === "placed" && h % 3 === 0
            ? "hired"
            : "rejected"
          : pick;
      const statuses = demoRoundStatuses(status, d.rounds.length);
      const list = applicationsByStudent.get(s.id) ?? [];
      list.push({
        driveId: d.id,
        jobTitle: d.jobTitle,
        companyName: d.companyName,
        status,
        appliedAt: iso(d.deadlineDays - 10 - (h % 5)),
        rounds: d.rounds.map((r, i) => ({
          number: i + 1,
          type: r.type,
          mode: r.mode,
          status: statuses[i],
        })),
      });
      applicationsByStudent.set(s.id, list);
    });
  }

  const drives: PlatformDrive[] = DEMO_PLATFORM_DRIVES.map((d) => {
    const its = [...applicationsByStudent.values()].flat().filter((a) => a.driveId === d.id);
    const count = (...st: string[]) => its.filter((a) => st.includes(a.status)).length;
    return {
      id: d.id,
      jobTitle: d.jobTitle,
      companyName: d.companyName,
      location: d.location,
      employmentType: d.employmentType,
      status: d.status,
      isOnCampus: d.isOnCampus,
      applyDeadline: iso(d.deadlineDays),
      eligibility: { minCgpa: d.minCgpa, branches: [], batchYears: [] },
      rounds: d.rounds.map((r, i) => ({
        number: i + 1,
        type: r.type,
        mode: r.mode,
        windowStart: null,
        windowEnd: null,
      })),
      funnel: {
        applicants: its.length,
        inProgress: count("applied", "scoring", "scored"),
        shortlisted: count("shortlisted"),
        inInterview: count("in_interview"),
        selected: count("hired"),
        rejected: count("rejected"),
      },
    };
  }).sort((a, b) => String(a.applyDeadline).localeCompare(String(b.applyDeadline)));

  const students: PlatformStudent[] = state.students
    .filter((s) => applicationsByStudent.has(s.id))
    .map((s) => {
      const applications = applicationsByStudent.get(s.id)!;
      const selected = applications.some((a) => a.status === "hired");
      return {
        studentId: s.id,
        name: s.name,
        email: s.email,
        branch: s.branch,
        graduationYear: s.graduation_year,
        placementStatus: s.placement_status,
        selectedOnPlatform: selected,
        rosterNeedsReview: selected && s.placement_status !== "placed",
        applications,
      };
    })
    .sort(
      (a, b) =>
        Number(b.selectedOnPlatform) - Number(a.selectedOnPlatform) || a.name.localeCompare(b.name),
    );

  const all = students.flatMap((s) => s.applications);
  return clone({
    drives,
    students,
    studentsOnPlatform: students.length,
    totals: {
      applications: all.length,
      selected: all.filter((a) => a.status === "hired").length,
      needsRosterUpdate: students.filter((s) => s.rosterNeedsReview).length,
    },
  });
}
