-- ============================================================
-- Admin Portal Migration — Mirracle
--
-- What this adds (nothing else in the schema is touched):
--   1. A guard trigger on public.profiles so `role` (and a College account's
--      `college_id`) can only be written by the backend (service role) or a
--      direct DB session — never by an anon/authenticated PostgREST caller.
--      Without it, any signed-in user could `PATCH /rest/v1/profiles` their
--      own role to 'admin'.
--   2. A few indexes for the date-range aggregates the Admin Portal runs.
--   3. `admin_*` SQL functions that compute every Admin Portal metric with
--      set-based aggregates (no per-row round-trips, no whole-table fetches
--      into the API). They are SECURITY DEFINER and EXECUTE is granted to
--      `service_role` ONLY — a browser holding the anon key or any user JWT
--      (admin included) cannot call them directly; only the FastAPI backend,
--      after `require_admin_role`, can.
--
-- Run AFTER: db/migrations.sql, incremental_migration.sql,
--   incremental_migration_candidate_profile.sql,
--   db/company_migration.sql, db/company_onboarding_migration.sql,
--   db/jobs_and_applications_migration.sql, db/jobs_eligibility_migration.sql,
--   db/job_drives_migration.sql (all tables referenced below must exist).
--
-- Idempotent: create-or-replace / if-not-exists / drop-if-exists throughout.
-- Additive: the only change to an existing table's shape is ONE new NULLable
-- column on public.applications (see 0. and 1b.); no existing row is modified.
-- Safe to re-run.
--
-- Metric definitions (single source of truth — the API and UI only display):
--   * Registered college   = a public.colleges row with >= 1 profile of
--                            role 'college' linked to it. (public.colleges is
--                            also a directory: seeded rows and rows created
--                            when a candidate types their college.)
--   * Application college  = the college the student belonged to WHEN THEY
--                            APPLIED (applications.college_id, snapshotted by a
--                            trigger). Applications that predate this migration
--                            have no snapshot and fall back to the student's
--                            current profiles.college_id.
--   * Shortlisted          = EVER shortlisted: application status in (shortlisted,
--                            in_interview, hired) OR any 'shortlisted' round
--                            result. It stays true if the candidate was rejected
--                            later, so it is a funnel stage, not a current state.
--   * Eliminated           = status 'rejected' or any 'rejected' round result
--                            (unless the application was hired).
--   * Selected             = application status 'hired'.
--   * Candidate status     = placed (any selected application) > in_process (a
--                            shortlisted application that is not eliminated) >
--                            applied (an undecided application) > rejected (has
--                            applications, every one eliminated) > not_applied.
--   * Platform vs College Portal data:
--                            every metric below comes from the PLATFORM pipeline
--                            (jobs, job_drives, applications, round results). The
--                            College Portal keeps its OWN data: the TPO's roster
--                            (public.students, incl. TPO-marked placement) and
--                            manually entered Campus Drives (public.company_drives).
--                            Nothing syncs between the two, so they are reported
--                            side by side and never merged or presented as equal.
--   * Period metrics       = applications by applied_at (a cohort, with its
--                            outcome as of today); registrations / drives by
--                            created_at. Structural counts (drives, companies
--                            engaged, candidates) are all-time.
--   * Active               = the entity produced >= 1 timestamped event in the
--                            period (see admin_actor_events).
--   * NULL bounds          = unbounded ("all time").
-- ============================================================


-- ─────────────────────────────────────────────────────────────────────
-- 0. Columns this migration reads that older migrations only declared
--    in DRAFT files. Idempotent no-ops when they already exist.
-- ─────────────────────────────────────────────────────────────────────
alter table public.colleges add column if not exists city  text;
alter table public.colleges add column if not exists state text;
alter table public.colleges add column if not exists type  text;
alter table public.profiles add column if not exists branch          text;
alter table public.profiles add column if not exists graduation_year int;
-- The college a student belonged to when they applied (filled by the trigger in 1b).
alter table public.applications
  add column if not exists college_id uuid references public.colleges(id) on delete set null;


-- ─────────────────────────────────────────────────────────────────────
-- 1. Role integrity guard on public.profiles
--
--    PostgREST switches the DB role to `anon` / `authenticated` for browser
--    callers; the FastAPI backend uses the service key (role service_role)
--    and migrations / SQL-editor sessions run as a privileged DB role. Only
--    the first two are restricted. Not SECURITY DEFINER on purpose:
--    current_user must be the caller.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is null or new.role not in ('candidate', 'company') then
      raise exception 'Role "%" cannot be self-assigned.', new.role
        using errcode = '42501';
    end if;
  else
    if new.role is distinct from old.role then
      raise exception 'Profile role cannot be changed by the account holder.'
        using errcode = '42501';
    end if;
    -- A College account's tenant link decides which college's data it can
    -- read through RLS (current_college_id()); it is admin-provisioned only.
    if new.role = 'college' and new.college_id is distinct from old.college_id then
      raise exception 'A College account cannot be re-linked to another college.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();


-- ─────────────────────────────────────────────────────────────────────
-- 1b. Historical college of an application
--
--     A candidate can change their college after applying. Attributing history
--     to the CURRENT college would silently move past applications and hires
--     between colleges, so the college is snapshotted when the application is
--     inserted and is immutable afterwards. It is always derived from the
--     student's profile inside the trigger: a client-supplied value is
--     overwritten, so a student cannot mis-attribute their own application.
--
--     Existing rows are deliberately NOT backfilled: that UPDATE would fire the
--     updated_at trigger on every application and destroy the hire timestamps
--     the activity feed relies on. Rows without a snapshot fall back to the
--     student's current college (see admin_app_facts).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.applications_snapshot_college()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.college_id := (select p.college_id from public.profiles p where p.id = new.student_id);
  else
    new.college_id := old.college_id;
  end if;
  return new;
end;
$$;

drop trigger if exists applications_snapshot_college on public.applications;
create trigger applications_snapshot_college
  before insert or update on public.applications
  for each row execute function public.applications_snapshot_college();


-- ─────────────────────────────────────────────────────────────────────
-- 2. Indexes for the Admin Portal's date-range aggregates
--    (existing indexes already cover companies.created_at, jobs.created_at,
--    applications by job/student/company, job_drives by college/job/status).
-- ─────────────────────────────────────────────────────────────────────
create index if not exists idx_profiles_role_created_at        on public.profiles(role, created_at);
create index if not exists idx_applications_applied_at         on public.applications(applied_at);
create index if not exists idx_job_drives_created_at           on public.job_drives(created_at);
create index if not exists idx_ai_interview_sessions_created_at on public.ai_interview_sessions(created_at);


-- ═════════════════════════════════════════════════════════════════════
-- 3. Building blocks. SECURITY INVOKER with no SET clause so the planner can
--    inline them into the calling query (a function with proconfig is an opaque
--    black box with a fixed row estimate). Every object they touch is
--    schema-qualified, so an unpinned search_path is harmless. Only ever called
--    from the definer functions below; EXECUTE is revoked from API roles at the
--    bottom of this file.
-- ═════════════════════════════════════════════════════════════════════

-- Half-open range test; a NULL bound is unbounded, a NULL timestamp is out.
create or replace function public.admin_in_range(p_ts timestamptz, p_from timestamptz, p_to timestamptz)
returns boolean
language sql immutable
as $$
  select p_ts is not null
     and (p_from is null or p_ts >= p_from)
     and (p_to   is null or p_ts <  p_to)
$$;


-- Registered colleges (see header) with their first-account date.
create or replace function public.admin_college_accounts()
returns table (college_id uuid, registered_at timestamptz, accounts bigint)
language sql stable
as $$
  select p.college_id, min(p.created_at), count(*)
    from public.profiles p
   where p.role = 'college' and p.college_id is not null
   group by p.college_id
$$;


