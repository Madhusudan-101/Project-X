/**
 * Admin Portal API service — GET /admin/* (backend/app/routers/admin).
 * Every call needs an Admin session; the backend enforces that, the UI guard
 * is only a convenience.
 */

import { ApiClientError, buildQuery, getApiBaseUrl, getAuthHeader, request } from "../client";
import type {
  ActivityItem,
  AdminOverview,
  AdminRange,
  AlertItem,
  BlockUserInput,
  CandidateRow,
  CollegeDetail,
  CollegeProvisionInput,
  CollegeProvisionResult,
  CollegeRow,
  CompanyRow,
  CsvExport,
  CtcByCompanyRow,
  DepartmentRow,
  DriveRow,
  EventItem,
  FilterOptions,
  FinanceSummary,
  LiveActivityResponse,
  ListParams,
  Paged,
  PartnershipRow,
  PlacementSummary,
  PlatformUsage,
  SearchResponse,
  SystemHealth,
  TrendResponse,
  UserDetail,
  UserRole,
  UserRow,
} from "@/types/admin/admin";

type Query = Record<string, string | number | boolean | null | undefined>;

const list = <T>(path: string, range: AdminRange, params: Query) =>
  request<Paged<T>>(`/admin/${path}${buildQuery({ ...range, ...params })}`);

/** Same filters as the paged list, minus paging — the backend returns the full set as CSV (fetched in
 * chunks) and reports via headers whether the hard row cap cut it short. */
