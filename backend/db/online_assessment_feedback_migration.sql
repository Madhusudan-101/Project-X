-- ============================================================
-- Online Assessment — candidate feedback on the assessment experience
--
-- ADDITIVE ONLY. Run AFTER db/online_assessment_migration.sql.
--
-- One row per attempt: a 1-5 star rating and an optional comment, given on the
-- "Assessment submitted" screen. Recruiters read them next to the results; candidates
-- have no direct table access (the API is the only reader/writer).
-- Idempotent.
-- ============================================================

create table if not exists public.oa_feedback (
  id         uuid        primary key default gen_random_uuid(),
  attempt_id uuid        not null unique references public.oa_attempts(id) on delete cascade,
  rating     int         not null check (rating between 1 and 5),
  comment    text        check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.oa_feedback enable row level security;   -- no policies: service role only
