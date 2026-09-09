-- ============================================================
-- Job Drives → Per-College Instances → Round-Based Shortlisting — Mirracle
--
-- A single job (public.jobs, set once) now runs as one or more DRIVES,
-- one per (job, college), each independently scheduled and independently
-- eligibility-gated. Each drive has ordered interview ROUNDS, and every
-- applicant has a per-round shortlist status that ONLY a manual company
-- action ever moves off 'pending'. Companies can save reusable round
-- structures as templates.
--
-- Also: mock-interview session history (ai_interview_sessions) which the
-- job-scoring engine now folds into dimensions.interview, and stable
-- candidate identity fields (nationality / work-authorization / gender /
-- location preferences) on public.profiles.
--
-- Run AFTER:
--   * db/migrations.sql                   (public.profiles, trigger_set_updated_at)
--   * incremental_migration.sql           (public.colleges)
--   * db/jobs_and_applications_migration.sql (public.jobs, applications, …)
--   * db/jobs_eligibility_migration.sql    (jobs.employment_type, ctc_*, …)
--
-- Idempotent: create-if-not-exists + add-column-if-not-exists +
-- drop-policy-if-exists throughout. As elsewhere in this repo, CHECK
-- constraints on `add column if not exists` only apply on first creation.
-- ============================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1.1  public.jobs — job-level fields, set once, shared across all colleges.
--      employment_type / ctc_* already added by jobs_eligibility_migration
--      (kept here idempotently so this file stands alone); interview_mode
--      is new — how THIS job interviews, which colours how the interview
--      weight is read by the scoring engine.
-- ─────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists employment_type text not null default 'full-time'
    check (employment_type in ('full-time', 'intern', 'contract'));
alter table public.jobs add column if not exists ctc_min      numeric;
alter table public.jobs add column if not exists ctc_max      numeric;
alter table public.jobs add column if not exists ctc_currency text not null default 'INR';
alter table public.jobs
  add column if not exists interview_mode text not null default 'ai'
    check (interview_mode in ('ai', 'live', 'both'));


-- ─────────────────────────────────────────────────────────────────────
-- 1.2  public.job_drives — one row per (job, college).
--
--      No college-approval gate: a drive flipped to 'live' is immediately
--      visible to eligible students at that college. Eligibility is per
--      drive — a null filter column means "no restriction on that axis".
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.job_drives (
  id                  uuid        primary key default gen_random_uuid(),
  job_id              uuid        not null references public.jobs(id)     on delete cascade,
  college_id          uuid        not null references public.colleges(id) on delete cascade,
  status              text        not null default 'draft'
                        check (status in ('draft', 'live', 'closed')),
  is_on_campus        boolean     not null default true,
  apply_deadline      timestamptz not null,
  oa_window_start     timestamptz,
  oa_window_end       timestamptz,
  min_cgpa            numeric(3, 2),
  eligible_branches   text[],
  eligible_batch_years int[],
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, college_id),
  constraint job_drives_oa_window_order check (
    oa_window_start is null or oa_window_end is null
    or oa_window_end > oa_window_start
  )
);

create index if not exists idx_job_drives_college_id on public.job_drives(college_id);
create index if not exists idx_job_drives_status     on public.job_drives(status);
create index if not exists idx_job_drives_job_id     on public.job_drives(job_id);

drop trigger if exists set_job_drives_updated_at on public.job_drives;
create trigger set_job_drives_updated_at
  before update on public.job_drives
  for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 1.3  public.job_drive_rounds — ordered interview rounds per drive.