-- One row per application submitted in [p_from, p_to) — THE definition of
-- "shortlisted", "selected" and "eliminated" used by every admin metric.
create or replace function public.admin_app_facts(p_from timestamptz, p_to timestamptz)
returns table (
  application_id uuid, student_id uuid, company_id uuid, job_id uuid,
  college_id uuid, drive_id uuid, applied_at timestamptz,
  is_shortlisted boolean, is_selected boolean, is_eliminated boolean
)
language sql stable
as $$
  select a.id, a.student_id, a.company_id, a.job_id,
         coalesce(a.college_id, p.college_id), d.id, a.applied_at,
         (a.status in ('shortlisted', 'in_interview', 'hired') or sl.application_id is not null),
         (a.status = 'hired'),
         (a.status <> 'hired' and (a.status = 'rejected' or rj.application_id is not null))
    from public.applications a
    left join public.profiles  p on p.id = a.student_id
    left join public.job_drives d on d.job_id = a.job_id
                                 and d.college_id = coalesce(a.college_id, p.college_id)
    left join (
      select distinct application_id
        from public.application_round_results
       where status = 'shortlisted'
    ) sl on sl.application_id = a.id
    left join (
      select distinct application_id
        from public.application_round_results
       where status = 'rejected'
    ) rj on rj.application_id = a.id
   where public.admin_in_range(a.applied_at, p_from, p_to)
$$;


-- Every timestamped thing an entity can do, from existing columns only
-- (there is no event log). Used for "active in period" and "last activity".
create or replace function public.admin_actor_events()
returns table (actor_type text, actor_id uuid, occurred_at timestamptz)
language sql stable
as $$
  -- candidates: applying, practising with the AI interviewer
  select 'candidate'::text, a.student_id, a.applied_at from public.applications a
  union all select 'candidate', s.student_id, s.created_at from public.ai_interview_sessions s
  -- companies: posting / editing jobs and drives, deciding a round
  union all select 'company', j.company_id, j.created_at from public.jobs j
  union all select 'company', j.company_id, j.updated_at from public.jobs j
  union all select 'company', j.company_id, d.created_at from public.job_drives d join public.jobs j on j.id = d.job_id
  union all select 'company', j.company_id, d.updated_at from public.job_drives d join public.jobs j on j.id = d.job_id
  union all select 'company', a.company_id, r.decided_at
              from public.application_round_results r join public.applications a on a.id = r.application_id
  -- colleges: drives at the college, its students applying, roster + manual drive edits
  union all select 'college', d.college_id, d.created_at from public.job_drives d
  union all select 'college', d.college_id, d.updated_at from public.job_drives d
  union all select 'college', coalesce(a.college_id, p.college_id), a.applied_at
              from public.applications a join public.profiles p on p.id = a.student_id
             where coalesce(a.college_id, p.college_id) is not null
  union all select 'college', s.college_id, s.created_at from public.students s
  union all select 'college', s.college_id, s.updated_at from public.students s
  union all select 'college', c.college_id, c.created_at from public.company_drives c
  union all select 'college', c.college_id, c.updated_at from public.company_drives c
$$;


-- ═════════════════════════════════════════════════════════════════════
-- 4. Admin metric functions (SECURITY DEFINER, service_role only)
-- ═════════════════════════════════════════════════════════════════════

-- 4.1 Platform overview — raw counts only; ratios are derived in the API.
create or replace function public.admin_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with
  acct as (select * from public.admin_college_accounts()),
  facts as (select * from public.admin_app_facts(p_from, p_to)),
  actors as (
    select actor_type, actor_id,
           bool_or(public.admin_in_range(occurred_at, p_from, p_to)) as active
      from public.admin_actor_events()
     where occurred_at is not null
     group by actor_type, actor_id
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'users',                 (select count(*) from public.profiles),
      'candidates',            (select count(*) from public.profiles where role = 'candidate'),
      'recruiters',            (select count(*) from public.profiles where role = 'company'),
      'college_accounts',      (select count(*) from public.profiles where role = 'college'),
      'admins',                (select count(*) from public.profiles where role = 'admin'),
      'companies',             (select count(*) from public.companies),
      'colleges',              (select count(*) from acct),
      'colleges_in_directory', (select count(*) from public.colleges),
      'drives',                (select count(*) from public.job_drives),
      'drives_live',           (select count(*) from public.job_drives where status = 'live'),
      'drives_draft',          (select count(*) from public.job_drives where status = 'draft'),
      'drives_closed',         (select count(*) from public.job_drives where status = 'closed'),
      -- scope: the totals above cover ALL colleges; this is the part at registered ones
      'drives_at_registered_colleges', (select count(*) from public.job_drives d join acct on acct.college_id = d.college_id),
      'colleges_with_drives',  (select count(distinct d.college_id) from public.job_drives d join acct on acct.college_id = d.college_id),
      'companies_with_drives', (select count(distinct j.company_id) from public.job_drives d join public.jobs j on j.id = d.job_id)
    ),
    'period', jsonb_build_object(
      'new_candidates',      (select count(*) from public.profiles where role = 'candidate' and public.admin_in_range(created_at, p_from, p_to)),
      'new_companies',       (select count(*) from public.companies where public.admin_in_range(created_at, p_from, p_to)),
      'new_colleges',        (select count(*) from acct where public.admin_in_range(registered_at, p_from, p_to)),
      'drives_created',      (select count(*) from public.job_drives where public.admin_in_range(created_at, p_from, p_to)),
      'applications',        (select count(*) from facts),
      'applications_at_registered_colleges', (select count(*) from facts f join acct on acct.college_id = f.college_id),
      'applicants',          (select count(distinct student_id) from facts),
      'shortlisted',         (select count(*) from facts where is_shortlisted),
      'selected',            (select count(*) from facts where is_selected),
      'selected_applicants', (select count(distinct student_id) from facts where is_selected),
      'drives_with_applications', (select count(distinct drive_id) from facts where drive_id is not null),
      'active_candidates',   (select count(*) from actors where actor_type = 'candidate' and active),
      'active_companies',    (select count(*) from actors a join public.companies c on c.id = a.actor_id where a.actor_type = 'company' and a.active),
      'active_colleges',     (select count(*) from actors a join acct on acct.college_id = a.actor_id where a.actor_type = 'college' and a.active)
    )
  )
$$;


