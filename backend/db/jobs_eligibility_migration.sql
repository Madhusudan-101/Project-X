-- ============================================================
-- Jobs — Eligibility & Offer Detail fields — Mirracle
-- Additive extension of public.jobs (created in
-- db/jobs_and_applications_migration.sql). Adds employment type, CGPA /
-- branch / batch-year eligibility, on-campus flag, CTC range, and
-- interview duration to a job posting.
--
-- Run AFTER db/jobs_and_applications_migration.sql.
--
-- Idempotent: add column if not exists throughout. NOTE — as with the
-- other `add column if not exists` migrations in this repo, the CHECK
-- constraints below are only applied when the column is first created;
-- re-running against a table that already has the column is a no-op.
-- ============================================================

-- Employment type — full-time role, internship, or fixed-term contract.
alter table public.jobs
  add column if not exists employment_type text not null default 'full-time'
    check (employment_type in ('full-time', 'intern', 'contract'));

-- Minimum CGPA (0-10 scale). Only meaningful for restricted / on-campus
-- postings, but not hard-blocked on open jobs — see schemas.py.
alter table public.jobs
  add column if not exists min_cgpa numeric(3, 2)
    check (min_cgpa >= 0 and min_cgpa <= 10);

-- Eligible branch codes — matches the taxonomy in
-- backend/app/utils/college/branch.py (CSE, IT, ECE, EE, MECH, CIV, …).
alter table public.jobs
  add column if not exists eligible_branches text[];

-- Eligible graduating batch years (e.g. {2025, 2026}).
alter table public.jobs
  add column if not exists eligible_batch_years int[];

-- Whether this is an on-campus drive (vs. an off-campus / open posting).
alter table public.jobs
  add column if not exists is_on_campus boolean not null default true;

-- CTC range. Currency defaults to INR; all three nullable (undisclosed CTC).
alter table public.jobs
  add column if not exists ctc_min numeric;
alter table public.jobs
  add column if not exists ctc_max numeric;
alter table public.jobs
  add column if not exists ctc_currency text default 'INR';

-- Interview slot length in minutes — 30, 60, or 90.
alter table public.jobs
  add column if not exists interview_duration_minutes int not null default 30
    check (interview_duration_minutes in (30, 60, 90));
