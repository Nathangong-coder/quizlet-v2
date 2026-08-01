-- Baseline migration. Reconciles four columns that were applied to the
-- database out-of-band (via `prisma db push`) with no corresponding migration
-- file, leaving migration history unable to rebuild the current schema.
--
-- The live database ALREADY has all of these. This migration is registered
-- with `prisma migrate resolve --applied` and is NEVER executed against it.
-- It exists so a FRESH database built from migration history — a new Neon
-- branch, CI, a new checkout — matches prisma/schema.prisma.

-- CardAsset: Stage 5 multimodal fields, plus setId relaxed to nullable so an
-- asset can belong to a user without being bound to a set.
ALTER TABLE "CardAsset" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'file';
ALTER TABLE "CardAsset" ADD COLUMN "textExtract" TEXT;
ALTER TABLE "CardAsset" ALTER COLUMN "setId" DROP NOT NULL;

-- QuizAttempt: Stage 3.5 quiz setup.
ALTER TABLE "QuizAttempt" ADD COLUMN "questionCount" INTEGER;
