-- Subject taxonomy (2026-09-13): Set.subject holds a leaf slug from the fixed
-- tree in src/lib/subjects/taxonomy.ts. Nullable, no backfill — a subject is
-- a claim the owner makes, not one a migration can guess.
ALTER TABLE "Set" ADD COLUMN "subject" TEXT;
CREATE INDEX "Set_subject_idx" ON "Set"("subject");
