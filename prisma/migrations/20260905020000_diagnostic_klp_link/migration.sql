-- prisma/migrations/20260905020000_diagnostic_klp_link/migration.sql
--
-- Anchors a diagnostic question to the CardKlp it probes and to the QuizAnswer
-- its grade was written to, so a completed diagnostic produces
-- AnswerKlpResult/KlpState like every other graded mode instead of moving only
-- card-grain confidence.

ALTER TABLE "DiagnosticAttempt" ADD COLUMN "engineVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "DiagnosticQuestion" ADD COLUMN "klpId" TEXT;
ALTER TABLE "DiagnosticQuestion" ADD COLUMN "quizAnswerId" TEXT;

-- SET NULL on both, deliberately. The question text and the learner's answer
-- are a record of what happened and must survive the removal of a key point or
-- of the answer row. An unattributed question is incomplete; a deleted one is a
-- hole in somebody's history.
ALTER TABLE "DiagnosticQuestion"
  ADD CONSTRAINT "DiagnosticQuestion_klpId_fkey"
  FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticQuestion"
  ADD CONSTRAINT "DiagnosticQuestion_quizAnswerId_fkey"
  FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DiagnosticQuestion_quizAnswerId_key" ON "DiagnosticQuestion"("quizAnswerId");
CREATE INDEX "DiagnosticQuestion_klpId_idx" ON "DiagnosticQuestion"("klpId");

-- Every in-flight attempt at this moment predates the key-point link, so its
-- questions carry no klpId and it can never be graded under the new path.
-- Marked rather than deleted: nothing of a learner's is destroyed, and the
-- submit path keeps exactly ONE code branch instead of a permanent legacy one
-- serving a single abandoned row.
UPDATE "DiagnosticAttempt" SET "status" = 'abandoned' WHERE "status" = 'in_progress';
