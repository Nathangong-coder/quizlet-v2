-- Klt.status (candidate | active | merged | retired), merge pointer, and aliases (2026-09-14).
-- Existing rows become `active`: the legacy tree never had a candidate stage.
ALTER TABLE "Klt" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Klt" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Klt" ADD CONSTRAINT "Klt_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Klt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "KltAlias" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kltId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KltAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KltAlias_normalizedName_key" ON "KltAlias"("normalizedName");
CREATE INDEX "KltAlias_kltId_idx" ON "KltAlias"("kltId");
ALTER TABLE "KltAlias" ADD CONSTRAINT "KltAlias_kltId_fkey" FOREIGN KEY ("kltId") REFERENCES "Klt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
