-- ============================================================
-- Online Assessment — coding problems, judge submissions, invites
--
-- Extends db/online_assessment_migration.sql. ADDITIVE ONLY: new tables plus
-- new nullable / defaulted columns on the oa_* tables. Nothing existing is
-- altered or dropped, so the earlier OA flow keeps working unchanged.
--
--   oa_problems        problem library (statement, signature, starter code)
--   oa_problem_tests   test cases. Hidden ones never leave the server.
--   oa_submissions     every graded Submit, with verdict + per-case detail
--   oa_invites         which applications the company has invited
--
-- Run AFTER db/online_assessment_migration.sql.
-- Idempotent.
-- ============================================================

create table if not exists public.oa_problems (
  id               text        primary key,           -- slug, e.g. 'two-sum'
  title            text        not null,
  difficulty       text        check (difficulty in ('Easy', 'Medium', 'Hard')),
  topics           text[]      not null default '{}',
  statement_html   text        not null,
  constraints_html text        not null default '',
  function_name    text        not null,              -- name in the JavaScript starter
  params           text[]      not null default '{}',
  starter_code     jsonb       not null default '{}'::jsonb,   -- {"javascript": "...", "python": "..."}
  languages        text[]      not null default '{}',          -- languages the judge can run
  compare          text        not null default 'exact'
                     check (compare in ('exact', 'unordered')),      -- 'unordered' = "return in any order" problems
  validated        boolean     not null default false,         -- checked against an independent solution
  active           boolean     not null default true,
  created_at       timestamptz not null default now()
);

-- (databases that already ran an earlier version of this file)
alter table public.oa_problems
  add column if not exists compare text not null default 'exact';

create index if not exists idx_oa_problems_active on public.oa_problems(active, validated);

create table if not exists public.oa_problem_tests (
  id         uuid    primary key default gen_random_uuid(),
  problem_id text    not null references public.oa_problems(id) on delete cascade,
  position   int     not null check (position >= 1),
  args       jsonb   not null,        -- JSON array of positional arguments
  expected   jsonb   not null,
  is_visible boolean not null default false,
  unique (problem_id, position)
);

create index if not exists idx_oa_problem_tests_problem on public.oa_problem_tests(problem_id);

alter table public.oa_questions
  add column if not exists problem_id text references public.oa_problems(id);

alter table public.oa_assessments
  add column if not exists invite_mode text not null default 'invited'
    check (invite_mode in ('all', 'invited'));
alter table public.oa_assessments
  add column if not exists created_by uuid;

alter table public.oa_attempts
  add column if not exists fullscreen_exits int not null default 0;
alter table public.oa_attempts
  add column if not exists paste_events int not null default 0;

create table if not exists public.oa_submissions (
  id          uuid        primary key default gen_random_uuid(),
  attempt_id  uuid        not null references public.oa_attempts(id)  on delete cascade,
  question_id uuid        not null references public.oa_questions(id) on delete cascade,
  language    text        not null,
  source      text        not null,
  verdict     text        not null
                check (verdict in ('accepted', 'wrong_answer', 'runtime_error',
                                   'compile_error', 'time_limit', 'judge_error')),
  passed      int         not null default 0,
  total       int         not null default 0,
  score       numeric     not null default 0,
  results     jsonb,                      -- per-case detail for VISIBLE cases only
  created_at  timestamptz not null default now()
);

create index if not exists idx_oa_submissions_attempt_q
  on public.oa_submissions(attempt_id, question_id, created_at desc);

create table if not exists public.oa_invites (
  id              uuid        primary key default gen_random_uuid(),
  application_id  uuid        not null unique references public.applications(id) on delete cascade,
  assessment_id   uuid        not null references public.oa_assessments(id) on delete cascade,
  invited_by      uuid,
  status          text        not null default 'invited' check (status in ('invited', 'revoked')),
  invited_at      timestamptz not null default now(),
  last_emailed_at timestamptz,
  email_status    text                      -- sent | skipped | failed
);

create index if not exists idx_oa_invites_assessment on public.oa_invites(assessment_id);

-- ── RLS (defense in depth; the API uses the service role) ───────────
alter table public.oa_problems      enable row level security;
alter table public.oa_problem_tests enable row level security;   -- no policies: service role only
alter table public.oa_submissions   enable row level security;   -- no policies: service role only
alter table public.oa_invites       enable row level security;

drop policy if exists oa_invites_student_read on public.oa_invites;
create policy oa_invites_student_read on public.oa_invites
  for select using (
    application_id in (select id from public.applications where student_id = auth.uid())
  );
