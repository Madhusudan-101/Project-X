-- ============================================================
-- Role Weightage Migration — Project X (Feature 4: Company Dashboard)
-- Run AFTER role_migration.sql (job_roles table must exist)
-- ============================================================

-- 1. Weightage columns — how much each evaluation factor counts toward
--    a candidate's final score for this role. Default 20 each (= 100 total)
--    so existing rows stay valid the moment this migration runs.
alter table public.job_roles
  add column if not exists resume_weight     smallint not null default 20,
  add column if not exists github_weight     smallint not null default 20,
  add column if not exists leetcode_weight   smallint not null default 20,
  add column if not exists interview_weight  smallint not null default 20,
  add column if not exists assessment_weight smallint not null default 20;

-- 2. Each weight must be a valid percentage
alter table public.job_roles drop constraint if exists job_roles_weights_range_check;
alter table public.job_roles add constraint job_roles_weights_range_check
  check (
    resume_weight     between 0 and 100 and
    github_weight     between 0 and 100 and
    leetcode_weight   between 0 and 100 and
    interview_weight  between 0 and 100 and
    assessment_weight between 0 and 100
  );

-- 3. The five weights must always total exactly 100 — enforced at the DB
--    level so this invariant holds regardless of which code path writes
--    the row (defense in depth on top of frontend + backend validation).
alter table public.job_roles drop constraint if exists job_roles_weights_total_check;
alter table public.job_roles add constraint job_roles_weights_total_check
  check (resume_weight + github_weight + leetcode_weight + interview_weight + assessment_weight = 100);
