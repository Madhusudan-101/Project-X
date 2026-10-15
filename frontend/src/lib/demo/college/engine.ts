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
  CsvUploadInvalidRow,
  CsvUploadResult,
  DashboardStats,
  Department,
  DepartmentDetail,
  DepartmentInput,
  Drive,
  DriveCreateInput,
  DriveEligibleResponse,
  DriveEligibility,
  PlacementStatus,
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
  constructor(message: string, invalidRows?: CsvUploadInvalidRow[]) {
    super(message, 400);
    this.name = "DemoCsvError";
    this.invalidRows = invalidRows;
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

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : 0;
};

/** Mirrors backend parse_students_csv + upsert-by-email. Throws DemoCsvError listing rejected rows. */
export function uploadStudentsCsv(draft: DemoState, text: string): CsvUploadResult {
  if (text.length > MAX_DEMO_CSV_BYTES)
    throw new DemoApiError("CSV too large for the demo (max 1 MB)", 413);
  const [header, ...body] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header) throw new DemoApiError("CSV contained no rows", 400);
  if (body.length > MAX_DEMO_CSV_ROWS) {
    throw new DemoApiError(`The demo accepts up to ${MAX_DEMO_CSV_ROWS} rows per upload.`, 413);
  }
  const cols = header.map((h) => h.trim());
  const invalid: CsvUploadInvalidRow[] = [];
  const parsed = new Map<string, Student>();

  body.forEach((cells, idx) => {
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()));
    const missing = ["name", "email", "branch", "graduationYear"].filter((f) => !row[f]);
    const year = Number(row.graduationYear);
    if (!missing.length && !Number.isInteger(year)) missing.push("graduationYear");
    // Validate everything up front: an upload either applies completely or not at all.
    if (!missing.length && !EMAIL_RE.test(row.email)) missing.push("email");
    if (missing.length) {
      invalid.push({ line: idx + 2, missing, row });
      return;
    }
    const verification = (row.verificationStatus || "pending").toLowerCase() as VerificationStatus;
    const placement = (row.placementStatus || "not_placed").toLowerCase() as PlacementStatus;
    const email = row.email.toLowerCase();
    const existing = draft.students.find((s) => s.email === email);
    const base = existing ? clone(existing) : createStudentShell(draft, email);
    parsed.set(email, {
      ...base,
      name: row.name,
      branch: row.branch,
      graduation_year: year,
      employability_score: num(row.employabilityScore),
      resume_score: num(row.resumeScore),
      github_score: num(row.githubScore),
      leetcode_score: num(row.leetcodeScore),
      interview_score: num(row.interviewScore),
      assessment_score: num(row.assessmentScore),
      verification_status: VERIFICATION_STATUSES.includes(verification) ? verification : "pending",
      placement_status: PLACEMENT_STATUSES.includes(placement) ? placement : "not_placed",
      updated_at: nowIso(),
    });
  });

  if (invalid.length) {
    throw new DemoCsvError("CSV file has missing or invalid required fields", invalid.slice(0, 20));
  }
  if (!parsed.size) throw new DemoApiError("CSV contained no rows", 400);

  const added: Student[] = [];
  for (const row of parsed.values()) {
    const at = draft.students.findIndex((s) => s.email === row.email);
    if (at >= 0) draft.students[at] = row;
    else draft.students.push(row);
    added.push(row);
  }
  return {
    message: "Students uploaded successfully",
    addedStudents: added.length,
    students: clone(added),
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
