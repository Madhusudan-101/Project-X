/**
 * Admin Portal API types. Field names mirror the backend responses
 * (snake_case, straight from the admin_* SQL functions) — no mapping layer.
 * A `null` metric means "not available" and must be shown as N/A, never 0.
 */

/** ISO instants; both omitted = all time. Half-open: [from, to). */
export interface AdminRange {
  from?: string;
  to?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type SortDir = "asc" | "desc";

// ── Overview ──────────────────────────────────────────────────────────

export interface OverviewTotals {
  users: number;
  candidates: number;
  recruiters: number;
  college_accounts: number;
  admins: number;
  companies: number;
  colleges: number;
  colleges_in_directory: number;
  drives: number;
  drives_live: number;
  drives_draft: number;
  drives_closed: number;
  /** Part of `drives` at colleges that have a College account (the rest are at directory-only colleges). */
  drives_at_registered_colleges: number;
  colleges_with_drives: number;
  companies_with_drives: number;
}

export interface OverviewPeriod {
  new_candidates: number;
  new_companies: number;
  new_colleges: number;
  drives_created: number;
  applications: number;
  /** Part of `applications` from students at registered colleges (the rest: directory-only colleges or no college). */
  applications_at_registered_colleges: number;
  applicants: number;
  shortlisted: number;
  selected: number;
  selected_applicants: number;
  drives_with_applications: number;
  active_candidates: number;
  active_companies: number;
  active_colleges: number;
}

export interface OverviewDerived {
  placement_rate: number | null;
  shortlist_rate: number | null;
  applications_per_applicant: number | null;
  applications_per_drive: number | null;
  college_participation: number | null;
  company_participation: number | null;
}

export interface AdminOverview {
  range: { from: string | null; to: string | null };
  totals: OverviewTotals;
  period: OverviewPeriod;
  derived: OverviewDerived;
}

export interface TrendPoint {
  bucket: string;
  new_candidates: number;
  new_companies: number;
  new_colleges: number;
  drives_created: number;
  applications: number;
  shortlisted: number;
  selected: number;
}

export interface TrendResponse {
  bucket: "day" | "week" | "month";
  points: TrendPoint[];
}

export type ActivityKind =
  | "candidate_registered"
  | "company_registered"
  | "college_registered"
  | "drive_created"
  | "application_submitted"
  | "candidate_selected";

export interface ActivityItem {
  kind: ActivityKind;
  occurred_at: string;
  subject: string;
  detail: string | null;
}

// ── Placements ────────────────────────────────────────────────────────

export interface CtcBlock {
  roles: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  distribution: { bucket: string; count: number }[];
}

export interface PlacementSummary {
  drives: { total: number; live: number; draft: number; closed: number; created_in_period: number };
  funnel: {
    applications: number;
    applicants: number;
    shortlisted: number;
    selected: number;
    selected_applicants: number;
    placement_rate: number | null;
    shortlist_rate: number | null;
    applications_per_drive: number | null;
  };
  ctc: { currency: string; excluded_other_currency: number; posted: CtcBlock; filled: CtcBlock };
}

// ── Entities ──────────────────────────────────────────────────────────

/** Funnel counts shared by every entity table (period cohort, see backend). */
export interface FunnelCounts {
  applications: number;
  applicants: number;
  shortlisted: number;
  selected: number;
  selected_applicants: number;
}

export interface CollegeRow extends FunnelCounts {
  college_id: string;
  name: string;
  city: string | null;
  state: string | null;
  college_type: string | null;
  has_account: boolean;
  registered_at: string | null;
  candidates: number;
  /** College Portal data (entered by the college's TPO) — a separate dataset from the platform pipeline. */
  roster_students: number;
  roster_placed: number;
  portal_drives: number;
  companies: number;
  drives: number;
  last_activity: string | null;
  is_active: boolean;
}

export interface CollegeAccount {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  onboarded: boolean;
}

export interface CollegeDetail {
  college: CollegeRow;
  accounts: CollegeAccount[];
}

export interface CompanyRow extends FunnelCounts {
  company_id: string;
  name: string;
  industry: string | null;
  size: string | null;
  is_verified: boolean;
  registered_at: string;
  owner_email: string | null;
  jobs: number;
  drives: number;
  colleges: number;
  last_activity: string | null;
  is_active: boolean;
}

export type PlacementStatus = "not_applied" | "applied" | "in_process" | "rejected" | "placed";

export interface CandidateRow {
  candidate_id: string;
  name: string;
  email: string;
  college_id: string | null;
  college_name: string | null;
  branch: string | null;
  graduation_year: number | null;
  registered_at: string;
  applications: number;
  shortlisted: number;
  selected: number;
  placement_status: PlacementStatus;
}

export interface DriveRow {
  drive_id: string;
  job_id: string;
  job_title: string;
  company_id: string;
  company_name: string;
  college_id: string;
  college_name: string;
  status: "draft" | "live" | "closed";
  is_on_campus: boolean;
  employment_type: string;
  apply_deadline: string;
  created_at: string;
  applications: number;
  applicants: number;
  shortlisted: number;
  selected: number;
}

export interface PartnershipRow {
  company_id: string;
  company_name: string;
  college_id: string;
  college_name: string;
  drives: number;
  first_drive_at: string;
  last_drive_at: string;
  applications: number;
  applicants: number;
  shortlisted: number;
  selected: number;
}

export interface FilterOptions {
  colleges: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  drives: { id: string; label: string }[];
}

// ── Finance ───────────────────────────────────────────────────────────

export interface FinanceSummary {
  available: boolean;
  currency: string | null;
  source: string | null;
  message: string;
  metrics: {
    revenue: number | null;
    monthly_revenue: number | null;
    annual_revenue: number | null;
    revenue_per_college: number | null;
    revenue_per_company: number | null;
    expenditure: number | null;
    net_revenue: number | null;
    growth_rate: number | null;
  };
}

// ── Provisioning ──────────────────────────────────────────────────────

export interface CollegeProvisionInput {
  email: string;
  first_name: string;
  last_name: string;
  college_name?: string;
  college_id?: string;
  city?: string;
  state?: string;
  type?: string;
}

export interface CollegeProvisionResult {
  college_id: string;
  user_id: string;
  created: boolean;
  invite_sent: boolean;
  /** An unlinked legacy College account for this email was deleted and replaced by a fresh one. */
  replaced_legacy_account: boolean;
}

/** A CSV export plus what the backend says about its completeness (X-Export-* headers). */
export interface CsvExport {
  blob: Blob;
  /** True when the hard row cap cut the export short — it is NOT the complete result. */
  truncated: boolean;
  rows: number;
  total: number;
}

// ── List query params ─────────────────────────────────────────────────

// A type alias (not an interface) so it is assignable to the query-string builder's index signature.
export type ListParams = {
  page: number;
  page_size: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
};

// ── Users & Access ───────────────────────────────────────────────────

export type UserRole = "admin" | "college" | "company" | "candidate";

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  college_id: string | null;
  college_name: string | null;
  company_id: string | null;
  company_name: string | null;
  created_at: string;
  onboarded: boolean;
  is_blocked: boolean;
  blocked_permanent: boolean;
  blocked_until: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  blocked_by_email: string | null;
  last_activity: string | null;
}

