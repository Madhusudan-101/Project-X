-- ============================================================
-- Resume Analysis Tracking — Patch v2
-- Run this AFTER resume_analysis_migration.sql was already applied
-- with its original (pre-fix) definition, i.e. public.resume_analyses
-- already exists with candidate_id -> public.students(id) and no
-- portfolio_metrics_json column.
--
-- `create table if not exists` in the original file is a no-op against
-- an already-created table, so those fixes never applied retroactively —
-- this patch brings the live table in line by hand.
-- ============================================================

-- 1. Repoint candidate_id at public.profiles(id) — the auth-linked identity
--    table for logged-in candidates — instead of public.students(id), which
--    is a college-managed roster with no relation to auth.users at all and
--    can never match the id the backend actually has for a candidate.
alter table public.resume_analyses
  drop constraint if exists resume_analyses_candidate_id_fkey;

alter table public.resume_analyses
  add constraint resume_analyses_candidate_id_fkey
  foreign key (candidate_id) references public.profiles(id) on delete set null;

-- 2. Add portfolio_metrics_json — stores the GitHub/LeetCode/Codeforces
--    metrics used for that analysis, so a later re-upload can detect
--    whether the candidate's verified portfolio changed since last time.
alter table public.resume_analyses
  add column if not exists portfolio_metrics_json jsonb;

-- 3. resume_file_url isn't populated by any code path yet (no resume file
--    storage is wired up) — was NOT NULL, which would break every insert.
alter table public.resume_analyses
  alter column resume_file_url drop not null;

-- 4. Index driving "fetch this candidate's most recent analysis", used to
--    diff a re-uploaded resume against their last one.
create index if not exists idx_resume_analyses_candidate_latest
  on public.resume_analyses(candidate_id, created_at desc);
