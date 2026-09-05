-- ─────────────────────────────────────────────────────────────────────
-- DRAFT — proposed, not yet applied. Awaiting review/approval.
--
-- Supersedes the flat profiles.skills / profiles.college_name columns
-- from incremental_migration_candidate_profile.sql with a normalized
-- structure, per the post-OTP onboarding spec.
--
-- Deliberately named to avoid collision with the EXISTING public.colleges
-- (platform tenants with a College Portal account) and public.students
-- (a College's TPO-managed roster) tables — those mean something different
-- from a candidate's self-reported alma mater / self-signup profile.
-- ─────────────────────────────────────────────────────────────────────

-- candidate_colleges: a candidate's self-reported alma mater. Not the same
-- as public.colleges (a college does not need a College Portal account to
-- appear here) — no FK relationship between the two on purpose.
create table if not exists public.candidate_colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_predefined boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lower(name))
);

insert into public.candidate_colleges (name, is_predefined) values
  ('LNMIIT Jaipur', true),
  ('NIT Jalandhar', true),
  ('Chitkara University', true),
  ('IIIT Hyderabad', true)
on conflict (lower(name)) do nothing;

-- skills: master taxonomy. See proposed seed list (pending approval).
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  is_predefined boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lower(name))
);

-- candidate_skills: many-to-many, self-reported at onboarding.
-- is_custom = true means the candidate typed something not in the master
-- `skills` list — unverified against the taxonomy, flagged for the future
-- resume / GitHub / LeetCode cross-check ("verified" tag) logic.
create table if not exists public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  unique (candidate_id, skill_id)
);

create index if not exists candidate_skills_candidate_idx on public.candidate_skills(candidate_id);
create index if not exists candidate_skills_skill_idx on public.candidate_skills(skill_id);

-- profiles: normalized replacements for last session's flat columns.
alter table public.profiles add column if not exists candidate_college_id uuid
  references public.candidate_colleges(id) on delete set null;
alter table public.profiles add column if not exists degree text;
alter table public.profiles add column if not exists branch text;
alter table public.profiles add column if not exists domain text
  check (domain in ('tech', 'non-tech'));

-- Superseded by candidate_college_id / candidate_skills. Left in place
-- (not dropped) until the app is fully cut over to the normalized columns —
-- drop explicitly once verified nothing reads them anymore:
--   alter table public.profiles drop column if exists college_name;
--   alter table public.profiles drop column if exists skills;

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.candidate_colleges enable row level security;
alter table public.skills             enable row level security;
alter table public.candidate_skills   enable row level security;

-- Master lists: any authenticated user can read (needed for the dropdown
-- and fuzzy-search UI), but only insert new candidate_colleges rows
-- (the "Other" case) — never edit/delete existing ones from the client.
create policy candidate_colleges_read on public.candidate_colleges
  for select using (auth.role() = 'authenticated');
create policy candidate_colleges_insert on public.candidate_colleges
  for insert with check (auth.role() = 'authenticated');

create policy skills_read on public.skills
  for select using (auth.role() = 'authenticated');

-- A candidate can only see/manage their own skill rows.
create policy candidate_skills_own on public.candidate_skills
  for all
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());
