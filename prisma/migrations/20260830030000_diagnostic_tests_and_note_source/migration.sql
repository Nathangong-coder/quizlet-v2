-- Preserve the first note draft so AI-assisted editing can never overwrite it.
ALTER TABLE "StudyNote" ADD COLUMN "originalBody" TEXT;
UPDATE "StudyNote" SET "originalBody" = "body" WHERE "originalBody" IS NULL;

CREATE TABLE "DiagnosticAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "questionCount" INTEGER NOT NULL,
    "score" INTEGER,
    "report" JSONB,
    "reportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DiagnosticAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "learningPoint" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "answer" TEXT,
    "score" INTEGER,
    "status" TEXT,
    "feedback" TEXT,
    "mistake" TEXT,
    "latencyMs" INTEGER,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosticQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticAttempt_sessionId_key" ON "DiagnosticAttempt"("sessionId");
CREATE INDEX "DiagnosticAttempt_userId_createdAt_idx" ON "DiagnosticAttempt"("userId", "createdAt");
CREATE INDEX "DiagnosticAttempt_setId_createdAt_idx" ON "DiagnosticAttempt"("setId", "createdAt");
CREATE UNIQUE INDEX "DiagnosticQuestion_attemptId_position_key" ON "DiagnosticQuestion"("attemptId", "position");
CREATE INDEX "DiagnosticQuestion_attemptId_idx" ON "DiagnosticQuestion"("attemptId");
CREATE INDEX "DiagnosticQuestion_cardId_createdAt_idx" ON "DiagnosticQuestion"("cardId", "createdAt");

ALTER TABLE "DiagnosticAttempt" ADD CONSTRAINT "DiagnosticAttempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticAttempt" ADD CONSTRAINT "DiagnosticAttempt_setId_fkey"
    FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticAttempt" ADD CONSTRAINT "DiagnosticAttempt_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticQuestion" ADD CONSTRAINT "DiagnosticQuestion_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "DiagnosticAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticQuestion" ADD CONSTRAINT "DiagnosticQuestion_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