export interface UserDetail {
  user: UserRow;
  /** Only populated for role='candidate'. */
  applications: Array<{ id: string; job_id: string; company_id: string; status: string; applied_at: string; updated_at: string }>;
  /** Only populated for role='company' | 'college'. */
  drives: Paged<DriveRow>;
  audit: EventItem[];
}

export type BlockDuration = "1h" | "24h" | "7d" | "30d" | "custom";

export interface BlockUserInput {
  permanent: boolean;
  duration?: BlockDuration;
  until?: string;
  reason: string;
}

// ── Central event log — Audit Log & Live Activity ───────────────────────

export type EventType =
  | "user_login"
  | "account_provisioned"
  | "user_blocked"
  | "user_unblocked"
  | "csv_exported"
  | "report_generated";

export interface EventItem {
  id: string;
  event_type: EventType;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: UserRole | null;
  actor_label: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
  result: "success" | "failure";
}

/** A Live Activity row: the original derived kinds (from existing timestamps)
 * plus successful admin_events, merged into one feed. See ActivityItem for
 * the Overview's separate, non-paginated compact panel (unchanged). */
export interface FeedItem {
  id: string;
  kind: ActivityKind | EventType;
  occurred_at: string;
  subject: string;
  detail: string | null;
  actor_role: UserRole | null;
}

export interface LiveActivityResponse {
  items: FeedItem[];
  has_more: boolean;
}

// ── Alerts ────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertItem {
  alert_id: string;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  occurred_at: string | null;
  link: string;
}

// ── Global search ─────────────────────────────────────────────────────

export type SearchEntityType = "college" | "company" | "candidate" | "drive";

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
}

export interface SearchResponse {
  query: string;
  groups: Partial<Record<SearchEntityType, SearchResult[]>>;
}

// ── System health ─────────────────────────────────────────────────────

export type HealthStatus = "operational" | "degraded" | "unavailable" | "unknown";

export interface HealthCheck {
  status: HealthStatus;
  latency_ms?: number;
  detail?: string;
}

export interface SystemHealth {
  overall: HealthStatus;
  checked_at: string;
  checks: Record<"api" | "database" | "authentication" | "storage" | "realtime" | "background_jobs", HealthCheck>;
}

// ── Department analytics ─────────────────────────────────────────────

export interface DepartmentRow {
  branch: string;
  candidates: number;
  applications: number;
  applicants: number;
  shortlisted: number;
  selected: number;
  selected_applicants: number;
}

// ── CTC by company ────────────────────────────────────────────────────

export interface CtcByCompanyRow {
  company_id: string;
  company_name: string;
  posted_roles: number;
  posted_average: number | null;
  posted_highest: number | null;
  posted_lowest: number | null;
  filled_roles: number;
  filled_average: number | null;
  filled_highest: number | null;
  filled_lowest: number | null;
}

// ── Platform usage (Reports) ─────────────────────────────────────────

export interface PlatformUsage {
  logins: number;
  blocked_login_attempts: number;
  accounts_provisioned: number;
  users_blocked: number;
  users_unblocked: number;
  csv_exports: number;
  reports_generated: number;
  applications_submitted: number;
  drives_created: number;
  resume_analyses: number;
  /** Earliest admin_events row — a period that starts before this has no
   * login/export/report data because tracking did not exist yet, not
   * because nothing happened. */
  events_tracking_since: string | null;
}
