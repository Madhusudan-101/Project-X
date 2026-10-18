-- ============================================================
-- Online Assessment — candidate details, pre-test checks, multiple-monitor check
--
-- ADDITIVE ONLY. Run AFTER db/online_assessment_proctoring_migration.sql.
--
--   oa_assessments.monitor_mode    off | optional | required
--                                  required: a candidate whose browser reports more than one
--                                  display cannot start; optional: it is only recorded.
--   oa_attempts.candidate_details  the details the candidate confirmed on the start screen
--                                  (name, phone, college, roll number, branch, year, CGPA)
--   oa_attempts.details_confirmed_at   when they confirmed them and accepted the declaration
--   oa_attempts.precheck           what the pre-test checks found: webcam, displays (single /
--                                  multiple / unknown, and how it was detected), fullscreen,
--                                  browser, screen size. Client-reported: evidence, not proof.
--   oa_events: a new 'multi_monitor' type (a second display appeared DURING the test)
-- Idempotent.
-- ============================================================

alter table public.oa_assessments
  add column if not exists monitor_mode text not null default 'off'
    check (monitor_mode in ('off', 'optional', 'required'));

alter table public.oa_attempts
  add column if not exists candidate_details jsonb,
  add column if not exists details_confirmed_at timestamptz,
  add column if not exists precheck jsonb;

alter table public.oa_events drop constraint if exists oa_events_type_check;
alter table public.oa_events add constraint oa_events_type_check check (type in (
  'tab_switch', 'tab_return', 'window_blur', 'window_focus',
  'fullscreen_exit', 'fullscreen_enter', 'paste', 'copy', 'cut',
  'camera_denied', 'camera_lost', 'camera_restored', 'multi_monitor'));
