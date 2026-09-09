-- ============================================================
-- Jobs → Job Board → Applications → Job-Scoped Scoring — Mirracle
-- Core platform loop. Connects company JD posting to the student
-- job board, applications, and a per-application (job-scoped) scoring
-- engine result.
--
-- Run AFTER:
--   * db/migrations.sql                  (public.profiles, trigger_set_updated_at)
--   * incremental_migration.sql          (public.colleges, public.is_admin())
--   * db/company_migration.sql           (public.companies)
--   * db/company_onboarding_migration.sql (public.current_company_id())
--   * db/resume_analysis_migration.sql   (public.model_versions — analysis provenance)
--
-- Idempotent: create-if-not-exists + drop-policy-if-exists throughout.
-- ============================================================


-- ─────────────────────────────────────────────────────────────────────
-- 0. profiles: fields the student job-board query needs.
--    profiles.college_id already exists (incremental_migration.sql) as an
--    FK to public.colleges — this migration is the first thing to actually
--    populate it for candidate accounts (see PATCH /auth/profile).
-- ─────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists domain text
    check (domain in ('tech', 'non-tech'));


-- ─────────────────────────────────────────────────────────────────────
-- 1. skills — shared master taxonomy.
--    First real DB home for the list that student onboarding already uses
--    from the frontend constant SKILLS_MASTER_LIST. job_skills.skill_id
--    FKs here. Candidate onboarding keeps writing profiles.skills text[]
--    (names line up with this seed) — candidate_skills is NOT introduced.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.skills (
  id            uuid         primary key default gen_random_uuid(),
  name          text         not null,
  category      text,
  is_predefined boolean      not null default true,
  created_at    timestamptz  not null default now()
);
create unique index if not exists idx_skills_lower_name on public.skills (lower(name));

insert into public.skills (name, category, is_predefined) values
  ('JavaScript', 'Programming Languages', true),
  ('TypeScript', 'Programming Languages', true),
  ('Python', 'Programming Languages', true),
  ('Java', 'Programming Languages', true),
  ('C++', 'Programming Languages', true),
  ('C', 'Programming Languages', true),
  ('C#', 'Programming Languages', true),
  ('Go', 'Programming Languages', true),
  ('Rust', 'Programming Languages', true),
  ('Kotlin', 'Programming Languages', true),
  ('Swift', 'Programming Languages', true),
  ('Ruby', 'Programming Languages', true),
  ('PHP', 'Programming Languages', true),
  ('R', 'Programming Languages', true),
  ('SQL', 'Programming Languages', true),
  ('React', 'Frontend', true),
  ('Angular', 'Frontend', true),
  ('Vue.js', 'Frontend', true),
  ('Next.js', 'Frontend', true),
  ('HTML/CSS', 'Frontend', true),
  ('Tailwind CSS', 'Frontend', true),
  ('Redux', 'Frontend', true),
  ('Node.js', 'Backend', true),
  ('Express.js', 'Backend', true),
  ('Django', 'Backend', true),
  ('Flask', 'Backend', true),
  ('FastAPI', 'Backend', true),
  ('Spring Boot', 'Backend', true),
  ('.NET', 'Backend', true),
  ('Ruby on Rails', 'Backend', true),
  ('MySQL', 'Databases', true),
  ('PostgreSQL', 'Databases', true),
  ('MongoDB', 'Databases', true),
  ('Redis', 'Databases', true),
  ('Firebase', 'Databases', true),
  ('SQLite', 'Databases', true),
  ('AWS', 'Cloud & DevOps', true),
  ('Microsoft Azure', 'Cloud & DevOps', true),
  ('Google Cloud Platform', 'Cloud & DevOps', true),
  ('Docker', 'Cloud & DevOps', true),
  ('Kubernetes', 'Cloud & DevOps', true),
  ('CI/CD', 'Cloud & DevOps', true),
  ('Git', 'Cloud & DevOps', true),
  ('Linux', 'Cloud & DevOps', true),
  ('Terraform', 'Cloud & DevOps', true),
  ('Machine Learning', 'Data & ML', true),
  ('Deep Learning', 'Data & ML', true),
  ('Data Analysis', 'Data & ML', true),
  ('Pandas', 'Data & ML', true),
  ('NumPy', 'Data & ML', true),
  ('TensorFlow', 'Data & ML', true),
  ('PyTorch', 'Data & ML', true),
  ('Data Visualization', 'Data & ML', true),
  ('Power BI', 'Data & ML', true),
  ('Tableau', 'Data & ML', true),
  ('NLP', 'Data & ML', true),
  ('Computer Vision', 'Data & ML', true),
  ('Android Development', 'Mobile', true),
  ('iOS Development', 'Mobile', true),
  ('React Native', 'Mobile', true),
  ('Flutter', 'Mobile', true),
  ('Manual Testing', 'Testing & QA', true),
  ('Automation Testing', 'Testing & QA', true),
  ('Selenium', 'Testing & QA', true),
  ('Postman', 'Testing & QA', true),
  ('UI/UX Design', 'Design', true),
  ('Figma', 'Design', true),
  ('Adobe Photoshop', 'Design', true),
  ('Graphic Design', 'Design', true),
  ('Product Management', 'Product & Business', true),
  ('Business Analysis', 'Product & Business', true),
  ('Project Management', 'Product & Business', true),
  ('Agile/Scrum', 'Product & Business', true),
  ('Digital Marketing', 'Marketing & Sales', true),
  ('SEO', 'Marketing & Sales', true),
  ('Content Writing', 'Marketing & Sales', true),
  ('Social Media Marketing', 'Marketing & Sales', true),
  ('Sales', 'Marketing & Sales', true),
  ('Market Research', 'Marketing & Sales', true),
  ('Financial Analysis', 'Finance & Ops', true),
  ('Accounting', 'Finance & Ops', true),
  ('Excel', 'Finance & Ops', true),
  ('Operations Management', 'Finance & Ops', true),
  ('Communication', 'Soft Skills', true),
  ('Leadership', 'Soft Skills', true),
  ('Public Speaking', 'Soft Skills', true),
  ('Problem Solving', 'Soft Skills', true),
  ('Teamwork', 'Soft Skills', true)
