-- ============================================================
-- Online Assessment — webcam snapshots (proctoring)
--
-- ADDITIVE ONLY. Run AFTER db/online_assessment_events_migration.sql.
--
--   oa_assessments.webcam_mode   off | optional | required   (company's choice per assessment)
--   oa_attempts.webcam_mode      the policy that applied when the candidate started (assessments
--                                lock once anyone starts, so this only records it)
--   oa_attempts.webcam_consent_at  when the candidate agreed to camera monitoring. NULL = no
--                                snapshot is accepted from them, whatever the mode.
--   oa_snapshots                 one row per stored photo; the JPEG lives in the PRIVATE storage
--                                bucket `oa-proctoring` (created on first upload) and is only
--                                ever served to the owning company through short-lived signed URLs.
--   oa_attempts.snapshots_*      counters so the results list needs no extra query
--
-- Retention: scripts/purge_oa_snapshots.py deletes photos (storage + rows) older than
-- OA_SNAPSHOT_RETENTION_DAYS (default 30). Run it daily.
-- Idempotent.
-- ============================================================

alter table public.oa_assessments
  add column if not exists webcam_mode text not null default 'off'
    check (webcam_mode in ('off', 'optional', 'required'));

alter table public.oa_attempts
  add column if not exists webcam_mode text not null default 'off',
  add column if not exists webcam_consent_at timestamptz,
  add column if not exists snapshots_taken int not null default 0,
  add column if not exists snapshots_no_face int not null default 0,
  add column if not exists snapshots_multi_face int not null default 0,
  add column if not exists last_snapshot_at timestamptz;

create table if not exists public.oa_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  attempt_id  uuid        not null references public.oa_attempts(id) on delete cascade,
  question_id uuid                 references public.oa_questions(id) on delete set null,
  path        text        not null,            -- object path inside the oa-proctoring bucket
  taken_at    timestamptz not null default now(),
  bytes       int         not null,
  faces       int                              -- faces the BROWSER counted (null = it couldn't tell); untrusted
);

create index if not exists idx_oa_snapshots_attempt on public.oa_snapshots(attempt_id, taken_at);
create index if not exists idx_oa_snapshots_taken on public.oa_snapshots(taken_at);

alter table public.oa_snapshots enable row level security;   -- no policies: service role only

-- three more timeline events (see online_assessment_events_migration.sql)
alter table public.oa_events drop constraint if exists oa_events_type_check;
alter table public.oa_events add constraint oa_events_type_check check (type in (
  'tab_switch', 'tab_return', 'window_blur', 'window_focus',
  'fullscreen_exit', 'fullscreen_enter', 'paste', 'copy', 'cut',
  'camera_denied', 'camera_lost', 'camera_restored'));
