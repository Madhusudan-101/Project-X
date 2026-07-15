/**
 * College Portal API service — talks to the real FastAPI routers shipped in
 * Phase 4 (backend/app/routers/{dashboard,students,drives,shortlist}.py).
 *
 * IMPORTANT: this file intentionally does NOT expose add/edit/delete-student,
 * edit/delete-drive, or full-roster-export functions — those endpoints do not
 * exist on the backend yet. Only wrap real routes here.
 */

import { ApiClientError, getApiBaseUrl, getAuthHeader, request } from "./client";
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
  ScoreDistribution,
  ShortlistFilters,
  ShortlistResult,
  Student,
  StudentListFilters,
} from "@/types/college";

/** Thrown by uploadCsv when the backend rejects rows for missing required fields. */
export class CsvUploadError extends ApiClientError {
  invalidRows?: CsvUploadInvalidRow[];
  constructor(message: string, status: number, invalidRows?: CsvUploadInvalidRow[]) {
    super(message, status);
    this.invalidRows = invalidRows;
  }
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      usp.set(key, String(value));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ── Dashboard — GET /api/dashboard/stats, GET /api/dashboard/score-distribution ──
export const dashboardService = {
  stats: () => request<DashboardStats>("/api/dashboard/stats"),
  scoreDistribution: () => request<ScoreDistribution>("/api/dashboard/score-distribution"),
};

// ── Students — GET /api/students/, GET /api/students/{id}, POST /api/students/upload ──
export const studentsService = {
  list: (filters: StudentListFilters = {}) =>
    request<Student[]>(
      `/api/students/${buildQuery({
        branch: filters.branch,
        graduationYear: filters.graduationYear,
        minimumScore: filters.minimumScore,
      })}`,
    ),

  get: (studentId: string) => request<Student>(`/api/students/${studentId}`),

  /** POST /api/students/upload — multipart CSV bulk upload. Bypasses request() because it needs FormData. */
  uploadCsv: async (file: File): Promise<CsvUploadResult> => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${getApiBaseUrl()}/api/students/upload`, {
      method: "POST",
      headers: { ...getAuthHeader() },
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
};

// ── Drives — GET /api/drives/, POST /api/drives/, GET /api/drives/{id}/eligible ──
export const drivesService = {
  list: () => request<Drive[]>("/api/drives/"),

  create: (payload: DriveCreateInput) =>
    request<{ message: string; drive: Drive }>("/api/drives/", {
      method: "POST",
      body: payload,
    }),

  eligibleStudents: (driveId: string) =>
    request<DriveEligibleResponse>(`/api/drives/${driveId}/eligible`),
};

// ── Shortlist — POST /api/shortlist/filter, GET /api/shortlist/export ──
export const shortlistService = {
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
      headers: { ...getAuthHeader() },
    });
    if (!res.ok) {
      throw new ApiClientError("Export failed", res.status);
    }
    return res.blob();
  },
};

/** Triggers a browser download for a CSV blob without navigating away from the SPA. */
export function downloadCsvBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Departments — GET/POST /api/departments/, GET/PUT/DELETE /api/departments/{id} ──
export const departmentsService = {
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
