-- AlterTable
ALTER TABLE "Klt" ADD COLUMN     "ancestorIds" TEXT[],
ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentKltId" TEXT;

-- CreateIndex
CREATE INDEX "Klt_parentKltId_idx" ON "Klt"("parentKltId");

-- CreateIndex
CREATE INDEX "Klt_depth_idx" ON "Klt"("depth");

-- AddForeignKey
ALTER TABLE "Klt" ADD CONSTRAINT "Klt_parentKltId_fkey" FOREIGN KEY ("parentKltId") REFERENCES "Klt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (hand-added: GIN index for containment queries on ancestorIds;
-- not expressible in Prisma schema syntax, so it will not appear in a later
-- `prisma migrate diff` — that is expected, not drift.)
CREATE INDEX "Klt_ancestorIds_idx" ON "Klt" USING GIN ("ancestorIds");
