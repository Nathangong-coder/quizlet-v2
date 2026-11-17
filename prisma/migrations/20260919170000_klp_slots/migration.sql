-- AlterTable
ALTER TABLE "CardKlp" ADD COLUMN     "definitionRef" INTEGER,
ADD COLUMN     "slot" TEXT,
ADD COLUMN     "structured" JSONB;
