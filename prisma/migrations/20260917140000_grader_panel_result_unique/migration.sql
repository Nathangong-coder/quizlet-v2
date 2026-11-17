-- Spec 5 Phase A §8 (Task 11 review): one GraderPanelResult per
-- (answer, graderVersion, model). This is the bench-grader planner's
-- idempotency key (`planBench`), now enforced by the database rather than
-- only by the plan — a second run that raced the first, or a planner bug,
-- can no longer write two results for one key and leave `selectCardResults`
-- to pick between them. The table was empty at deploy (checked read-only);
-- additive only.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`
-- and trimmed of the five pre-existing drift lines (three index drops and
-- the sibling branch's StudyEvent.selfRating* / LearnerTuning.captureSelfRating)
-- that belong to other work.

-- CreateIndex
CREATE UNIQUE INDEX "GraderPanelResult_answerId_graderVersion_model_key" ON "GraderPanelResult"("answerId", "graderVersion", "model");
