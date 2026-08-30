-- Offline study debriefs are private journal evidence, separate from scored
-- StudySession/StudyEvent rows so self-report does not alter mastery.
CREATE TABLE "PostmortemSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT,
    "setTitleSnapshot" TEXT,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER,
    "confidence" INTEGER,
    "whatCameUp" TEXT NOT NULL,
    "wins" TEXT,
    "gaps" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostmortemSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostmortemSession_userId_occurredAt_idx"
    ON "PostmortemSession"("userId", "occurredAt");
CREATE INDEX "PostmortemSession_setId_idx"
    ON "PostmortemSession"("setId");

ALTER TABLE "PostmortemSession" ADD CONSTRAINT "PostmortemSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostmortemSession" ADD CONSTRAINT "PostmortemSession_setId_fkey"
    FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
