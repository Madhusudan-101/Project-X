-- ============================================================
-- Online Assessment — timestamped integrity event log
--
-- ADDITIVE ONLY. Run AFTER db/online_assessment_coding_migration.sql.
--
-- The counters on oa_attempts (tab_switches, fullscreen_exits, paste_events) say HOW
-- MANY times something happened. This table says WHEN, DURING WHICH QUESTION, and for
-- pastes / copies WHAT was moved — which is what a reviewer needs to judge a flag.
--
--   oa_events.type   tab_switch | tab_return | window_blur | window_focus |
--                    fullscreen_exit | fullscreen_enter | paste | copy | cut
--   oa_events.meta   whitelisted, size-capped by the API:
--                    text (paste/copy/cut content, first 4000 chars), length (full length),
--                    away_ms (on *_return / window_focus), target ('editor' | 'other')
--
-- Candidates have no table access (service role only): they must not read, or delete,
-- their own trail.
-- Idempotent.
-- ============================================================

create table if not exists public.oa_events (
  id          uuid        primary key default gen_random_uuid(),
  attempt_id  uuid        not null references public.oa_attempts(id) on delete cascade,
  question_id uuid                 references public.oa_questions(id) on delete set null,
  type        text        not null check (type in (
                'tab_switch', 'tab_return', 'window_blur', 'window_focus',
                'fullscreen_exit', 'fullscreen_enter', 'paste', 'copy', 'cut')),
  occurred_at timestamptz not null default now(),
  meta        jsonb       not null default '{}'::jsonb
);

create index if not exists idx_oa_events_attempt on public.oa_events(attempt_id, occurred_at);

-- how many events an attempt has logged (cheap cap, no count(*) per request)
alter table public.oa_attempts
  add column if not exists events_logged int not null default 0;

alter table public.oa_events enable row level security;   -- no policies: service role only
