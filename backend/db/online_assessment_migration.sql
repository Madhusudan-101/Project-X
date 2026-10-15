-- ============================================================
-- Online Assessment (OA) — Mirracle
--
-- A drive's OA is a sequence of timed, one-way SECTIONS (HackerRank-style):
-- once a candidate moves past a section they cannot revisit it, and unused
-- time never rolls over. Each section holds questions (MCQ or coding).
--
-- Tables
--   oa_assessments  one per job_drive (lazily provisioned from a default
--                   question bank the first time a candidate opens the OA)
--   oa_sections     ordered, each with its own duration
--   oa_questions    mcq | coding. correct_option is NEVER sent to candidates.
--   oa_attempts     one per application — server-authoritative timing
--   oa_answers      latest answer per (attempt, question)
--
-- Run AFTER db/job_drives_migration.sql (needs job_drives, applications,
-- profiles, trigger_set_updated_at).
--
-- Idempotent: create-if-not-exists + drop-policy-if-exists throughout.
-- ============================================================

create table if not exists public.oa_assessments (
  id         uuid        primary key default gen_random_uuid(),
  drive_id   uuid        not null unique references public.job_drives(id) on delete cascade,
  title      text        not null,
  created_at timestamptz not null default now()
);

create table if not exists public.oa_sections (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references public.oa_assessments(id) on delete cascade,
  position         int  not null check (position >= 1),
  title            text not null,
  kind             text not null check (kind in ('coding', 'sql', 'mcq')),
  duration_minutes int  not null check (duration_minutes between 1 and 240),
  unique (assessment_id, position)
);

create index if not exists idx_oa_sections_assessment on public.oa_sections(assessment_id);

create table if not exists public.oa_questions (
  id             uuid primary key default gen_random_uuid(),
  section_id     uuid not null references public.oa_sections(id) on delete cascade,
  position       int  not null check (position >= 1),
  qtype          text not null check (qtype in ('mcq', 'coding')),
  title          text not null,
  prompt         text not null,
  options        jsonb,             -- mcq: ["A", "B", ...]
  correct_option int,               -- mcq: index into options (server-side only)
  starter_code   jsonb,             -- coding: {"python": "...", "javascript": "..."}
  points         int  not null default 10 check (points >= 0),
  unique (section_id, position)
);

create index if not exists idx_oa_questions_section on public.oa_questions(section_id);

create table if not exists public.oa_attempts (
  id                 uuid        primary key default gen_random_uuid(),
  application_id     uuid        not null unique references public.applications(id) on delete cascade,
  student_id         uuid        not null references public.profiles(id) on delete cascade,
  assessment_id      uuid        not null references public.oa_assessments(id) on delete cascade,
  status             text        not null default 'in_progress'
                       check (status in ('in_progress', 'submitted')),
  current_section    int         not null default 1,
  started_at         timestamptz not null default now(),
  section_started_at timestamptz not null default now(),
  submitted_at       timestamptz,
  score              numeric,     -- auto-graded points (MCQ only)
  max_score          numeric,     -- total points across the assessment
  tab_switches       int         not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists idx_oa_attempts_student on public.oa_attempts(student_id);

create table if not exists public.oa_answers (
  id          uuid        primary key default gen_random_uuid(),
  attempt_id  uuid        not null references public.oa_attempts(id) on delete cascade,
  question_id uuid        not null references public.oa_questions(id) on delete cascade,
  answer      text,                -- mcq: option index as text; coding: source code
  language    text,
  updated_at  timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists idx_oa_answers_attempt on public.oa_answers(attempt_id);

drop trigger if exists set_oa_answers_updated_at on public.oa_answers;
create trigger set_oa_answers_updated_at
  before update on public.oa_answers
  for each row execute procedure public.trigger_set_updated_at();


-- ═════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (defense-in-depth — the FastAPI backend uses the
-- service role). Candidates get NO direct table access: questions carry
-- answer keys, so every read goes through the API.
-- ═════════════════════════════════════════════════════════════════════
alter table public.oa_assessments enable row level security;
alter table public.oa_sections    enable row level security;
alter table public.oa_questions   enable row level security;
alter table public.oa_attempts    enable row level security;
alter table public.oa_answers     enable row level security;

-- A student may read only their own attempt row (no answer keys in it).
drop policy if exists oa_attempts_student_read on public.oa_attempts;
create policy oa_attempts_student_read on public.oa_attempts
  for select using (student_id = auth.uid());
