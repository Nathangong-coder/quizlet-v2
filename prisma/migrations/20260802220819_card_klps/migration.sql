-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "klpError" TEXT,
ADD COLUMN     "klpSourceHash" TEXT,
ADD COLUMN     "klpStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "klpVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CardKlp" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardKlp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "statement" TEXT,
    "isTrue" BOOLEAN,
    "options" JSONB,
    "targetKlpIds" JSONB NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardKlp_cardId_supersededAt_idx" ON "CardKlp"("cardId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardKlp_cardId_version_index_key" ON "CardKlp"("cardId", "version", "index");

-- CreateIndex
CREATE INDEX "QuizQuestion_attemptId_idx" ON "QuizQuestion"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_attemptId_cardId_mode_key" ON "QuizQuestion"("attemptId", "cardId", "mode");

-- AddForeignKey
ALTER TABLE "CardKlp" ADD CONSTRAINT "CardKlp_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
