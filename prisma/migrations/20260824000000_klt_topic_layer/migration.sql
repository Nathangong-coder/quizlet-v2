-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "kltError" TEXT,
ADD COLUMN     "kltStatus" TEXT NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "CardKlp" ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "Klt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Klt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KlpTopic" (
    "id" TEXT NOT NULL,
    "klpId" TEXT NOT NULL,
    "kltId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "KlpTopic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Klt_normalizedName_key" ON "Klt"("normalizedName");

-- CreateIndex
CREATE INDEX "KlpTopic_kltId_idx" ON "KlpTopic"("kltId");

-- CreateIndex
CREATE INDEX "KlpTopic_klpId_rank_idx" ON "KlpTopic"("klpId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "KlpTopic_klpId_kltId_key" ON "KlpTopic"("klpId", "kltId");

-- AddForeignKey
ALTER TABLE "KlpTopic" ADD CONSTRAINT "KlpTopic_klpId_fkey" FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlpTopic" ADD CONSTRAINT "KlpTopic_kltId_fkey" FOREIGN KEY ("kltId") REFERENCES "Klt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

