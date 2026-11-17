-- Spec 5 Phase A §6: regrade generations.
--
-- `npm run regrade` re-runs the grader over stored answers and writes a NEW
-- generation of analysis rows under the current GRADER_VERSION, marking the
-- old generation `supersededAt` rather than deleting it. A regrade therefore
-- needs to hold two rows for the same (answer, key point) at once, which the
-- three (quizAnswerId, X) unique constraints forbade. They are replaced by
-- PARTIAL unique indexes over the live generation only — the same invariant
-- ("one live verdict per answer per key point"), scoped to rows nothing has
-- superseded. Prisma cannot declare a partial index, so those three live in
-- this file only and are invisible to `migrate diff`; the plain
-- (quizAnswerId, X) indexes declared in the schema serve the cascade and
-- generation-agnostic reads.
--
-- Also the unique ruled in from Task 6: one CardFormRequirement per
-- (cardId, klpVersion, index). Verified 2026-09-17 that the live table held
-- no duplicate triple before adding it, so no dedupe step is needed.

-- AlterTable
ALTER TABLE "AnswerErrorTag" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AnswerFormResult" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AnswerKlpResult" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AnswerRelationResult" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AnswerUnwarrantedClaim" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuizAnswer" ADD COLUMN     "regradedAt" TIMESTAMP(3);

-- DropIndex: the whole-table uniques a second generation cannot coexist with.
DROP INDEX "AnswerFormResult_quizAnswerId_formRequirementId_key";

-- DropIndex
DROP INDEX "AnswerKlpResult_quizAnswerId_klpId_key";

-- DropIndex
DROP INDEX "AnswerRelationResult_quizAnswerId_relationId_key";

-- CreateIndex: the LIVE-generation uniques (partial; undeclared in schema.prisma by necessity).
CREATE UNIQUE INDEX "AnswerKlpResult_live_key" ON "AnswerKlpResult"("quizAnswerId", "klpId") WHERE "supersededAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AnswerRelationResult_live_key" ON "AnswerRelationResult"("quizAnswerId", "relationId") WHERE "supersededAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AnswerFormResult_live_key" ON "AnswerFormResult"("quizAnswerId", "formRequirementId") WHERE "supersededAt" IS NULL;

-- CreateIndex
CREATE INDEX "AnswerFormResult_quizAnswerId_formRequirementId_idx" ON "AnswerFormResult"("quizAnswerId", "formRequirementId");

-- CreateIndex
CREATE INDEX "AnswerKlpResult_quizAnswerId_klpId_idx" ON "AnswerKlpResult"("quizAnswerId", "klpId");

-- CreateIndex
CREATE INDEX "AnswerRelationResult_quizAnswerId_relationId_idx" ON "AnswerRelationResult"("quizAnswerId", "relationId");

-- CreateIndex
CREATE INDEX "AnswerUnwarrantedClaim_quizAnswerId_idx" ON "AnswerUnwarrantedClaim"("quizAnswerId");

-- DropIndex: subsumed by the unique below (same leading columns).
DROP INDEX "CardFormRequirement_cardId_klpVersion_idx";

-- CreateIndex
CREATE UNIQUE INDEX "CardFormRequirement_cardId_klpVersion_index_key" ON "CardFormRequirement"("cardId", "klpVersion", "index");
