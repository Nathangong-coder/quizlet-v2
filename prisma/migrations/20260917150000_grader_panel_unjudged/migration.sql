-- Spec 5 Phase A §8 (final whole-branch review, finding 5): the benchmark's
-- `coverageScore` read only the verdicts the grader RETURNED, so a grader
-- that judged one of seven key points and got it right scored 1.0. The
-- result row now records what the answer was graded AGAINST:
--   judgedOf  — the count of live key points in the prompt;
--   unjudged  — `[{ klpId, weight }]` for every point with no verdict, with
--               weight at grading time so the denominator is computable from
--               the row alone (the same rule `verdicts` follows).
-- `coverageScore` counts unjudged points at 0 credit. Additive only; the
-- table held no rows at deploy (checked read-only), so the defaults exist
-- for the column shape, not for backfill.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`
-- and trimmed of the five pre-existing drift lines (three index drops and
-- the sibling branch's StudyEvent.selfRating* / LearnerTuning.captureSelfRating)
-- that belong to other work.

-- AlterTable
ALTER TABLE "GraderPanelResult" ADD COLUMN     "judgedOf" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unjudged" JSONB NOT NULL DEFAULT '[]';
