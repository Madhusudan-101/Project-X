/**
 * College Portal API service — talks to the real FastAPI routers shipped in
 * Phase 4 (backend/app/routers/{dashboard,students,drives,shortlist}.py).
 *
 * Only wrap real backend routes here.
 *
 * Every service below is exported through `withDemo`: on /demo/college pages the call goes
 * to the fictional in-browser dataset (services/demo/collegeDemoService.ts) instead, and the
 * live implementation is never invoked. Anywhere else it is the live API, unchanged.
 */

import { ApiClientError, buildQuery, getApiBaseUrl, getAuthHeader, request } from "../client";
import { withDemo } from "@/lib/demo/college/dispatch";
import { DemoCsvError } from "@/lib/demo/college/engine";
import { isDemoLocation } from "@/lib/demo/college/mode";
import {
  demoDashboardService,
  demoDepartmentsService,
  demoDrivesService,
  demoShortlistService,
  demoStudentsService,
} from "@/services/demo/collegeDemoService";
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
} from "@/types/college/college";

/** Thrown by uploadCsv when the backend rejects rows for missing required fields. */
export class CsvUploadError extends ApiClientError {
  invalidRows?: CsvUploadInvalidRow[];
  constructor(message: string, status: number, invalidRows?: CsvUploadInvalidRow[]) {
    super(message, status);
    this.invalidRows = invalidRows;
  }
}

// ── Dashboard — GET /api/dashboard/stats, GET /api/dashboard/score-distribution ──
const liveDashboardService = {
  stats: () => request<DashboardStats>("/api/dashboard/stats"),
  scoreDistribution: () => request<ScoreDistribution>("/api/dashboard/score-distribution"),
};