--      round_number is 1-based and gap-free (enforced in the API).
--      A round with mode='ai' produces a round_score; 'live' rounds are
--      graded off-platform so their result score stays null.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.job_drive_rounds (
  id           uuid        primary key default gen_random_uuid(),
  drive_id     uuid        not null references public.job_drives(id) on delete cascade,
  round_number int         not null check (round_number >= 1),
  round_type   text        not null check (round_type in ('tech', 'hr', 'managerial', 'other')),
  mode         text        not null check (mode in ('ai', 'live')),
  window_start timestamptz,
  window_end   timestamptz,
  created_at   timestamptz not null default now(),
  unique (drive_id, round_number),
  constraint job_drive_rounds_window_order check (
    window_start is null or window_end is null or window_end > window_start
  )
);

create index if not exists idx_job_drive_rounds_drive_id on public.job_drive_rounds(drive_id);


-- ─────────────────────────────────────────────────────────────────────
-- 1.4  public.application_round_results — per-round shortlist status.
--
--      This is the whole point of the round model: shortlisting is a
--      manual company action at EVERY round. Nothing auto-populates this
--      table with 'shortlisted' — the only writer of a non-'pending'
--      status is the update-status route (decided_by / decided_at record
--      who / when). A student is shown round N+1 only once their row for
--      round N is 'shortlisted'.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.application_round_results (
  id             uuid        primary key default gen_random_uuid(),
  application_id uuid        not null references public.applications(id)     on delete cascade,
  round_id       uuid        not null references public.job_drive_rounds(id) on delete cascade,
  status         text        not null default 'pending'
                   check (status in ('pending', 'shortlisted', 'rejected')),
  round_score    numeric,
  decided_by     uuid,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (application_id, round_id)
);

create index if not exists idx_arr_round_id     on public.application_round_results(round_id);
create index if not exists idx_arr_application  on public.application_round_results(application_id);
create index if not exists idx_arr_round_status on public.application_round_results(round_id, status);


-- ─────────────────────────────────────────────────────────────────────
-- 1.5  public.company_drive_templates — reusable round structures.
--      rounds_json: [{round_number, round_type, mode}] — no dates; dates
--      are filled per drive when the template is applied.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.company_drive_templates (
  id                        uuid        primary key default gen_random_uuid(),
  company_id                uuid        not null references public.companies(id) on delete cascade,
  name                      text        not null,
  interview_mode            text        check (interview_mode in ('ai', 'live', 'both')),
  rounds_json               jsonb       not null default '[]'::jsonb,
  default_min_cgpa          numeric(3, 2),
  default_eligible_branches text[],
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_drive_templates_company_id on public.company_drive_templates(company_id);

drop trigger if exists set_drive_templates_updated_at on public.company_drive_templates;
create trigger set_drive_templates_updated_at
  before update on public.company_drive_templates
  for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 1.6  public.profiles — stable candidate identity fields.
--
--      `gender` is optional, self-reported, free text (UI offers a
--      "prefer not to say" option). It is used ONLY for aggregate
--      diversity metrics on the College Portal analytics tab — it must
--      NEVER be an eligibility filter and NEVER be exposed per-candidate
--      on a company's ranked applicant list.
--
--      `cgpa` backs compute_eligibility (job_drives.min_cgpa); profiles
--      already carries `branch` (text) and `graduation_year` (int) from
--      incremental_migration_candidate_onboarding_v2.sql.
-- ─────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists nationality         text;
alter table public.profiles add column if not exists needs_sponsorship   boolean;
alter table public.profiles add column if not exists sponsorship_country text;
alter table public.profiles add column if not exists gender              text;
alter table public.profiles add column if not exists preferred_locations text[];
alter table public.profiles add column if not exists willing_to_relocate boolean;
alter table public.profiles
  add column if not exists cgpa numeric(4, 2) check (cgpa >= 0 and cgpa <= 10);


-- ─────────────────────────────────────────────────────────────────────
-- 1.7  public.ai_interview_sessions — mock interview (AI Interview Studio)
--      history, for general practice. Separate from the per-job scoring
--      pipeline and fully separate from PeerMeet (which is excluded from
--      scoring by spec). An abandoned session stays completed=false and
--      never enters the scoring aggregate.
--
--      No existing table covers this — checked backend/app/services for an
--      interview-session model first (only PeerMeet peer_interview_reports
--      exists, which is out of scope for scoring).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_interview_sessions (
  id               uuid        primary key default gen_random_uuid(),
  student_id       uuid        not null references public.profiles(id) on delete cascade,
  completed        boolean     not null default false,
  overall_score    int         check (overall_score is null or (overall_score between 0 and 100)),
  duration_seconds int,
  created_at       timestamptz not null default now()
);

-- Exact access pattern of get_mock_interview_signal(): a student's
-- completed sessions, newest first.
create index if not exists idx_ai_interview_sessions_student
  on public.ai_interview_sessions(student_id, completed, created_at desc);


-- ═════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY  (defense-in-depth — the FastAPI backend uses the
-- service role and bypasses all of this; mirrors the model in
-- db/jobs_and_applications_migration.sql).
-- ═════════════════════════════════════════════════════════════════════

alter table public.job_drives                enable row level security;
alter table public.job_drive_rounds          enable row level security;
alter table public.application_round_results enable row level security;
alter table public.company_drive_templates   enable row level security;
alter table public.ai_interview_sessions     enable row level security;


-- ── job_drives ──────────────────────────────────────────────────────
-- Owning company: full control of drives for its own jobs.
drop policy if exists job_drives_company_manage on public.job_drives;
create policy job_drives_company_manage on public.job_drives
  for all
  using      (job_id in (select id from public.jobs where company_id = public.current_company_id()))
  with check (job_id in (select id from public.jobs where company_id = public.current_company_id()));

-- Students: read a drive only if it is live AND at their own college.
drop policy if exists job_drives_student_read on public.job_drives;
create policy job_drives_student_read on public.job_drives
  for select using (
    status = 'live'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.college_id = job_drives.college_id
    )
  );


