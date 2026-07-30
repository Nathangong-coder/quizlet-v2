-- AlterTable
ALTER TABLE "StudyEvent" ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "confidenceBefore" INTEGER;

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "QuizAnswer" ADD COLUMN     "latencyMs" INTEGER;

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "categoryIds" JSONB,
    "insight" JSONB,
    "insightAt" TIMESTAMP(3),

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudySession_userId_startedAt_idx" ON "StudySession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "StudySession_userId_kind_startedAt_idx" ON "StudySession"("userId", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "StudyEvent_sessionId_idx" ON "StudyEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_sessionId_key" ON "QuizAttempt"("sessionId");

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Envelope backfill: give every pre-existing QuizAttempt a StudySession so the
-- activity feed reads from one table instead of UNIONing sessions with
-- session-less attempts. The session reuses the attempt's own id, which is
-- already unique and makes the link deterministic and trivially reversible.
-- Only the envelope is backfilled: durationMs, endedAt and insight stay NULL
-- because that data was never recorded and must not be invented.
INSERT INTO "StudySession" ("id", "userId", "setId", "kind", "startedAt", "itemCount", "categoryIds")
SELECT
  a."id",
  a."userId",
  a."setId",
  'quiz',
  a."createdAt",
  (SELECT COUNT(*) FROM "QuizAnswer" ans WHERE ans."attemptId" = a."id"),
  a."categoryIds"
FROM "QuizAttempt" a;

UPDATE "QuizAttempt" SET "sessionId" = "id";