// ── Students — GET /api/students/, POST /api/students/, GET/PUT/DELETE /api/students/{id}, POST /api/students/upload, GET /api/students/export ──
const liveStudentsService = {
  list: (filters: StudentListFilters = {}) =>
    request<Student[]>(
      `/api/students/${buildQuery({
        branch: filters.branch,
        graduationYear: filters.graduationYear,
        minimumScore: filters.minimumScore,
      })}`,
    ),

  create: (payload: StudentCreateInput) =>
    request<{ message: string; student: Student }>("/api/students/", {
      method: "POST",
      body: payload,
    }),

  get: (studentId: string) => request<Student>(`/api/students/${studentId}`),

  update: (
    studentId: string,
    payload: Partial<StudentCreateInput> & { placementStatus?: PlacementStatus },
  ) =>
    request<{ message: string; student: Student }>(`/api/students/${studentId}`, {
      method: "PUT",
      body: payload,
    }),

  bulkUpdatePlacementStatus: (studentIds: string[], placementStatus: PlacementStatus) =>
    request<{ message: string; updatedCount: number }>("/api/students/bulk-placement-status", {
      method: "PUT",
      body: { studentIds, placementStatus },
    }),

  remove: (studentId: string) =>
    request<{ message: string }>(`/api/students/${studentId}`, {
      method: "DELETE",
    }),

  /** POST /api/students/upload — multipart CSV bulk upload. Bypasses request() because it needs FormData. */
  uploadCsv: async (file: File): Promise<CsvUploadResult> => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${getApiBaseUrl()}/api/students/upload`, {
      method: "POST",
      headers: { ...(await getAuthHeader()) },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail;
      const message =
        typeof detail === "string" ? detail : (detail?.message ?? body?.message ?? res.statusText);
      throw new CsvUploadError(message, res.status, detail?.invalidRows);
    }
    return res.json() as Promise<CsvUploadResult>;
  },

  /** GET /api/students/export — roster CSV, optionally scoped by the same filters as list(). Bypasses request() because the response isn't JSON. */
  exportCsv: async (
    filters: StudentListFilters & { placementStatus?: PlacementStatus } = {},
  ): Promise<Blob> => {
    const query = buildQuery({
      branch: filters.branch,
      graduationYear: filters.graduationYear,
      minimumScore: filters.minimumScore,
      placementStatus: filters.placementStatus,
    });
    const res = await fetch(`${getApiBaseUrl()}/api/students/export${query}`, {
      headers: { ...(await getAuthHeader()) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = typeof body?.detail === "string" ? body.detail : "Failed to export students.";
      throw new ApiClientError(message, res.status);
    }
    return res.blob();
  },

  /** Temporarily blocks the student; if they already have a candidate account
   * at this college, that account is restricted immediately too — not just
   * hidden in this UI. See backend/app/services/college/student_access.py. */
  block: (studentId: string, payload: StudentBlockInput) =>
    request<StudentActionResult>(`/api/students/${studentId}/block`, { method: "POST", body: payload }),

  restrict: (studentId: string, reason: string) =>
    request<StudentActionResult>(`/api/students/${studentId}/restrict`, { method: "POST", body: { reason } }),

  unblock: (studentId: string, reason?: string) =>
    request<StudentActionResult>(`/api/students/${studentId}/unblock`, { method: "POST", body: { reason } }),

  /** Sends onboarding invites to the given students (or every eligible
   * student in the college when omitted) — see StudentOnboardResult for what
   * "eligible" excludes (already invited, already registered, blocked,
   * invalid email) and why. */
  onboard: (studentIds?: string[]) =>
    request<StudentOnboardResult>("/api/students/onboard", { method: "POST", body: { studentIds } }),
};

// ── Drives — GET /api/drives/, POST /api/drives/, PUT/DELETE /api/drives/{id}, GET /api/drives/{id}/eligible ──
const liveDrivesService = {
  list: () => request<Drive[]>("/api/drives/"),

  create: (payload: DriveCreateInput) =>
    request<{ message: string; drive: Drive }>("/api/drives/", {
      method: "POST",
      body: payload,
    }),

  update: (driveId: string, payload: Partial<DriveCreateInput>) =>
    request<{ message: string; drive: Drive }>(`/api/drives/${driveId}`, {
      method: "PUT",
      body: payload,
    }),

  remove: (driveId: string) =>
    request<{ message: string }>(`/api/drives/${driveId}`, {
      method: "DELETE",
    }),

  eligibleStudents: (driveId: string) =>
    request<DriveEligibleResponse>(`/api/drives/${driveId}/eligible`),
};

// ── Shortlist — POST /api/shortlist/filter, GET /api/shortlist/export ──
const liveShortlistService = {
  filter: (filters: ShortlistFilters) =>
    request<ShortlistResult>("/api/shortlist/filter", {
      method: "POST",
      body: filters,
    }),

  /** GET /api/shortlist/export — returns a CSV blob. Bypasses request() because the response isn't JSON. */
  exportCsv: async (filters: ShortlistFilters): Promise<Blob> => {
    const query = buildQuery({
      branch: filters.branch,
      graduationYear: filters.graduationYear,
      minimumScore: filters.minimumScore,
      verificationStatus: filters.verificationStatus,
    });
    const res = await fetch(`${getApiBaseUrl()}/api/shortlist/export${query}`, {
      headers: { ...(await getAuthHeader()) },
    });
    if (!res.ok) {
      throw new ApiClientError("Export failed", res.status);
    }
    return res.blob();
  },
};

// Shared with the Admin service — implemented in ../client; re-exported so existing imports keep working.
export { downloadCsvBlob } from "../client";

// ── Departments — GET/POST /api/departments/, GET/PUT/DELETE /api/departments/{id} ──
const liveDepartmentsService = {
  list: () => request<Department[]>("/api/departments/"),

  get: (departmentId: string) => request<DepartmentDetail>(`/api/departments/${departmentId}`),

  create: (payload: DepartmentInput) =>
    request<{ message: string; department: Department }>("/api/departments/", {
      method: "POST",
      body: payload,
    }),

  update: (departmentId: string, payload: Partial<DepartmentInput>) =>
    request<{ message: string; department: Department }>(`/api/departments/${departmentId}`, {
      method: "PUT",
      body: payload,
    }),

  remove: (departmentId: string) =>
    request<{ message: string }>(`/api/departments/${departmentId}`, {
      method: "DELETE",
    }),
};

// ── Demo Mode dispatch (see header) ──
// Routing happens per call, from the current URL. The demo CSV parser raises its own error
// type (it must not import this module); convert it here so the UI sees the usual CsvUploadError.
const demoStudentsWithCsvError: typeof liveStudentsService = {
  ...demoStudentsService,
  uploadCsv: async (file) => {
    try {
      return await demoStudentsService.uploadCsv(file);
    } catch (err) {
      if (err instanceof DemoCsvError) throw new CsvUploadError(err.message, err.status, err.invalidRows);
      throw err;
    }
  },
};

export const dashboardService = withDemo(liveDashboardService, demoDashboardService, isDemoLocation);
export const studentsService = withDemo(liveStudentsService, demoStudentsWithCsvError, isDemoLocation);
export const drivesService = withDemo(liveDrivesService, demoDrivesService, isDemoLocation);
export const shortlistService = withDemo(liveShortlistService, demoShortlistService, isDemoLocation);
export const departmentsService = withDemo(liveDepartmentsService, demoDepartmentsService, isDemoLocation);