-- ── job_drive_rounds: company manages own; students read for live drives ──
drop policy if exists job_drive_rounds_company on public.job_drive_rounds;
create policy job_drive_rounds_company on public.job_drive_rounds
  for all
  using (
    drive_id in (
      select d.id from public.job_drives d
      join public.jobs j on j.id = d.job_id
      where j.company_id = public.current_company_id()
    )
  )
  with check (
    drive_id in (
      select d.id from public.job_drives d
      join public.jobs j on j.id = d.job_id
      where j.company_id = public.current_company_id()
    )
  );

drop policy if exists job_drive_rounds_student_read on public.job_drive_rounds;
create policy job_drive_rounds_student_read on public.job_drive_rounds
  for select using (
    exists (
      select 1 from public.job_drives d
      join public.profiles p on p.id = auth.uid()
      where d.id = job_drive_rounds.drive_id
        and d.status = 'live'
        and d.college_id = p.college_id
    )
  );


-- ── application_round_results ───────────────────────────────────────
-- Student: read ONLY their own round results.
drop policy if exists arr_student_read on public.application_round_results;
create policy arr_student_read on public.application_round_results
  for select using (
    application_id in (select id from public.applications where student_id = auth.uid())
  );

-- Company: full control of round results for its own jobs' applications.
drop policy if exists arr_company_manage on public.application_round_results;
create policy arr_company_manage on public.application_round_results
  for all
  using (
    application_id in (select id from public.applications where company_id = public.current_company_id())
  )
  with check (
    application_id in (select id from public.applications where company_id = public.current_company_id())
  );


-- ── company_drive_templates: owning company only ───────────────────
drop policy if exists drive_templates_company on public.company_drive_templates;
create policy drive_templates_company on public.company_drive_templates
  for all
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());


-- ── ai_interview_sessions: the student owns their own sessions ─────
drop policy if exists ai_interview_sessions_student on public.ai_interview_sessions;
create policy ai_interview_sessions_student on public.ai_interview_sessions
  for all
  using      (student_id = auth.uid())
  with check (student_id = auth.uid());