on conflict (lower(name)) do nothing;


-- ─────────────────────────────────────────────────────────────────────
-- 2. jobs — a company's job description / posting.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id               uuid         primary key default gen_random_uuid(),
  company_id       uuid         not null references public.companies(id) on delete cascade,
  title            text         not null,
  description      text         not null,
  domain           text         not null check (domain in ('tech', 'non-tech')),
  experience_level text         not null
    check (experience_level in ('fresher', '0-1', '1-3', '3-5', '5+')),
  location         text         not null,
  openings_count   integer      not null default 1 check (openings_count >= 1),
  deadline         date         not null,
  visibility       text         not null default 'all' check (visibility in ('all', 'restricted')),
  status           text         not null default 'draft' check (status in ('draft', 'live', 'closed')),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

create index if not exists idx_jobs_company_id      on public.jobs(company_id);
create index if not exists idx_jobs_status          on public.jobs(status);
create index if not exists idx_jobs_status_domain   on public.jobs(status, domain);
create index if not exists idx_jobs_deadline        on public.jobs(deadline);
create index if not exists idx_jobs_created_at      on public.jobs(created_at desc);

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 3. job_skills — many-to-many jobs ↔ skills.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.job_skills (
  job_id   uuid not null references public.jobs(id)   on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  primary key (job_id, skill_id)
);
create index if not exists idx_job_skills_skill_id on public.job_skills(skill_id);


-- ─────────────────────────────────────────────────────────────────────
-- 4. job_visible_colleges — only populated when jobs.visibility = 'restricted'.
--    college_id references the platform-tenant public.colleges table (same
--    one profiles.college_id points at), so the job-board query is a direct
--    membership check.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.job_visible_colleges (
  job_id     uuid not null references public.jobs(id)     on delete cascade,
  college_id uuid not null references public.colleges(id) on delete cascade,
  primary key (job_id, college_id)
);
create index if not exists idx_job_visible_colleges_college_id on public.job_visible_colleges(college_id);


