-- ============================================================
-- AI Interviews: lifecycle — Mirracle
-- Run AFTER ai_interview_hiring_migration.sql. Idempotent.
--
-- What it adds, so an interview can never get stuck:
--   invites.reminded_at          the automatic "your invitation expires soon" email was sent
--   invites.retakes              how many times the hiring team has allowed a retake
--   invites.accommodation_*      a candidate asked for an accommodation (extra time, etc.)
--   invites.integrity_review     the hiring team's call on the integrity flags (dismissed / confirmed)
--   invites.candidate_notified_at the candidate was emailed the outcome
--   sessions.ended_reason        why a session ended without a report (interviewer_unavailable, swept)
-- ============================================================

alter table public.ai_interview_invites
  add column if not exists reminded_at           timestamptz,
  add column if not exists retakes               integer      not null default 0,
  add column if not exists accommodation_request text,
  add column if not exists accommodation_at      timestamptz,
  add column if not exists integrity_review      text,
  add column if not exists integrity_note        text,
  add column if not exists candidate_notified_at timestamptz;

alter table public.ai_interview_invites
  drop constraint if exists ai_interview_invites_integrity_review_check;
alter table public.ai_interview_invites
  add constraint ai_interview_invites_integrity_review_check
  check (integrity_review is null or integrity_review in ('dismissed','confirmed'));

alter table public.ai_voice_interview_sessions
  add column if not exists ended_reason text;

-- The maintenance job looks up open invitations by expiry, and stuck sessions by start time.
create index if not exists idx_ai_interview_invites_expiry
  on public.ai_interview_invites(expires_at) where status = 'invited';
create index if not exists idx_ai_voice_interview_sessions_open
  on public.ai_voice_interview_sessions(started_at) where status = 'started';
