-- CreateTable
CREATE TABLE "DefinitionProbe" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "graderVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "verdicts" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "supervision" JSONB,
    "decision" TEXT,
    "findings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefinitionProbe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefinitionProbe_cardId_klpVersion_idx" ON "DefinitionProbe"("cardId", "klpVersion");

-- CreateIndex
CREATE INDEX "DefinitionProbe_outcome_idx" ON "DefinitionProbe"("outcome");

-- AddForeignKey
ALTER TABLE "DefinitionProbe" ADD CONSTRAINT "DefinitionProbe_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
