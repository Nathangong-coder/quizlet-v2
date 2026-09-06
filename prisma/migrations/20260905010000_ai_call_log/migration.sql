-- prisma/migrations/20260905010000_ai_call_log/migration.sql
--
-- One row per AI ATTEMPT, so model performance can be benchmarked per task.
--
-- Attempt, not per call: `generateJson` rotates through credentials on failure,
-- so a single logical request can touch three models. Logging only the winner
-- would hide exactly the thing worth measuring — which models fail, on which
-- tasks, and how often.
CREATE TABLE "AiCallLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    -- NULL when the credential was deleted afterwards; the log outlives it.
    "credentialId" TEXT,
    "credentialLabel" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    -- FailureKind from src/lib/errors/classify.ts. NULL on success.
    "failureKind" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiCallLog_task_createdAt_idx" ON "AiCallLog"("task", "createdAt");
CREATE INDEX "AiCallLog_userId_createdAt_idx" ON "AiCallLog"("userId", "createdAt");
CREATE INDEX "AiCallLog_model_createdAt_idx" ON "AiCallLog"("model", "createdAt");

ALTER TABLE "AiCallLog" ADD CONSTRAINT "AiCallLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