async function exportCsv(path: string, range: AdminRange, params: Query): Promise<CsvExport> {
  const res = await fetch(`${getApiBaseUrl()}/admin/${path}/export${buildQuery({ ...range, ...params })}`, {
    headers: { ...(await getAuthHeader()) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiClientError(typeof body?.detail === "string" ? body.detail : "Export failed.", res.status);
  }
  const rows = Number(res.headers.get("X-Export-Rows"));
  const total = Number(res.headers.get("X-Export-Total"));
  return {
    blob: await res.blob(),
    // Anything but an explicit "false" is treated as possibly incomplete — never assume complete.
    truncated: res.headers.get("X-Export-Truncated") !== "false",
    rows: Number.isFinite(rows) ? rows : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

// ── Filters ───────────────────────────────────────────────────────────
export type CollegeFilters = {
  registration?: "registered" | "directory" | "all";
  activity?: "active" | "inactive";
};
export type CompanyFilters = {
  activity?: "active" | "inactive";
  verified?: boolean;
};
export type CandidateFilters = {
  college_id?: string;
  company_id?: string;
  drive_id?: string;
  status?: string;
  registered_in_range?: boolean;
};
export type DriveFilters = {
  status?: string;
  company_id?: string;
  college_id?: string;
};
export type PartnershipFilters = {
  company_id?: string;
  college_id?: string;
};
export type UserFilters = {
  role?: UserRole;
  status?: "active" | "blocked";
};
export type AuditLogFilters = {
  event_type?: string;
  actor_role?: UserRole;
  target_type?: string;
  result?: "success" | "failure";
  target_id?: string;
};

export const adminService = {
  overview: (range: AdminRange) => request<AdminOverview>(`/admin/overview${buildQuery({ ...range })}`),

  trends: (range: AdminRange) =>
    request<TrendResponse>(
      `/admin/trends${buildQuery({ ...range, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
    ),

  activity: (limit = 12) => request<{ items: ActivityItem[] }>(`/admin/activity${buildQuery({ limit })}`),

  placements: (range: AdminRange) => request<PlacementSummary>(`/admin/placements${buildQuery({ ...range })}`),

  finance: (range: AdminRange) => request<FinanceSummary>(`/admin/finance/summary${buildQuery({ ...range })}`),

  options: () => request<FilterOptions>("/admin/options"),

  colleges: {
    list: (range: AdminRange, p: ListParams & CollegeFilters) => list<CollegeRow>("colleges", range, p),
    detail: (id: string, range: AdminRange) =>
      request<CollegeDetail>(`/admin/colleges/${id}${buildQuery({ ...range })}`),
    export: (range: AdminRange, p: Partial<ListParams> & CollegeFilters) => exportCsv("colleges", range, p),
    provision: (body: CollegeProvisionInput) =>
      request<CollegeProvisionResult>("/admin/colleges", { method: "POST", body }),
  },

  companies: {
    list: (range: AdminRange, p: ListParams & CompanyFilters) => list<CompanyRow>("companies", range, p),
    detail: (id: string, range: AdminRange) =>
      request<{ company: CompanyRow }>(`/admin/companies/${id}${buildQuery({ ...range })}`),
    export: (range: AdminRange, p: Partial<ListParams> & CompanyFilters) => exportCsv("companies", range, p),
  },

  candidates: {
    list: (range: AdminRange, p: ListParams & CandidateFilters) => list<CandidateRow>("candidates", range, p),
    export: (range: AdminRange, p: Partial<ListParams> & CandidateFilters) => exportCsv("candidates", range, p),
  },

  drives: {
    list: (range: AdminRange, p: ListParams & DriveFilters) => list<DriveRow>("drives", range, p),
    export: (range: AdminRange, p: Partial<ListParams> & DriveFilters) => exportCsv("drives", range, p),
  },

  partnerships: {
    list: (range: AdminRange, p: ListParams & PartnershipFilters) =>
      list<PartnershipRow>("partnerships", range, p),
    export: (range: AdminRange, p: Partial<ListParams> & PartnershipFilters) =>
      exportCsv("partnerships", range, p),
  },

  ctcByCompany: (range: AdminRange) => request<{ items: CtcByCompanyRow[] }>(`/admin/ctc-by-company${buildQuery({ ...range })}`),

  departments: (range: AdminRange, collegeId?: string) =>
    request<{ items: DepartmentRow[] }>(`/admin/departments${buildQuery({ ...range, college_id: collegeId })}`),

  users: {
    list: (range: AdminRange, p: ListParams & UserFilters) => list<UserRow>("users", range, p),
    detail: (id: string, range: AdminRange) => request<UserDetail>(`/admin/users/${id}${buildQuery({ ...range })}`),
    export: (range: AdminRange, p: Partial<ListParams> & UserFilters) => exportCsv("users", range, p),
    block: (id: string, body: BlockUserInput) =>
      request<{ user_id: string; is_blocked: boolean; permanent: boolean; blocked_until: string | null }>(
        `/admin/users/${id}/block`,
        { method: "POST", body },
      ),
    unblock: (id: string, reason?: string) =>
      request<{ user_id: string; is_blocked: boolean }>(`/admin/users/${id}/unblock`, { method: "POST", body: { reason } }),
  },

  liveActivity: (range: AdminRange, p: { before?: string; kind?: string; limit?: number }) =>
    request<LiveActivityResponse>(`/admin/live-activity${buildQuery({ ...range, ...p })}`),

  auditLog: {
    list: (range: AdminRange, p: ListParams & AuditLogFilters) => list<EventItem>("audit-log", range, p),
    export: (range: AdminRange, p: Partial<ListParams> & AuditLogFilters) => exportCsv("audit-log", range, p),
  },

  alerts: () => request<{ items: AlertItem[] }>("/admin/alerts"),

  search: (q: string) => request<SearchResponse>(`/admin/search${buildQuery({ q })}`),

  systemHealth: () => request<SystemHealth>("/admin/system-health"),

  reports: {
    applicationFunnelExportUrl: (range: AdminRange) => `${getApiBaseUrl()}/admin/reports/application-funnel/export${buildQuery({ ...range })}`,
    compensationExportUrl: (range: AdminRange) => `${getApiBaseUrl()}/admin/reports/compensation/export${buildQuery({ ...range })}`,
    platformUsage: (range: AdminRange) => request<PlatformUsage>(`/admin/reports/platform-usage${buildQuery({ ...range })}`),
    // Downloads the funnel/compensation reports the same authenticated way ExportButton does.
    download: async (url: string): Promise<CsvExport> => {
      const res = await fetch(url, { headers: { ...(await getAuthHeader()) } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiClientError(typeof body?.detail === "string" ? body.detail : "Report failed.", res.status);
      }
      const rows = Number(res.headers.get("X-Export-Rows"));
      const total = Number(res.headers.get("X-Export-Total"));
      return {
        blob: await res.blob(),
        truncated: res.headers.get("X-Export-Truncated") !== "false",
        rows: Number.isFinite(rows) ? rows : 0,
        total: Number.isFinite(total) ? total : 0,
      };
    },
  },
};