-- ─────────────────────────────────────────────────────────────────────
-- 5. job_weights — one row per job. Separate table (not columns on jobs)
--    so future weight components are additive with no migration. The five
--    components must sum to exactly 100 — enforced here AND in the API.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.job_weights (
  job_id            uuid        primary key references public.jobs(id) on delete cascade,
  resume_weight     smallint    not null check (resume_weight     between 0 and 100),
  github_weight     smallint    not null check (github_weight     between 0 and 100),
  leetcode_weight   smallint    not null check (leetcode_weight   between 0 and 100),
  interview_weight  smallint    not null check (interview_weight  between 0 and 100),
  assessment_weight smallint    not null check (assessment_weight between 0 and 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint job_weights_sum_100 check (
    resume_weight + github_weight + leetcode_weight + interview_weight + assessment_weight = 100
  )
);

drop trigger if exists set_job_weights_updated_at on public.job_weights;
create trigger set_job_weights_updated_at
  before update on public.job_weights
  for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 6. applications — a student's application to one job.
--    company_id is denormalized (from jobs.company_id at insert time) so
--    the company-side RLS policy is a plain equality, not a join.
--    unique (student_id, job_id) is the duplicate-application guard.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.applications (
  id         uuid        primary key default gen_random_uuid(),
  student_id uuid        not null references public.profiles(id)  on delete cascade,
  job_id     uuid        not null references public.jobs(id)      on delete cascade,
  company_id uuid        not null references public.companies(id) on delete cascade,
  status     text        not null default 'applied' check (status in (
               'applied', 'scoring', 'scored', 'shortlisted', 'in_interview', 'hired', 'rejected'
             )),
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, job_id)
);

create index if not exists idx_applications_job_status  on public.applications(job_id, status);
create index if not exists idx_applications_student_id  on public.applications(student_id);
create index if not exists idx_applications_company_id  on public.applications(company_id);

drop trigger if exists set_applications_updated_at on public.applications;
create trigger set_applications_updated_at
  before update on public.applications
  for each row execute procedure public.trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 7. application_analyses — the JOB-SCOPED scoring result.
--    application_id is the primary scoping key (unique — exactly one
--    analysis per application). student_id / job_id / company_id are all
--    denormalized copies of the parent application's, kept in sync by the
--    backend, so both RLS policies are single-column equalities and a
--    student's Job-A score can never be read against Job B / another
--    student / another company.
--    weights_snapshot records the exact five weights used for this run.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.application_analyses (
  id                    uuid        primary key default gen_random_uuid(),
  application_id         uuid        not null unique references public.applications(id) on delete cascade,
  student_id            uuid        not null references public.profiles(id)  on delete cascade,
  job_id               uuid        not null references public.jobs(id)      on delete cascade,
  company_id           uuid        not null references public.companies(id) on delete cascade,
  model_version_id     uuid        references public.model_versions(id),
  analysis_json        jsonb       not null,
  placement_probability numeric    not null check (placement_probability between 0 and 100),
  weighted_composite   numeric     not null check (weighted_composite between 0 and 100),
  weights_snapshot     jsonb       not null,
  generated_at         timestamptz not null default now()
);

create index if not exists idx_application_analyses_job_rank
  on public.application_analyses(job_id, placement_probability desc);
create index if not exists idx_application_analyses_student_id on public.application_analyses(student_id);
create index if not exists idx_application_analyses_company_id on public.application_analyses(company_id);


-- ═════════════════════════════════════════════════════════════════════
-- 8. ROW-LEVEL SECURITY
--
-- Model:
--   * Company user  = auth.uid() owns a public.companies row;
--                     public.current_company_id() resolves it (security definer).
--   * Student user  = auth.uid() == public.profiles.id, role 'candidate'.
--   * The FastAPI backend uses the SERVICE ROLE key and bypasses all of
--     this — these policies are defense-in-depth and also guard the
--     browser's anon-key Supabase client / any future direct access.
-- ═════════════════════════════════════════════════════════════════════

