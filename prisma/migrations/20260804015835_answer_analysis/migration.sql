-- AlterTable
ALTER TABLE "QuizAnswer" ADD COLUMN     "analysisStatus" TEXT,
ADD COLUMN     "analysisVersion" INTEGER,
ADD COLUMN     "analysisWarnings" JSONB;

-- CreateTable
CREATE TABLE "AnswerKlpResult" (
    "id" TEXT NOT NULL,
    "quizAnswerId" TEXT NOT NULL,
    "klpId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "credit" DOUBLE PRECISION NOT NULL,
    "mode" TEXT NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerKlpResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerErrorTag" (
    "id" TEXT NOT NULL,
    "quizAnswerId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "klpId" TEXT,
    "secondaryKlpId" TEXT,
    "relevance" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL,
    "starred" BOOLEAN NOT NULL,
    "significance" INTEGER NOT NULL,
    "quote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerErrorTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnswerKlpResult_klpId_status_idx" ON "AnswerKlpResult"("klpId", "status");

-- CreateIndex
CREATE INDEX "AnswerKlpResult_klpId_createdAt_idx" ON "AnswerKlpResult"("klpId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerKlpResult_quizAnswerId_klpId_key" ON "AnswerKlpResult"("quizAnswerId", "klpId");

-- CreateIndex
CREATE INDEX "AnswerErrorTag_quizAnswerId_idx" ON "AnswerErrorTag"("quizAnswerId");

-- CreateIndex
CREATE INDEX "AnswerErrorTag_klpId_type_idx" ON "AnswerErrorTag"("klpId", "type");

-- CreateIndex
CREATE INDEX "AnswerErrorTag_klpId_secondaryKlpId_type_idx" ON "AnswerErrorTag"("klpId", "secondaryKlpId", "type");

-- AddForeignKey
ALTER TABLE "AnswerKlpResult" ADD CONSTRAINT "AnswerKlpResult_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerKlpResult" ADD CONSTRAINT "AnswerKlpResult_klpId_fkey" FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerErrorTag" ADD CONSTRAINT "AnswerErrorTag_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerErrorTag" ADD CONSTRAINT "AnswerErrorTag_klpId_fkey" FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerErrorTag" ADD CONSTRAINT "AnswerErrorTag_secondaryKlpId_fkey" FOREIGN KEY ("secondaryKlpId") REFERENCES "CardKlp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
