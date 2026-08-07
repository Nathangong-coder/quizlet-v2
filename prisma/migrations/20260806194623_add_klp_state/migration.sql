-- CreateTable
CREATE TABLE "KlpState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "klpId" TEXT NOT NULL,
    "pKnown" DOUBLE PRECISION NOT NULL,
    "observations" INTEGER NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KlpState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KlpState_userId_pKnown_idx" ON "KlpState"("userId", "pKnown");

-- CreateIndex
CREATE UNIQUE INDEX "KlpState_userId_klpId_key" ON "KlpState"("userId", "klpId");

-- AddForeignKey
ALTER TABLE "KlpState" ADD CONSTRAINT "KlpState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlpState" ADD CONSTRAINT "KlpState_klpId_fkey" FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
