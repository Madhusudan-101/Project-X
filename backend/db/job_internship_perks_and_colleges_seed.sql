-- ============================================================
-- Internship offer detail + perks on public.jobs, and a starter
-- seed for public.colleges (so the drive scheduler's college picker
-- isn't limited to the two rows a fresh DB has).
--
-- Run AFTER db/jobs_and_applications_migration.sql and
-- db/jobs_eligibility_migration.sql. Idempotent.
-- ============================================================

-- ── 1. Internship-specific offer fields (job level, set once) ────────
-- Meaningful only when jobs.employment_type = 'intern'; ignored otherwise.
-- Stipend uses the same jobs.ctc_currency as the CTC range.
alter table public.jobs
  add column if not exists stipend_min numeric,
  add column if not exists stipend_max numeric,
  add column if not exists internship_duration_months int
    check (internship_duration_months is null
           or (internship_duration_months between 1 and 24)),
  -- Expected annual package if the intern is converted to a full-time PPO.
  add column if not exists ppo_ctc_min numeric,
  add column if not exists ppo_ctc_max numeric;

-- ── 2. Perks / benefits — applies to any job, not just internships ──
-- Free-form list, e.g. {"Relocation assistance","Accommodation",
-- "Health insurance","Certificate & LoR"}.
alter table public.jobs
  add column if not exists perks text[];


-- ── 3. Seed public.colleges ────────────────────────────────────────
-- Short, commonly-used names (matches how candidate_colleges already
-- seeds "IIIT Hyderabad", "LNMIIT Jaipur", "NIT Jalandhar", …). No unique
-- constraint exists on colleges.name, so each row is guarded with a
-- NOT EXISTS on lower(name) — a college already present (under this exact
-- name) is skipped, so re-running is safe.
insert into public.colleges (name, city, state, type)
select v.name, v.city, v.state, v.type
from (values
  ('IIT Bombay',                     'Mumbai',      'Maharashtra',    'IIT'),
  ('IIT Delhi',                      'New Delhi',   'Delhi',          'IIT'),
  ('IIT Madras',                     'Chennai',     'Tamil Nadu',     'IIT'),
  ('IIT Kanpur',                     'Kanpur',      'Uttar Pradesh',  'IIT'),
  ('IIT Kharagpur',                  'Kharagpur',   'West Bengal',    'IIT'),
  ('IIT Roorkee',                    'Roorkee',     'Uttarakhand',    'IIT'),
  ('BITS Pilani',                    'Pilani',      'Rajasthan',      'Private'),
  ('NIT Trichy',                     'Tiruchirappalli', 'Tamil Nadu', 'NIT'),
  ('NIT Surathkal',                  'Mangalore',   'Karnataka',      'NIT'),
  ('IIIT Hyderabad',                 'Hyderabad',   'Telangana',      'IIIT'),
  ('Delhi Technological University', 'New Delhi',   'Delhi',          'State'),
  ('NSUT Delhi',                     'New Delhi',   'Delhi',          'State'),
  ('VIT Vellore',                    'Vellore',     'Tamil Nadu',     'Private'),
  ('LNMIIT Jaipur',                  'Jaipur',      'Rajasthan',      'Private'),
  ('NIT Jalandhar',                  'Jalandhar',   'Punjab',         'NIT'),
  ('Chitkara University',            'Rajpura',     'Punjab',         'Private'),
  ('Manipal Institute of Technology','Manipal',     'Karnataka',      'Private'),
  ('COEP Pune',                      'Pune',        'Maharashtra',    'State')
) as v(name, city, state, type)
where not exists (
  select 1 from public.colleges c where lower(c.name) = lower(v.name)
);
