-- prisma/migrations/20260906000000_ai_model_attribution/migration.sql
--
-- Which model produced each AI artifact.
--
-- `AiCallLog` already records every attempt, but it is a stream: it is not
-- linked to the artifact, and calls run concurrently (a quiz fans one
-- generation out per card), so joining a row back to its model by user and
-- timestamp is guesswork. These columns travel with the row, written in the
-- same transaction.
--
-- Every column is NULLABLE and stays that way. There is no record anywhere of
-- which model wrote the rows that already exist -- AiCallLog began 2026-09-05
-- and holds a handful of rows -- so nothing can be backfilled and a NOT NULL
-- default would be a fabricated answer to "who made this".

ALTER TABLE "CardKlp" ADD COLUMN "model" TEXT;
ALTER TABLE "QuizAnswer" ADD COLUMN "model" TEXT;
ALTER TABLE "QuizQuestion" ADD COLUMN "model" TEXT;
ALTER TABLE "TrainingPlan" ADD COLUMN "model" TEXT;
ALTER TABLE "StudyNote" ADD COLUMN "model" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "model" TEXT;

-- Per QUESTION, not per attempt: generation is batched and rotates credentials
-- on failure, so one sitting can legitimately carry two models.
ALTER TABLE "DiagnosticQuestion" ADD COLUMN "model" TEXT;

-- Separately named: a diagnostic attempt's own AI content is its report, and
-- its questions carry their own models.
ALTER TABLE "DiagnosticAttempt" ADD COLUMN "reportModel" TEXT;
