-- ─────────────────────────────────────────────────────────────────────
-- Incremental Migration for College Portal
-- 
-- Safe to run on existing databases where the `profiles` table is 
-- already present. Will only create missing tables, RLS policies, 
-- and indexes.
-- ─────────────────────────────────────────────────────────────────────

-- Ensure the trigger function exists
create or replace function public.trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- colleges (tenant)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  created_at timestamptz default now()
);

-- Ensure profiles.college_id exists before late-binding the FK below —
-- this repo's base migrations.sql does not define it.
alter table public.profiles add column if not exists college_id uuid;

-- Late-bind the profiles.college_id FK now that colleges exists.
-- Safe `do` block ensures constraint isn't duplicated.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_college_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_college_id_fkey
      foreign key (college_id) references public.colleges(id) on delete set null;
  end if;
end $$;

create index if not exists profiles_college_id_idx on public.profiles(college_id);


-- ─────────────────────────────────────────────────────────────────────
-- students (roster)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  name text not null,
  email text not null,
  branch text not null,
  graduation_year int not null,
  employability_score numeric(5,2) not null default 0,
  resume_score numeric(5,2) not null default 0,
  github_score numeric(5,2) not null default 0,
  leetcode_score numeric(5,2) not null default 0,
  interview_score numeric(5,2) not null default 0,
  assessment_score numeric(5,2) not null default 0,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected')),
  placement_status text not null default 'not_placed'
    check (placement_status in ('not_placed', 'placed', 'offer_declined')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (college_id, email)
);

-- Idempotent for pre-existing `students` tables created before placement_status
-- was added to the create-table statement above.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'placement_status'
  ) then
    alter table public.students
      add column placement_status text not null default 'not_placed'
        check (placement_status in ('not_placed', 'placed', 'offer_declined'));
  end if;
end $$;

create index if not exists students_college_idx on public.students(college_id);
create index if not exists students_college_branch_idx on public.students(college_id, branch);
create index if not exists students_college_grad_year_idx on public.students(college_id, graduation_year);
create index if not exists students_college_placement_idx on public.students(college_id, placement_status);

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
before update on public.students
for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- company_drives
-- eligibility is jsonb: { "branch": ["CSE","IT"], "graduationYear": 2026, "minimumScore": 80 }
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.company_drives (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  company_name text not null,
  role text not null,
  eligibility jsonb not null default '{}'::jsonb,
  drive_date date not null,
  status text not null default 'Active'
    check (status in ('Active','Closed','Draft')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists company_drives_college_idx on public.company_drives(college_id);

drop trigger if exists company_drives_set_updated_at on public.company_drives;
create trigger company_drives_set_updated_at
before update on public.company_drives
for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- score_verifications
-- One row per (student, score_type) verification request/decision.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.score_verifications (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score_type text not null
    check (score_type in ('resume','github','leetcode','interview','assessment','employability')),
  status text not null default 'pending'
    check (status in ('pending','verified','rejected')),
  note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (student_id, score_type)
);

create index if not exists score_verifications_college_idx on public.score_verifications(college_id);
create index if not exists score_verifications_student_idx on public.score_verifications(student_id);

drop trigger if exists score_verifications_set_updated_at on public.score_verifications;
create trigger score_verifications_set_updated_at
before update on public.score_verifications
for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- Model: a College user is a profile row with role='college' and a college_id set.
-- Every tenant table is readable/writable only when the caller is a College user
-- of the row's college_id.  Admins (role='admin') see everything.
-- ─────────────────────────────────────────────────────────────────────
alter table public.colleges            enable row level security;
alter table public.students            enable row level security;
alter table public.company_drives      enable row level security;
alter table public.score_verifications enable row level security;

-- Helper: current caller's college_id (null if not a College user or not signed in)
create or replace function public.current_college_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.college_id
    from public.profiles p
   where p.id = auth.uid()
     and p.role = 'college'
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  )
$$;

-- colleges: College users see their own college; admins see all
drop policy if exists colleges_college_read on public.colleges;
create policy colleges_college_read on public.colleges
  for select using (
    public.is_admin() or id = public.current_college_id()
  );

-- students
drop policy if exists students_college_all on public.students;
create policy students_college_all on public.students
  for all
  using (
    public.is_admin() or college_id = public.current_college_id()
  )
  with check (
    public.is_admin() or college_id = public.current_college_id()
  );

-- company_drives
drop policy if exists company_drives_college_all on public.company_drives;
create policy company_drives_college_all on public.company_drives
  for all
  using (
    public.is_admin() or college_id = public.current_college_id()
  )
  with check (
    public.is_admin() or college_id = public.current_college_id()
  );

-- score_verifications
drop policy if exists score_verifications_college_all on public.score_verifications;
create policy score_verifications_college_all on public.score_verifications
  for all
  using (
    public.is_admin() or college_id = public.current_college_id()
  )
  with check (
    public.is_admin() or college_id = public.current_college_id()
  );