-- 4.2 Time series for the overview charts. Buckets are in the caller's
--     time zone (an unusable zone name falls back to UTC) and zero-filled so a
--     quiet day is a visible 0, not a missing point.
create or replace function public.admin_trends(
  p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text default 'UTC'
)
returns table (
  bucket timestamptz,
  new_candidates bigint, new_companies bigint, new_colleges bigint,
  drives_created bigint, applications bigint, shortlisted bigint, selected bigint
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_b  text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'month' end;
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_lo timestamptz;
  v_hi timestamptz := coalesce(p_to, now());
begin
  begin
    perform now() at time zone v_tz;   -- validates the zone name
  exception when others then
    v_tz := 'UTC';
  end;

  v_lo := coalesce(p_from, (select least(
            (select min(created_at) from public.profiles),
            (select min(created_at) from public.companies),
            (select min(applied_at) from public.applications),
            (select min(created_at) from public.job_drives))));

  return query
  with
  series as (
    select g as bkt
      from generate_series(
             date_trunc(v_b, v_lo at time zone v_tz),
             date_trunc(v_b, (v_hi - interval '1 microsecond') at time zone v_tz),
             ('1 ' || v_b)::interval
           ) g
  ),
  cand as (
    select date_trunc(v_b, p.created_at at time zone v_tz) as bkt, count(*) as n
      from public.profiles p
     where p.role = 'candidate' and public.admin_in_range(p.created_at, p_from, p_to)
     group by 1
  ),
  comp as (
    select date_trunc(v_b, c.created_at at time zone v_tz) as bkt, count(*) as n
      from public.companies c
     where public.admin_in_range(c.created_at, p_from, p_to)
     group by 1
  ),
  coll as (
    select date_trunc(v_b, a.registered_at at time zone v_tz) as bkt, count(*) as n
      from public.admin_college_accounts() a
     where public.admin_in_range(a.registered_at, p_from, p_to)
     group by 1
  ),
  drv as (
    select date_trunc(v_b, d.created_at at time zone v_tz) as bkt, count(*) as n
      from public.job_drives d
     where public.admin_in_range(d.created_at, p_from, p_to)
     group by 1
  ),
  app as (
    select date_trunc(v_b, f.applied_at at time zone v_tz) as bkt,
           count(*) as n,
           count(*) filter (where f.is_shortlisted) as sl,
           count(*) filter (where f.is_selected) as sel
      from public.admin_app_facts(p_from, p_to) f
     group by 1
  )
  select (s.bkt at time zone v_tz),
         coalesce(cand.n, 0), coalesce(comp.n, 0), coalesce(coll.n, 0),
         coalesce(drv.n, 0), coalesce(app.n, 0), coalesce(app.sl, 0), coalesce(app.sel, 0)
    from series s
    left join cand on cand.bkt = s.bkt
    left join comp on comp.bkt = s.bkt
    left join coll on coll.bkt = s.bkt
    left join drv  on drv.bkt  = s.bkt
    left join app  on app.bkt  = s.bkt
   order by s.bkt;
end;
$$;


-- 4.3 Recent platform activity, from existing timestamps only.
create or replace function public.admin_activity(p_limit int default 20)
returns table (kind text, occurred_at timestamptz, subject text, detail text)
language sql stable security definer
set search_path = public
as $$
  with ev as (
    (select 'candidate_registered'::text as kind, p.created_at as ts,
            coalesce(nullif(p.name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'A candidate') as subject,
            null::text as detail
       from public.profiles p where p.role = 'candidate' and p.created_at is not null
      order by p.created_at desc limit greatest(p_limit, 0))
    union all
    (select 'company_registered', c.created_at, c.name, c.industry
       from public.companies c order by c.created_at desc limit greatest(p_limit, 0))
    union all
    (select 'college_registered', a.registered_at, co.name, null
       from public.admin_college_accounts() a join public.colleges co on co.id = a.college_id
      order by a.registered_at desc limit greatest(p_limit, 0))
    union all
    (select 'drive_created', d.created_at, cmp.name, j.title || ' @ ' || col.name
       from public.job_drives d
       join public.jobs j on j.id = d.job_id
       join public.companies cmp on cmp.id = j.company_id
       join public.colleges col on col.id = d.college_id
      order by d.created_at desc limit greatest(p_limit, 0))
    union all
    (select 'application_submitted', a.applied_at, cmp.name, j.title
       from public.applications a
       join public.jobs j on j.id = a.job_id
       join public.companies cmp on cmp.id = a.company_id
      order by a.applied_at desc limit greatest(p_limit, 0))
    union all
    -- No dedicated hire timestamp exists: updated_at of a 'hired' application.
    (select 'candidate_selected', a.updated_at, cmp.name, j.title
       from public.applications a
       join public.jobs j on j.id = a.job_id
       join public.companies cmp on cmp.id = a.company_id
      where a.status = 'hired'
      order by a.updated_at desc limit greatest(p_limit, 0))
  )
  select kind, ts, subject, detail from ev order by ts desc limit greatest(p_limit, 0)
$$;


-- NOTE on the list functions below (4.4-4.8): they are plpgsql with
-- plan_cache_mode = force_custom_plan, on purpose. Their optional filters are
-- written `p_x is null or col = p_x`; planned generically, Postgres cannot see
-- that p_x is NULL, estimates ~1 row and picks nested loops (measured: 21 s vs
-- 0.14 s at 30k candidates). A custom plan per call folds the filters away.

-- 4.4 Colleges table (also serves the single-college detail via p_college_id).
--     p_registration: 'registered' (has a College account) | 'directory'
--     (no account yet) | 'all'.  p_activity: 'active' | 'inactive' | null.
create or replace function public.admin_list_colleges(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_registration text default 'registered',
  p_activity text default null, p_college_id uuid default null,
  p_sort text default 'applications', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0,
  -- Admin permission scoping (app/services/admin/permissions.py): the union
  -- of every college a caller's grants for this module permit, when they
  -- hold more than one scoped grant. NULL (the default) = unrestricted by
  -- this dimension — every existing caller that doesn't pass it is unaffected.
  p_college_ids uuid[] default null
)
returns table (
  college_id uuid, name text, city text, state text, college_type text,
  has_account boolean, registered_at timestamptz,
  candidates bigint, roster_students bigint, roster_placed bigint, portal_drives bigint,
  companies bigint, drives bigint,
  applications bigint, applicants bigint, shortlisted bigint, selected bigint, selected_applicants bigint,
  last_activity timestamptz, is_active boolean, total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  acct as (select * from public.admin_college_accounts()),
  fagg as (
    select f.college_id,
           count(*) as applications,
           count(distinct f.student_id) as applicants,
           count(*) filter (where f.is_shortlisted) as shortlisted,
           count(*) filter (where f.is_selected) as selected,
           count(distinct f.student_id) filter (where f.is_selected) as selected_applicants
      from public.admin_app_facts(p_from, p_to) f
     where f.college_id is not null
     group by f.college_id
  ),
  cand as (
    select college_id, count(*) as n from public.profiles
     where role = 'candidate' and college_id is not null group by college_id
  ),
  ros as (
    select college_id, count(*) as n, count(*) filter (where placement_status = 'placed') as placed
      from public.students group by college_id
  ),
  dr as (
    select d.college_id, count(*) as drives, count(distinct j.company_id) as companies
      from public.job_drives d join public.jobs j on j.id = d.job_id
     group by d.college_id
  ),
  pd as (   -- College Portal "Campus Drives": manual TPO records, NOT platform drives
    select college_id, count(*) as n from public.company_drives group by college_id
  ),
  act as (
    select actor_id, max(occurred_at) as last_ts,
           bool_or(public.admin_in_range(occurred_at, p_from, p_to)) as active
      from public.admin_actor_events()
     where actor_type = 'college' and occurred_at is not null
     group by actor_id
  ),
  base as (
    select c.id as college_id, c.name, c.city, c.state, c.type as college_type,
           (acct.college_id is not null) as has_account, acct.registered_at,
           coalesce(cand.n, 0) as candidates,
           coalesce(ros.n, 0) as roster_students, coalesce(ros.placed, 0) as roster_placed,
           coalesce(pd.n, 0) as portal_drives,
           coalesce(dr.companies, 0) as companies, coalesce(dr.drives, 0) as drives,
           coalesce(fagg.applications, 0) as applications, coalesce(fagg.applicants, 0) as applicants,
           coalesce(fagg.shortlisted, 0) as shortlisted, coalesce(fagg.selected, 0) as selected,
           coalesce(fagg.selected_applicants, 0) as selected_applicants,
           act.last_ts as last_activity, coalesce(act.active, false) as is_active
      from public.colleges c
      left join acct on acct.college_id = c.id
      left join fagg on fagg.college_id = c.id
      left join cand on cand.college_id = c.id
      left join ros  on ros.college_id  = c.id
      left join dr   on dr.college_id   = c.id
      left join pd   on pd.college_id   = c.id
      left join act  on act.actor_id    = c.id
     where (p_college_id is null or c.id = p_college_id)
       and (p_college_ids is null or c.id = any(p_college_ids))
       and (p_search is null or p_search = ''
            or strpos(lower(c.name), lower(p_search)) > 0
            or strpos(lower(coalesce(c.city, '')), lower(p_search)) > 0)
       and case p_registration
             when 'registered' then acct.college_id is not null
             when 'directory'  then acct.college_id is null
             else true end
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'candidates'   then b.candidates::numeric
             when 'drives'       then b.drives::numeric
             when 'companies'    then b.companies::numeric
             when 'applications' then b.applications::numeric
             when 'shortlisted'  then b.shortlisted::numeric
             when 'selected'     then b.selected::numeric
             when 'placement_rate' then b.selected_applicants::numeric / nullif(b.applicants, 0)
             when 'registered_at'  then extract(epoch from b.registered_at)
             when 'last_activity'  then extract(epoch from b.last_activity)
           end as sort_num,
           case p_sort
             when 'name' then lower(b.name)
             when 'city' then lower(coalesce(b.city, ''))
           end as sort_txt
      from base b
     where case p_activity
             when 'active'   then b.is_active
             when 'inactive' then not b.is_active
             else true end
  )
  select k.college_id, k.name, k.city, k.state, k.college_type, k.has_account, k.registered_at,
         k.candidates, k.roster_students, k.roster_placed, k.portal_drives, k.companies, k.drives,
         k.applications, k.applicants, k.shortlisted, k.selected, k.selected_applicants,
         k.last_activity, k.is_active, count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.name asc, k.college_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 4.5 Companies table (also serves the single-company detail via p_company_id).
create or replace function public.admin_list_companies(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_activity text default null, p_verified boolean default null,
  p_company_id uuid default null,
  p_sort text default 'applications', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0,
  -- Admin permission scoping — see admin_list_colleges' p_college_ids.
  p_company_ids uuid[] default null
)
returns table (
  company_id uuid, name text, industry text, size text, is_verified boolean,
  registered_at timestamptz, owner_email text,
  jobs bigint, drives bigint, colleges bigint,
  applications bigint, applicants bigint, shortlisted bigint, selected bigint, selected_applicants bigint,
  last_activity timestamptz, is_active boolean, total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  fagg as (
    select f.company_id,
           count(*) as applications,
           count(distinct f.student_id) as applicants,
           count(*) filter (where f.is_shortlisted) as shortlisted,
           count(*) filter (where f.is_selected) as selected,
           count(distinct f.student_id) filter (where f.is_selected) as selected_applicants
      from public.admin_app_facts(p_from, p_to) f
     group by f.company_id
  ),
  jb as (select company_id, count(*) as n from public.jobs group by company_id),
  dr as (
    select j.company_id, count(*) as drives, count(distinct d.college_id) as colleges
      from public.job_drives d join public.jobs j on j.id = d.job_id
     group by j.company_id
  ),
  act as (
    select actor_id, max(occurred_at) as last_ts,
           bool_or(public.admin_in_range(occurred_at, p_from, p_to)) as active
      from public.admin_actor_events()
     where actor_type = 'company' and occurred_at is not null
     group by actor_id
  ),
  base as (
    select c.id as company_id, c.name, c.industry, c.size, c.is_verified,
           c.created_at as registered_at, o.email as owner_email,
           coalesce(jb.n, 0) as jobs, coalesce(dr.drives, 0) as drives, coalesce(dr.colleges, 0) as colleges,
           coalesce(fagg.applications, 0) as applications, coalesce(fagg.applicants, 0) as applicants,
           coalesce(fagg.shortlisted, 0) as shortlisted, coalesce(fagg.selected, 0) as selected,
           coalesce(fagg.selected_applicants, 0) as selected_applicants,
           act.last_ts as last_activity, coalesce(act.active, false) as is_active
      from public.companies c
      left join public.profiles o on o.id = c.owner_id
      left join fagg on fagg.company_id = c.id
      left join jb   on jb.company_id   = c.id
      left join dr   on dr.company_id   = c.id
      left join act  on act.actor_id    = c.id
     where (p_company_id is null or c.id = p_company_id)
       and (p_company_ids is null or c.id = any(p_company_ids))
       and (p_verified is null or c.is_verified = p_verified)
       and (p_search is null or p_search = ''
            or strpos(lower(c.name), lower(p_search)) > 0
            or strpos(lower(coalesce(c.industry, '')), lower(p_search)) > 0)
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'jobs'         then b.jobs::numeric
             when 'drives'       then b.drives::numeric
             when 'colleges'     then b.colleges::numeric
             when 'applications' then b.applications::numeric
             when 'shortlisted'  then b.shortlisted::numeric
             when 'selected'     then b.selected::numeric
             when 'registered_at' then extract(epoch from b.registered_at)
             when 'last_activity' then extract(epoch from b.last_activity)
           end as sort_num,
           case p_sort
             when 'name'     then lower(b.name)
             when 'industry' then lower(coalesce(b.industry, ''))
           end as sort_txt
      from base b
     where case p_activity
             when 'active'   then b.is_active
             when 'inactive' then not b.is_active
             else true end
  )
  select k.company_id, k.name, k.industry, k.size, k.is_verified, k.registered_at, k.owner_email,
         k.jobs, k.drives, k.colleges, k.applications, k.applicants, k.shortlisted, k.selected,
         k.selected_applicants, k.last_activity, k.is_active, count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.name asc, k.company_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 4.6 Candidates table. Every count / status is computed over the SAME fact
--     set: applications in [p_from, p_to) narrowed by the company / drive
--     filters, so a row can never disagree with itself.
--     p_status: not_applied | applied | in_process | rejected | placed
--     (precedence in the header: a candidate whose only shortlisted
--     applications were later rejected is 'rejected', never 'in_process').
create or replace function public.admin_list_candidates(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_college_id uuid default null,
  p_company_id uuid default null, p_drive_id uuid default null,
  p_status text default null, p_registered_in_range boolean default false,
  p_sort text default 'registered_at', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0,
  -- Admin permission scoping — see admin_list_colleges' p_college_ids.
  p_college_ids uuid[] default null
)
returns table (
  candidate_id uuid, name text, email text,
  college_id uuid, college_name text, branch text, graduation_year int,
  registered_at timestamptz,
  applications bigint, shortlisted bigint, selected bigint,
  placement_status text, total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  fagg as (
    select f.student_id,
           count(*) as applications,
           count(*) filter (where f.is_shortlisted) as shortlisted,
           count(*) filter (where f.is_selected) as selected,
           count(*) filter (where f.is_shortlisted and not f.is_eliminated) as live_shortlisted,
           count(*) filter (where not f.is_shortlisted and not f.is_eliminated) as undecided
      from public.admin_app_facts(p_from, p_to) f
     where (p_company_id is null or f.company_id = p_company_id)
       and (p_drive_id   is null or f.drive_id   = p_drive_id)
     group by f.student_id
  ),
  base as (
    select p.id as candidate_id,
           coalesce(nullif(p.name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email) as name,
           p.email, p.college_id, c.name as college_name, p.branch, p.graduation_year,
           p.created_at as registered_at,
           coalesce(fagg.applications, 0) as applications,
           coalesce(fagg.shortlisted, 0) as shortlisted,
           coalesce(fagg.selected, 0) as selected,
           case when coalesce(fagg.selected, 0) > 0 then 'placed'
                when coalesce(fagg.live_shortlisted, 0) > 0 then 'in_process'
                when coalesce(fagg.undecided, 0) > 0 then 'applied'
                when coalesce(fagg.applications, 0) > 0 then 'rejected'
                else 'not_applied' end as placement_status
      from public.profiles p
      left join public.colleges c on c.id = p.college_id
      left join fagg on fagg.student_id = p.id
     where p.role = 'candidate'
       and (p_college_id is null or p.college_id = p_college_id)
       and (p_college_ids is null or p.college_id = any(p_college_ids))
       and (p_search is null or p_search = ''
            or strpos(lower(coalesce(p.name, '')), lower(p_search)) > 0
            or strpos(lower(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), lower(p_search)) > 0
            or strpos(lower(coalesce(p.email, '')), lower(p_search)) > 0)
       and (not coalesce(p_registered_in_range, false) or public.admin_in_range(p.created_at, p_from, p_to))
       and ((p_company_id is null and p_drive_id is null) or coalesce(fagg.applications, 0) > 0)
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'applications'  then b.applications::numeric
             when 'shortlisted'   then b.shortlisted::numeric
             when 'selected'      then b.selected::numeric
             when 'registered_at' then extract(epoch from b.registered_at)
           end as sort_num,
           case p_sort
             when 'name'    then lower(b.name)
             when 'college' then lower(coalesce(b.college_name, ''))
           end as sort_txt
      from base b
     where p_status is null or p_status = '' or b.placement_status = p_status
  )
  select k.candidate_id, k.name, k.email, k.college_id, k.college_name, k.branch, k.graduation_year,
         k.registered_at, k.applications, k.shortlisted, k.selected, k.placement_status,
         count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.registered_at desc, k.candidate_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 4.7 Drive performance. Lists drives created in the range OR that received
--     applications in it; funnel counts are the in-range cohort.
create or replace function public.admin_list_drives(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_status text default null,
  p_company_id uuid default null, p_college_id uuid default null,
  p_sort text default 'applications', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0,
  -- Admin permission scoping (see admin_list_colleges' p_college_ids). Drives
  -- are scopable by EITHER dimension, so when a caller's grants cover both
  -- (e.g. drives.view at College A and drives.view at Company X), a drive
  -- matching either counts — not just one that matches both.
  p_college_ids uuid[] default null, p_company_ids uuid[] default null
)
returns table (
  drive_id uuid, job_id uuid, job_title text,
  company_id uuid, company_name text, college_id uuid, college_name text,
  status text, is_on_campus boolean, employment_type text,
  apply_deadline timestamptz, created_at timestamptz,
  applications bigint, applicants bigint, shortlisted bigint, selected bigint,
  total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  fagg as (
    select f.drive_id,
           count(*) as applications,
           count(distinct f.student_id) as applicants,
           count(*) filter (where f.is_shortlisted) as shortlisted,
           count(*) filter (where f.is_selected) as selected
      from public.admin_app_facts(p_from, p_to) f
     where f.drive_id is not null
     group by f.drive_id
  ),
  base as (
    select d.id as drive_id, d.job_id, j.title as job_title,
           j.company_id, cmp.name as company_name, d.college_id, col.name as college_name,
           d.status, d.is_on_campus, j.employment_type,
           d.apply_deadline, d.created_at,
           coalesce(fagg.applications, 0) as applications, coalesce(fagg.applicants, 0) as applicants,
           coalesce(fagg.shortlisted, 0) as shortlisted, coalesce(fagg.selected, 0) as selected
      from public.job_drives d
      join public.jobs j on j.id = d.job_id
      join public.companies cmp on cmp.id = j.company_id
      join public.colleges col on col.id = d.college_id
      left join fagg on fagg.drive_id = d.id
     where (public.admin_in_range(d.created_at, p_from, p_to) or coalesce(fagg.applications, 0) > 0)
       and (p_status is null or p_status = '' or d.status = p_status)
       and (p_company_id is null or j.company_id = p_company_id)
       and (p_college_id is null or d.college_id = p_college_id)
       and (
             (p_college_ids is null and p_company_ids is null)
          or (p_college_ids is not null and d.college_id = any(p_college_ids))
          or (p_company_ids is not null and j.company_id = any(p_company_ids))
           )
       and (p_search is null or p_search = ''
            or strpos(lower(j.title), lower(p_search)) > 0
            or strpos(lower(cmp.name), lower(p_search)) > 0
            or strpos(lower(col.name), lower(p_search)) > 0)
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'applications' then b.applications::numeric
             when 'applicants'   then b.applicants::numeric
             when 'shortlisted'  then b.shortlisted::numeric
             when 'selected'     then b.selected::numeric
             when 'created_at'   then extract(epoch from b.created_at)
             when 'apply_deadline' then extract(epoch from b.apply_deadline)
           end as sort_num,
           case p_sort
             when 'job'     then lower(b.job_title)
             when 'company' then lower(b.company_name)
             when 'college' then lower(b.college_name)
           end as sort_txt
      from base b
  )
  select k.drive_id, k.job_id, k.job_title, k.company_id, k.company_name, k.college_id, k.college_name,
         k.status, k.is_on_campus, k.employment_type, k.apply_deadline, k.created_at,
         k.applications, k.applicants, k.shortlisted, k.selected, count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.created_at desc, k.drive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 4.8 Company <-> College partnerships. A pair exists ONLY where a job drive
--     (job x college) exists — the platform's actual relationship record.
--     Drive count is all-time; funnel counts are the in-range cohort.
create or replace function public.admin_list_partnerships(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_company_id uuid default null, p_college_id uuid default null,
  p_sort text default 'applications', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0,
  -- Admin permission scoping — see admin_list_drives' p_college_ids / p_company_ids.
  p_college_ids uuid[] default null, p_company_ids uuid[] default null
)
returns table (
  company_id uuid, company_name text, college_id uuid, college_name text,
  drives bigint, first_drive_at timestamptz, last_drive_at timestamptz,
  applications bigint, applicants bigint, shortlisted bigint, selected bigint,
  total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  pairs as (
    select j.company_id, d.college_id, count(*) as drives,
           min(d.created_at) as first_drive_at, max(d.created_at) as last_drive_at
      from public.job_drives d join public.jobs j on j.id = d.job_id
     group by j.company_id, d.college_id
  ),
  fagg as (
    select f.company_id, f.college_id,
           count(*) as applications,
           count(distinct f.student_id) as applicants,
           count(*) filter (where f.is_shortlisted) as shortlisted,
           count(*) filter (where f.is_selected) as selected
      from public.admin_app_facts(p_from, p_to) f
     where f.college_id is not null
     group by f.company_id, f.college_id
  ),
  base as (
    select pr.company_id, cmp.name as company_name, pr.college_id, col.name as college_name,
           pr.drives, pr.first_drive_at, pr.last_drive_at,
           coalesce(fagg.applications, 0) as applications, coalesce(fagg.applicants, 0) as applicants,
           coalesce(fagg.shortlisted, 0) as shortlisted, coalesce(fagg.selected, 0) as selected
      from pairs pr
      join public.companies cmp on cmp.id = pr.company_id
      join public.colleges  col on col.id = pr.college_id
      left join fagg on fagg.company_id = pr.company_id and fagg.college_id = pr.college_id
     where (p_company_id is null or pr.company_id = p_company_id)
       and (p_college_id is null or pr.college_id = p_college_id)
       and (
             (p_college_ids is null and p_company_ids is null)
          or (p_college_ids is not null and pr.college_id = any(p_college_ids))
          or (p_company_ids is not null and pr.company_id = any(p_company_ids))
           )
       and (p_search is null or p_search = ''
            or strpos(lower(cmp.name), lower(p_search)) > 0
            or strpos(lower(col.name), lower(p_search)) > 0)
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'drives'       then b.drives::numeric
             when 'applications' then b.applications::numeric
             when 'shortlisted'  then b.shortlisted::numeric
             when 'selected'     then b.selected::numeric
             when 'last_drive_at' then extract(epoch from b.last_drive_at)
           end as sort_num,
           case p_sort
             when 'company' then lower(b.company_name)
             when 'college' then lower(b.college_name)
           end as sort_txt
      from base b
  )
  select k.company_id, k.company_name, k.college_id, k.college_name, k.drives,
         k.first_drive_at, k.last_drive_at, k.applications, k.applicants, k.shortlisted, k.selected,
         count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.company_name asc, k.college_name asc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 4.9 CTC statistics. Only INR, non-internship roles that state a CTC
--     (jobs.ctc_min / ctc_max are the ADVERTISED range — no actual offered
--     salary is stored). 'posted' = roles created in range; 'filled' = the
--     role of each selected application in range. Interns use a stipend and
--     other currencies are not converted, so both are excluded and counted.
create or replace function public.admin_ctc_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with
  j as (
    select id, created_at,
           (coalesce(ctc_min, ctc_max) + coalesce(ctc_max, ctc_min)) / 2 as mid,
           coalesce(ctc_min, ctc_max) as lo, coalesce(ctc_max, ctc_min) as hi
      from public.jobs
     where employment_type <> 'intern'
       and (ctc_min is not null or ctc_max is not null)
       and coalesce(ctc_currency, 'INR') = 'INR'
  ),
  posted as (select * from j where public.admin_in_range(created_at, p_from, p_to)),
  filled as (
    select j.* from public.admin_app_facts(p_from, p_to) f join j on j.id = f.job_id where f.is_selected
  ),
  buckets(ord, label, blo, bhi) as (values
    (1, 'Under 3 LPA', 0::numeric, 300000::numeric),
    (2, '3-6 LPA',     300000, 600000),
    (3, '6-10 LPA',    600000, 1000000),
    (4, '10-15 LPA',   1000000, 1500000),
    (5, '15-25 LPA',   1500000, 2500000),
    (6, '25+ LPA',     2500000, 1e15)
  )
  select jsonb_build_object(
    'currency', 'INR',
    'excluded_other_currency', (
      select count(*) from public.jobs
       where employment_type <> 'intern'
         and (ctc_min is not null or ctc_max is not null)
         and coalesce(ctc_currency, 'INR') <> 'INR'),
    'posted', jsonb_build_object(
      'roles', (select count(*) from posted),
      'average', (select round(avg(mid)) from posted),
      'highest', (select max(hi) from posted),
      'lowest',  (select min(lo) from posted),
      'distribution', (
        select jsonb_agg(jsonb_build_object('bucket', b.label,
                 'count', (select count(*) from posted x where x.mid >= b.blo and x.mid < b.bhi)) order by b.ord)
          from buckets b)
    ),
    'filled', jsonb_build_object(
      'roles', (select count(*) from filled),
      'average', (select round(avg(mid)) from filled),
      'highest', (select max(hi) from filled),
      'lowest',  (select min(lo) from filled),
      'distribution', (
        select jsonb_agg(jsonb_build_object('bucket', b.label,
                 'count', (select count(*) from filled x where x.mid >= b.blo and x.mid < b.bhi)) order by b.ord)
          from buckets b)
    )
  )
$$;


-- ═════════════════════════════════════════════════════════════════════
-- 6. Platform Control Center upgrade — user access control, a central
--    event/audit log, and the analytics/alerts/search it powers.
--    Additive to everything above; idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════

-- 6.0 Block / suspend a user account.
--     "Currently blocked" is ALWAYS computed — blocked_permanent, or
--     blocked_until in the future — never a stored status flag, so a
--     temporary block expires by itself with no scheduled job. blocked_at /
--     blocked_by / blocked_reason describe the block that is (or, once a
--     temporary one has passed, most recently was) in effect; unblocking
--     clears all five. Who did what and why over time lives in
--     admin_events (6.1), not here.
alter table public.profiles add column if not exists blocked_permanent boolean not null default false;
alter table public.profiles add column if not exists blocked_until     timestamptz;
alter table public.profiles add column if not exists blocked_at        timestamptz;
alter table public.profiles add column if not exists blocked_by        uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists blocked_reason    text;

create index if not exists idx_profiles_blocked
  on public.profiles(blocked_permanent, blocked_until)
  where blocked_permanent or blocked_until is not null;

-- Extend the existing role/college guard so the block columns get the same
-- protection: only the backend (service_role) or a direct DB session can
-- write them, never a browser holding an anon/authenticated JWT (admin
-- included) via PostgREST. Same function, same trigger — no new object.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is null or new.role not in ('candidate', 'company') then
      raise exception 'Role "%" cannot be self-assigned.', new.role
        using errcode = '42501';
    end if;
    if new.blocked_permanent or new.blocked_until is not null or new.blocked_by is not null then
      raise exception 'An account cannot set its own block state.'
        using errcode = '42501';
    end if;
  else
    if new.role is distinct from old.role then
      raise exception 'Profile role cannot be changed by the account holder.'
        using errcode = '42501';
    end if;
    -- A College account's tenant link decides which college's data it can
    -- read through RLS (current_college_id()); it is admin-provisioned only.
    if new.role = 'college' and new.college_id is distinct from old.college_id then
      raise exception 'A College account cannot be re-linked to another college.'
        using errcode = '42501';
    end if;
    if new.blocked_permanent is distinct from old.blocked_permanent
       or new.blocked_until  is distinct from old.blocked_until
       or new.blocked_by     is distinct from old.blocked_by
       or new.blocked_reason is distinct from old.blocked_reason
       or new.blocked_at     is distinct from old.blocked_at then
      raise exception 'Block state can only be changed by an Admin.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
-- (trigger already exists from 1.; CREATE OR REPLACE above is enough)


-- ─────────────────────────────────────────────────────────────────────
-- 6.1 Central event/audit log.
--     Populated by the backend for actions that have no existing timestamp
--     trail to derive from: sign-ins (incl. attempts blocked by 6.0),
--     account provisioning, blocking/unblocking, CSV exports and generated
--     reports. Registrations, applications, drives etc. already have a
--     timestamp column each (see admin_actor_events, 3.) and are NOT
--     duplicated into this table — admin_activity_feed (6.3) merges both
--     into one read model instead of keeping two competing event systems.
--     result='failure' rows (e.g. a blocked account's login attempt) are the
--     Audit Log's evidence trail; they are excluded from the friendly Live
--     Activity feed (6.3) to keep that one about what actually happened.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.admin_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  actor_label text,
  target_type text,
  target_id uuid,
  target_label text,
  metadata jsonb not null default '{}'::jsonb,
  result text not null default 'success' check (result in ('success', 'failure')),
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_events_created_at   on public.admin_events(created_at desc);
create index if not exists idx_admin_events_type_created  on public.admin_events(event_type, created_at desc);
create index if not exists idx_admin_events_actor         on public.admin_events(actor_user_id, created_at desc);
create index if not exists idx_admin_events_target        on public.admin_events(target_type, target_id, created_at desc);

alter table public.admin_events enable row level security;
-- No policies for anon/authenticated: default-deny, so a browser can never
-- read or write the audit trail directly. service_role bypasses RLS (Supabase
-- grants it BYPASSRLS), so the backend's db_client is unaffected.


-- 6.2 Users & Access — every profiles row plus its computed block status and
--     best-known last-activity (candidate: their own events; company/college:
--     their organisation's events, the account itself has no separate
--     identity in admin_actor_events; every role: admin_events, which is
--     also the only activity signal an Admin account has, since admins
--     don't apply/post/run drives).
create or replace function public.admin_list_users(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_role text default null, p_status text default null,
  p_user_id uuid default null,
  p_sort text default 'created_at', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0
)
returns table (
  user_id uuid, email text, name text, role text,
  college_id uuid, college_name text, company_id uuid, company_name text,
  created_at timestamptz, onboarded boolean,
  is_blocked boolean, blocked_permanent boolean, blocked_until timestamptz,
  blocked_at timestamptz, blocked_reason text, blocked_by_email text,
  last_activity timestamptz, total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with
  cand_act as (
    select actor_id, max(occurred_at) as ts from public.admin_actor_events()
     where actor_type = 'candidate' group by actor_id
  ),
  comp_act as (
    select actor_id, max(occurred_at) as ts from public.admin_actor_events()
     where actor_type = 'company' group by actor_id
  ),
  coll_act as (
    select actor_id, max(occurred_at) as ts from public.admin_actor_events()
     where actor_type = 'college' group by actor_id
  ),
  ev_act as (
    select actor_user_id, max(created_at) as ts from public.admin_events
     where actor_user_id is not null group by actor_user_id
  ),
  base as (
    select p.id as user_id, p.email,
           coalesce(nullif(p.name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email) as name,
           p.role, p.college_id, col.name as college_name, cmp.id as company_id, cmp.name as company_name,
           p.created_at, coalesce(p.onboarded, false) as onboarded,
           (p.blocked_permanent or (p.blocked_until is not null and p.blocked_until > now())) as is_blocked,
           p.blocked_permanent, p.blocked_until, p.blocked_at, p.blocked_reason, blocker.email as blocked_by_email,
           greatest(ca.ts, cpa.ts, cla.ts, ea.ts) as last_activity
      from public.profiles p
      left join public.colleges col on col.id = p.college_id
      left join public.companies cmp on cmp.owner_id = p.id
      left join public.profiles blocker on blocker.id = p.blocked_by
      left join cand_act ca on p.role = 'candidate' and ca.actor_id = p.id
      left join comp_act cpa on p.role = 'company' and cpa.actor_id = cmp.id
      left join coll_act cla on p.role = 'college' and cla.actor_id = p.college_id
      left join ev_act ea on ea.actor_user_id = p.id
     where (p_user_id is null or p.id = p_user_id)
       and (p_role is null or p_role = '' or p.role = p_role)
       and public.admin_in_range(p.created_at, p_from, p_to)
       and (p_search is null or p_search = ''
            or strpos(lower(p.email), lower(p_search)) > 0
            or strpos(lower(coalesce(p.name, '')), lower(p_search)) > 0
            or strpos(lower(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))), lower(p_search)) > 0)
  ),
  keyed as (
    select b.*,
           case p_sort
             when 'created_at'    then extract(epoch from b.created_at)
             when 'last_activity' then extract(epoch from b.last_activity)
           end as sort_num,
           case p_sort
             when 'name'  then lower(b.name)
             when 'email' then lower(b.email)
             when 'role'  then b.role
           end as sort_txt
      from base b
     where case p_status
             when 'blocked' then b.is_blocked
             when 'active'  then not b.is_blocked
             else true end
  )
  select k.user_id, k.email, k.name, k.role, k.college_id, k.college_name, k.company_id, k.company_name,
         k.created_at, k.onboarded, k.is_blocked, k.blocked_permanent, k.blocked_until,
         k.blocked_at, k.blocked_reason, k.blocked_by_email, k.last_activity,
         count(*) over () as total_count
    from keyed k
   order by
     case when p_dir = 'asc' then k.sort_num end asc  nulls last,
     case when p_dir <> 'asc' then k.sort_num end desc nulls last,
     case when p_dir = 'asc' then k.sort_txt end asc,
     case when p_dir <> 'asc' then k.sort_txt end desc,
     k.created_at desc, k.user_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 6.3 Live Activity — the friendly feed. Same derived kinds as the original
--     admin_activity (kept AS IS below, unchanged, for the Overview's compact
--     panel) plus successful admin_events, in one keyset-paginated stream
--     (p_before = the oldest occurred_at already shown; pass it back for the
--     next page). id is synthesised (derived rows have no row of their own)
--     but stable across calls, for React keys and as a paging tie-breaker.
create or replace function public.admin_activity_feed(
  p_from timestamptz default null, p_to timestamptz default null,
  p_before timestamptz default null, p_kind text default null,
  p_limit int default 30
)
returns table (id uuid, kind text, occurred_at timestamptz, subject text, detail text, actor_role text)
language sql stable security definer
set search_path = public
as $$
  with ev as (
    (select 'candidate_registered'::text as kind, p.created_at as ts,
            coalesce(nullif(p.name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'A candidate') as subject,
            null::text as detail, 'candidate'::text as actor_role
       from public.profiles p where p.role = 'candidate' and p.created_at is not null)
    union all
    (select 'company_registered', c.created_at, c.name, c.industry, 'company'::text
       from public.companies c)
    union all
    (select 'college_registered', a.registered_at, co.name, null, 'college'::text
       from public.admin_college_accounts() a join public.colleges co on co.id = a.college_id)
    union all
    (select 'drive_created', d.created_at, cmp.name, j.title || ' @ ' || col.name, 'company'::text
       from public.job_drives d
       join public.jobs j on j.id = d.job_id
       join public.companies cmp on cmp.id = j.company_id
       join public.colleges col on col.id = d.college_id)
    union all
    (select 'application_submitted', a.applied_at, cmp.name, j.title, 'candidate'::text
       from public.applications a
       join public.jobs j on j.id = a.job_id
       join public.companies cmp on cmp.id = a.company_id)
    union all
    -- No dedicated hire timestamp exists: updated_at of a 'hired' application.
    (select 'candidate_selected', a.updated_at, cmp.name, j.title, 'company'::text
       from public.applications a
       join public.jobs j on j.id = a.job_id
       join public.companies cmp on cmp.id = a.company_id
      where a.status = 'hired')
    union all
    (select e.event_type, e.created_at, coalesce(e.actor_label, initcap(coalesce(e.actor_role, 'System'))),
            coalesce(e.target_label, e.metadata->>'summary'), e.actor_role
       from public.admin_events e where e.result = 'success')
  )
  select (md5(kind || ts::text || subject || coalesce(detail, '')))::uuid, kind, ts, subject, detail, actor_role
    from ev
   where ts is not null
     and public.admin_in_range(ts, p_from, p_to)
     and (p_before is null or ts < p_before)
     and (p_kind is null or p_kind = '' or kind = p_kind)
   order by ts desc
   limit greatest(p_limit, 0)
$$;


-- 6.4 Audit Log — the raw, unfiltered admin_events trail (unlike 6.3, includes
--     result='failure' rows, e.g. a blocked account's login attempt).
create or replace function public.admin_list_events(
  p_from timestamptz, p_to timestamptz,
  p_search text default null, p_event_type text default null,
  p_actor_role text default null, p_target_type text default null,
  p_result text default null, p_target_id uuid default null,
  p_sort text default 'created_at', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0
)
returns table (
  id uuid, event_type text, occurred_at timestamptz,
  actor_user_id uuid, actor_role text, actor_label text,
  target_type text, target_id uuid, target_label text,
  metadata jsonb, result text, total_count bigint
)
language plpgsql stable security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with base as (
    select e.id, e.event_type, e.created_at as occurred_at,
           e.actor_user_id, e.actor_role, e.actor_label,
           e.target_type, e.target_id, e.target_label, e.metadata, e.result
      from public.admin_events e
     where public.admin_in_range(e.created_at, p_from, p_to)
       and (p_event_type is null or p_event_type = '' or e.event_type = p_event_type)
       and (p_actor_role is null or p_actor_role = '' or e.actor_role = p_actor_role)
       and (p_target_type is null or p_target_type = '' or e.target_type = p_target_type)
       and (p_result is null or p_result = '' or e.result = p_result)
       and (p_target_id is null or e.target_id = p_target_id)
       and (p_search is null or p_search = ''
            or strpos(lower(coalesce(e.actor_label, '')), lower(p_search)) > 0
            or strpos(lower(coalesce(e.target_label, '')), lower(p_search)) > 0
            or strpos(lower(e.event_type), lower(p_search)) > 0)
  )
  select b.id, b.event_type, b.occurred_at, b.actor_user_id, b.actor_role, b.actor_label,
         b.target_type, b.target_id, b.target_label, b.metadata, b.result,
         count(*) over () as total_count
    from base b
   order by
     case when p_dir = 'asc' then extract(epoch from b.occurred_at) end asc,
     case when p_dir <> 'asc' then extract(epoch from b.occurred_at) end desc,
     b.id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;


-- 6.5 Department analytics — candidates grouped by the RAW branch text they
--     entered (trimmed; blank -> "Not specified"). Deliberately NOT resolved
--     through the College Portal's branch-alias table (normalize_branch(),
--     app/utils/college/branch.py): that table lives in Python, this is SQL,
--     and duplicating alias logic in two languages is exactly the kind of
--     competing system rule 31/34 rule out. So "CSE" and "Computer Science
--     and Engineering" appear as separate rows here — an honest reflection
--     of the data, not a bug. There is also no FK from candidates to
--     public.departments: that table is a College Portal roster concept,
--     scoped to one college's own students, with no platform-wide analogue.
create or replace function public.admin_department_breakdown(
  p_from timestamptz, p_to timestamptz, p_college_id uuid default null
)
returns table (
  branch text, candidates bigint, applications bigint, applicants bigint,
  shortlisted bigint, selected bigint, selected_applicants bigint
)
language sql stable security definer
set search_path = public
as $$
  with
  cand as (
    select coalesce(nullif(trim(p.branch), ''), 'Not specified') as branch, p.id
      from public.profiles p
     where p.role = 'candidate' and (p_college_id is null or p.college_id = p_college_id)
  ),
  facts as (
    select f.* from public.admin_app_facts(p_from, p_to) f
     where p_college_id is null or f.college_id = p_college_id
  )
  select c.branch,
         count(distinct c.id) as candidates,
         count(f.application_id) as applications,
         count(distinct f.student_id) as applicants,
         count(*) filter (where f.is_shortlisted) as shortlisted,
         count(*) filter (where f.is_selected) as selected,
         count(distinct f.student_id) filter (where f.is_selected) as selected_applicants
    from cand c
    left join facts f on f.student_id = c.id
   group by c.branch
   order by candidates desc, c.branch
$$;


-- 6.6 CTC by company (posted vs filled — see admin_ctc_stats for the
--     advertised-vs-actual-offer caveat, unchanged here). There is no
--     "CTC by department": a job's eligible_branches is a filter that can
--     span many branches or none, not a single department assignment, so
--     attributing one CTC figure to "one department" would misrepresent it.
create or replace function public.admin_ctc_by_company(p_from timestamptz, p_to timestamptz)
returns table (
  company_id uuid, company_name text,
  posted_roles bigint, posted_average numeric, posted_highest numeric, posted_lowest numeric,
  filled_roles bigint, filled_average numeric, filled_highest numeric, filled_lowest numeric
)
language sql stable security definer
set search_path = public
as $$
  with
  j as (
    select id, company_id,
           (coalesce(ctc_min, ctc_max) + coalesce(ctc_max, ctc_min)) / 2 as mid,
           coalesce(ctc_min, ctc_max) as lo, coalesce(ctc_max, ctc_min) as hi,
           created_at
      from public.jobs
     where employment_type <> 'intern'
       and (ctc_min is not null or ctc_max is not null)
       and coalesce(ctc_currency, 'INR') = 'INR'
  ),
  posted as (select * from j where public.admin_in_range(created_at, p_from, p_to)),
  filled as (
    select j.* from public.admin_app_facts(p_from, p_to) f join j on j.id = f.job_id where f.is_selected
  ),
  agg as (
    select company_id, 'posted'::text as tag, count(*) as n, round(avg(mid)) as avgv, max(hi) as hiv, min(lo) as lov from posted group by company_id
    union all
    select company_id, 'filled', count(*), round(avg(mid)), max(hi), min(lo) from filled group by company_id
  ),
  seen as (select company_id from posted union select company_id from filled)
  select cmp.id, cmp.name,
         coalesce(p.n, 0), p.avgv, p.hiv, p.lov,
         coalesce(f.n, 0), f.avgv, f.hiv, f.lov
    from seen s
    join public.companies cmp on cmp.id = s.company_id
    left join agg p on p.company_id = s.company_id and p.tag = 'posted'
    left join agg f on f.company_id = s.company_id and f.tag = 'filled'
   order by coalesce(f.n, 0) desc, coalesce(p.n, 0) desc, cmp.name
$$;


-- 6.7 Alerts — computed live from current data, never stored (so there is
--     nothing to go stale and no scheduled job to keep it correct). Only
--     conditions this data model can actually answer; see the header of
--     each branch below for why the others in the spec were left out.
create or replace function public.admin_alerts()
returns table (
  alert_id text, alert_type text, severity text, title text, description text,
  occurred_at timestamptz, link text
)
language sql stable security definer
set search_path = public
as $$
  with facts_all as (select * from public.admin_app_facts(null, null)),
  u as (
  (
    select 'no_apps:' || d.id as alert_id, 'drive_no_applications' as alert_type, 'warning' as severity,
           'Live drive with no applications' as title,
           cmp.name || ' — ' || j.title || ' at ' || col.name || ' has been live for over a week with zero applications.' as description,
           d.created_at as occurred_at, '/admin/placements?drive=' || d.id as link
      from public.job_drives d
      join public.jobs j on j.id = d.job_id
      join public.companies cmp on cmp.id = j.company_id
      join public.colleges col on col.id = d.college_id
      left join facts_all f on f.drive_id = d.id
     where d.status = 'live' and d.created_at < now() - interval '7 days' and f.application_id is null
  )
  union all
  (
    select 'closing:' || d.id, 'drive_closing_soon', 'info',
           'Drive closing within 3 days',
           cmp.name || ' — ' || j.title || ' at ' || col.name || ' closes ' || to_char(d.apply_deadline, 'DD Mon, HH24:MI') || '.',
           d.apply_deadline, '/admin/placements?drive=' || d.id
      from public.job_drives d
      join public.jobs j on j.id = d.job_id
      join public.companies cmp on cmp.id = j.company_id
      join public.colleges col on col.id = d.college_id
     where d.status = 'live' and d.apply_deadline between now() and now() + interval '3 days'
  )
  union all
  (
    -- colleges.onboarding_completed (college_onboarding_migration.sql) is the
    -- only real onboarding-completeness signal that exists.
    select 'onboarding:' || c.id, 'college_onboarding_incomplete', 'warning',
           'College onboarding incomplete',
           c.name || ' has a College account but has not completed onboarding.',
           null::timestamptz, '/admin/colleges/' || c.id
      from public.colleges c
      join public.admin_college_accounts() a on a.college_id = c.id
     where coalesce(c.onboarding_completed, false) = false
  )
  union all
  (
    -- One aggregate alert, not one per candidate — a per-row alert for
    -- possibly thousands of candidates would be noise, not a to-do list.
    select 'incomplete_candidates', 'candidate_profiles_incomplete', 'info',
           n || ' candidate profile(s) missing college, branch or graduation year',
           'Incomplete profiles may not match drive eligibility filters correctly.',
           null::timestamptz, '/admin/candidates'
      from (select count(*) as n from public.profiles
             where role = 'candidate' and (college_id is null or branch is null or graduation_year is null)) x
     where n > 0
  )
  union all
  (
    -- The one "unusual activity" signal this data model actually has: a
    -- suspended account trying to sign in (logged as a failure event by
    -- the backend). There is no generic application-error log to alert on.
    select 'blocked_logins', 'blocked_login_attempts', 'critical',
           n || ' blocked-account login attempt(s) in the last 24 hours',
           'A suspended account attempted to sign in.',
           now(), '/admin/audit-log?event_type=user_login&result=failure'
      from (select count(*) as n from public.admin_events
             where event_type = 'user_login' and result = 'failure' and created_at > now() - interval '24 hours') x
     where n > 0
  )
  )
  select * from u
   order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, occurred_at desc nulls last
$$;


-- 6.8 Global search — colleges, companies, candidates, drives. Applications
--     are not a fifth branch: they aren't identified by a human-typed string,
--     so they are reached by filtering the Candidates page instead.
create or replace function public.admin_global_search(
  p_query text, p_limit int default 8,
  -- Admin permission scoping (app/services/admin/permissions.py): candidate
  -- results carry a real email address, so a caller whose candidates.view is
  -- scoped to specific colleges must not find candidates OUTSIDE that scope
  -- through search either. NULL (the default) = unrestricted, unchanged for
  -- every existing caller. The other three branches return no personal data
  -- (an institution/company/job name), so they are not scoped by this.
  p_college_ids uuid[] default null
)
returns table (entity_type text, id uuid, title text, subtitle text)
language sql stable security definer
set search_path = public
as $$
  with q as (select nullif(trim(p_query), '') as v)
  (
    select 'college', c.id, c.name, coalesce(c.city, '')
      from public.colleges c, q
     where q.v is not null and strpos(lower(c.name), lower(q.v)) > 0
     order by c.name limit greatest(p_limit, 0)
  )
  union all
  (
    select 'company', c.id, c.name, coalesce(c.industry, '')
      from public.companies c, q
     where q.v is not null and strpos(lower(c.name), lower(q.v)) > 0
     order by c.name limit greatest(p_limit, 0)
  )
  union all
  (
    select 'candidate', p.id,
           coalesce(nullif(p.name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email),
           p.email
      from public.profiles p, q
     where p.role = 'candidate' and q.v is not null
       and (p_college_ids is null or p.college_id = any(p_college_ids))
       and (strpos(lower(coalesce(p.name, '')), lower(q.v)) > 0
            or strpos(lower(coalesce(p.email, '')), lower(q.v)) > 0)
     order by p.created_at desc limit greatest(p_limit, 0)
  )
  union all
  (
    select 'drive', d.id, j.title, cmp.name || ' @ ' || col.name
      from public.job_drives d
      join public.jobs j on j.id = d.job_id
      join public.companies cmp on cmp.id = j.company_id
      join public.colleges col on col.id = d.college_id, q
     where q.v is not null and strpos(lower(j.title), lower(q.v)) > 0
     order by d.created_at desc limit greatest(p_limit, 0)
  )
$$;


-- 6.9 Platform usage — counts of tracked actions in the period. Only actions
--     this backend actually logs (admin_events) or already timestamps
--     (applications, drives, resume analyses) are counted; there is no login
--     history before this feature shipped, so a "0" for a range that predates
--     it means "not tracked yet", not "nobody signed in" —
--     events_tracking_since lets the API/UI say so rather than let a reader
--     assume the latter.
create or replace function public.admin_platform_usage(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'logins',                (select count(*) from public.admin_events where event_type = 'user_login' and result = 'success' and public.admin_in_range(created_at, p_from, p_to)),
    'blocked_login_attempts',(select count(*) from public.admin_events where event_type = 'user_login' and result = 'failure' and public.admin_in_range(created_at, p_from, p_to)),
    'accounts_provisioned',  (select count(*) from public.admin_events where event_type = 'account_provisioned' and public.admin_in_range(created_at, p_from, p_to)),
    'users_blocked',         (select count(*) from public.admin_events where event_type = 'user_blocked' and public.admin_in_range(created_at, p_from, p_to)),
    'users_unblocked',       (select count(*) from public.admin_events where event_type = 'user_unblocked' and public.admin_in_range(created_at, p_from, p_to)),
    'csv_exports',           (select count(*) from public.admin_events where event_type = 'csv_exported' and public.admin_in_range(created_at, p_from, p_to)),
    'reports_generated',     (select count(*) from public.admin_events where event_type = 'report_generated' and public.admin_in_range(created_at, p_from, p_to)),
    'applications_submitted',(select count(*) from public.admin_app_facts(p_from, p_to)),
    'drives_created',        (select count(*) from public.job_drives where public.admin_in_range(created_at, p_from, p_to)),
    'resume_analyses',       (select count(*) from public.resume_analyses where source = 'real_user' and public.admin_in_range(created_at, p_from, p_to)),
    'events_tracking_since', (select min(created_at) from public.admin_events)
  )
$$;


-- ═════════════════════════════════════════════════════════════════════
-- 7. Lock the admin_* functions to the backend.
--    Supabase's default privileges grant EXECUTE on new public functions to
--    anon and authenticated; revoke that and allow service_role only.
--    Looping over pg_proc covers every admin_* overload above, so a function
--    added to this file later is locked down by re-running the migration.
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end
$$;
