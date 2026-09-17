-- Spec 6 (2026-09-17): self-rated confidence capture. Additive only — no row
-- is rewritten, no index added. Rows before this date carry NULL in both
-- StudyEvent columns and are indistinguishable from a later skip (D4/§7).

-- AlterTable
ALTER TABLE "LearnerTuning" ADD COLUMN     "captureSelfRating" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StudyEvent" ADD COLUMN     "selfRating" INTEGER,
ADD COLUMN     "selfRatingMoment" TEXT;
