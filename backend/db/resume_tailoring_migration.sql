-- ============================================================
-- Resume Tailoring — per-application, diff-driven resume rewrite + PDF.
--
-- After scoring, a student can rewrite their resume for one job: the AI
-- rewrites section by section, the backend diffs original vs rewritten
-- (line-level then word-level), stores one run + one hunk per changed
-- bullet, the student accepts/rejects hunks, and the assembled final_text
-- is rendered to a PDF (WeasyPrint) uploaded to Supabase Storage.
--
-- Run AFTER db/jobs_and_applications_migration.sql. Idempotent.
-- ============================================================

create table if not exists public.resume_tailoring_runs (
  id             uuid        primary key default gen_random_uuid(),
  application_id uuid        not null references public.applications(id) on delete cascade,
  student_id     uuid        not null references public.profiles(id)     on delete cascade,
  original_text  text        not null,
  rewritten_text text,                       -- full AI rewrite, kept for reference
  -- Ordered reconstruction plan: [{kind:'keep', text} | {kind:'hunk', i}].
  segments_json  jsonb       not null default '[]'::jsonb,
  final_text     text,                       -- assembled after PATCH (accept/reject)
  pdf_path       text,                       -- storage object path, once rendered
  model_version  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_resume_tailoring_runs_application
  on public.resume_tailoring_runs(application_id, created_at desc);
create index if not exists idx_resume_tailoring_runs_student
  on public.resume_tailoring_runs(student_id);

drop trigger if exists set_resume_tailoring_runs_updated_at on public.resume_tailoring_runs;
create trigger set_resume_tailoring_runs_updated_at
  before update on public.resume_tailoring_runs
  for each row execute procedure public.trigger_set_updated_at();


create table if not exists public.resume_tailoring_hunks (
  id               uuid        primary key default gen_random_uuid(),
  run_id           uuid        not null references public.resume_tailoring_runs(id) on delete cascade,
  hunk_index       int         not null,
  section          text,
  original_bullet  text        not null default '',
  rewritten_bullet text        not null default '',
  -- Word-level tokens: [{op:'equal'|'insert'|'delete', text}].
  word_diff        jsonb       not null default '[]'::jsonb,
  decision         text        not null default 'pending'
                     check (decision in ('pending', 'accepted', 'rejected')),
  created_at       timestamptz not null default now(),
  unique (run_id, hunk_index)
);

create index if not exists idx_resume_tailoring_hunks_run
  on public.resume_tailoring_hunks(run_id, hunk_index);


-- ═════════════════════════ ROW-LEVEL SECURITY ═══════════════════════
alter table public.resume_tailoring_runs  enable row level security;
alter table public.resume_tailoring_hunks enable row level security;

-- Student reads only their own runs. No client writes — the service-role
-- backend is the only writer.
drop policy if exists rtr_student_read on public.resume_tailoring_runs;
create policy rtr_student_read on public.resume_tailoring_runs
  for select using (student_id = auth.uid());

drop policy if exists rth_student_read on public.resume_tailoring_hunks;
create policy rth_student_read on public.resume_tailoring_hunks
  for select using (
    run_id in (select id from public.resume_tailoring_runs where student_id = auth.uid())
  );


-- ── Storage bucket ─────────────────────────────────────────────────
-- The backend also tries to create this bucket on first render; create it
-- here so a fresh project doesn't need the programmatic path.
insert into storage.buckets (id, name, public)
values ('tailored-resumes', 'tailored-resumes', false)
on conflict (id) do nothing;
