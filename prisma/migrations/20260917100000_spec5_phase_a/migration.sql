-- AlterTable
ALTER TABLE "AnswerKlpResult" ADD COLUMN     "spanEnd" INTEGER,
ADD COLUMN     "spanStart" INTEGER;

-- AlterTable
ALTER TABLE "QuizAnswer" ADD COLUMN     "graderVersion" INTEGER;

-- CreateTable
CREATE TABLE "AnswerRelationResult" (
    "id" TEXT NOT NULL,
    "quizAnswerId" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "credit" DOUBLE PRECISION NOT NULL,
    "provenance" TEXT NOT NULL,
    "evidence" TEXT,
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerRelationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerFormResult" (
    "id" TEXT NOT NULL,
    "quizAnswerId" TEXT NOT NULL,
    "formRequirementId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" TEXT,
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerFormResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerUnwarrantedClaim" (
    "id" TEXT NOT NULL,
    "quizAnswerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "magnitude" INTEGER NOT NULL,
    "evidence" TEXT,
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerUnwarrantedClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardFormRequirement" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardFormRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnswerRelationResult_quizAnswerId_relationId_key" ON "AnswerRelationResult"("quizAnswerId", "relationId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerFormResult_quizAnswerId_formRequirementId_key" ON "AnswerFormResult"("quizAnswerId", "formRequirementId");

-- CreateIndex
CREATE INDEX "CardFormRequirement_cardId_klpVersion_idx" ON "CardFormRequirement"("cardId", "klpVersion");

-- AddForeignKey
ALTER TABLE "AnswerRelationResult" ADD CONSTRAINT "AnswerRelationResult_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerRelationResult" ADD CONSTRAINT "AnswerRelationResult_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "KlpRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerFormResult" ADD CONSTRAINT "AnswerFormResult_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerFormResult" ADD CONSTRAINT "AnswerFormResult_formRequirementId_fkey" FOREIGN KEY ("formRequirementId") REFERENCES "CardFormRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerUnwarrantedClaim" ADD CONSTRAINT "AnswerUnwarrantedClaim_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFormRequirement" ADD CONSTRAINT "CardFormRequirement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