alter table public.skills                enable row level security;
alter table public.jobs                  enable row level security;
alter table public.job_skills            enable row level security;
alter table public.job_visible_colleges  enable row level security;
alter table public.job_weights           enable row level security;
alter table public.applications          enable row level security;
alter table public.application_analyses  enable row level security;


-- ── skills: read-only master list for any signed-in user ──────────────
drop policy if exists skills_read on public.skills;
create policy skills_read on public.skills
  for select using (auth.role() = 'authenticated');


-- ── jobs ─────────────────────────────────────────────────────────────
-- Owning company: full control of its own jobs.
drop policy if exists jobs_company_manage on public.jobs;
create policy jobs_company_manage on public.jobs
  for all
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Students: may read a job only if it is Live AND visible to them
-- (open to all, or their college is on the allow-list).
drop policy if exists jobs_student_read_live on public.jobs;
create policy jobs_student_read_live on public.jobs
  for select using (
    status = 'live'
    and auth.role() = 'authenticated'
    and (
      visibility = 'all'
      or exists (
        select 1
        from public.job_visible_colleges jvc
        join public.profiles p on p.id = auth.uid()
        where jvc.job_id = jobs.id
          and jvc.college_id = p.college_id
      )
    )
  );


-- ── job_skills: company manages own; students read for live jobs ──────
drop policy if exists job_skills_company on public.job_skills;
create policy job_skills_company on public.job_skills
  for all
  using      (job_id in (select id from public.jobs where company_id = public.current_company_id()))
  with check (job_id in (select id from public.jobs where company_id = public.current_company_id()));

drop policy if exists job_skills_student_read on public.job_skills;
create policy job_skills_student_read on public.job_skills
  for select using (
    exists (select 1 from public.jobs j where j.id = job_skills.job_id and j.status = 'live')
  );


-- ── job_visible_colleges: company manages own; students read for live jobs ──
drop policy if exists job_visible_colleges_company on public.job_visible_colleges;
create policy job_visible_colleges_company on public.job_visible_colleges
  for all
  using      (job_id in (select id from public.jobs where company_id = public.current_company_id()))
  with check (job_id in (select id from public.jobs where company_id = public.current_company_id()));

drop policy if exists job_visible_colleges_student_read on public.job_visible_colleges;
create policy job_visible_colleges_student_read on public.job_visible_colleges
  for select using (
    exists (select 1 from public.jobs j where j.id = job_visible_colleges.job_id and j.status = 'live')
  );


-- ── job_weights: company only. NEVER exposed to students. ─────────────
drop policy if exists job_weights_company on public.job_weights;
create policy job_weights_company on public.job_weights
  for all
  using      (job_id in (select id from public.jobs where company_id = public.current_company_id()))
  with check (job_id in (select id from public.jobs where company_id = public.current_company_id()));


-- ── applications ─────────────────────────────────────────────────────
-- Student: full control of their own applications (insert / read / …).
drop policy if exists applications_student_rw on public.applications;
create policy applications_student_rw on public.applications
  for all
  using      (student_id = auth.uid())
  with check (student_id = auth.uid());

-- Company: read applications to its own jobs.
drop policy if exists applications_company_read on public.applications;
create policy applications_company_read on public.applications
  for select using (company_id = public.current_company_id());

-- Company: move an application through the pipeline (status changes) for
-- its own jobs. Cannot re-assign it to another company/job (with check).
drop policy if exists applications_company_update on public.applications;
create policy applications_company_update on public.applications
  for update
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());


-- ── application_analyses ─────────────────────────────────────────────
-- No INSERT/UPDATE/DELETE policy for authenticated users at all — only
-- the service-role backend writes here.
-- Student: read ONLY their own analyses.
drop policy if exists application_analyses_student_read on public.application_analyses;
create policy application_analyses_student_read on public.application_analyses
  for select using (student_id = auth.uid());

-- Company: read ONLY analyses for its own jobs.
drop policy if exists application_analyses_company_read on public.application_analyses;
create policy application_analyses_company_read on public.application_analyses
  for select using (company_id = public.current_company_id());
