-- ─────────────────────────────────────────────────────────────────────
-- Incremental Migration — Departments module
--
-- Safe to run on existing databases (idempotent: `if not exists` / `do`
-- blocks throughout, same pattern as incremental_migration.sql).
-- Depends on: colleges, students, current_college_id(), is_admin(),
-- trigger_set_updated_at() — all created by incremental_migration.sql.
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- departments
-- `code` is the value matched against students.branch (via the existing
-- normalize_branch() alias table in utils/branch.py) to compute
-- per-department stats. `name` is just the display label.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  name text not null,
  code text,
  hod_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (college_id, name)
);

create index if not exists departments_college_idx on public.departments(college_id);

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
before update on public.departments
for each row execute procedure public.trigger_set_updated_at();

alter table public.departments enable row level security;

drop policy if exists departments_college_all on public.departments;
create policy departments_college_all on public.departments
  for all
  using (
    public.is_admin() or college_id = public.current_college_id()
  )
  with check (
    public.is_admin() or college_id = public.current_college_id()
  );


-- ─────────────────────────────────────────────────────────────────────
-- students.placement_status
-- Tracks whether a student has been placed, independent of verification
-- status. Backfilled to 'not_placed' for all existing rows.
-- ─────────────────────────────────────────────────────────────────────
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

create index if not exists students_college_placement_idx
  on public.students(college_id, placement_status);
