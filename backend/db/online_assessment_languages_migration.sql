-- ============================================================
-- Online Assessment — Java and C++ for coding problems
--
-- ADDITIVE ONLY. Run AFTER db/online_assessment_coding_migration.sql, then re-run
-- scripts/oa_import/seed_problems.py so each problem gets its `signature` and the
-- extra languages (the seed file already carries both).
--
--   oa_problems.signature  static types inferred from the test data, e.g.
--                          {"params": ["int[]", "int"], "returns": "int[]"}.
--                          Java / C++ starter code and graders are generated from it.
--                          NULL -> the API infers it from the problem's visible examples.
-- Idempotent.
-- ============================================================

alter table public.oa_problems
  add column if not exists signature jsonb;

-- Until the seed is re-run, make the two new languages available on validated
-- problems that can be typed from their examples (the API drops them otherwise).
update public.oa_problems
   set languages = languages || array['java', 'cpp']
 where validated
   and not ('java' = any (languages));
