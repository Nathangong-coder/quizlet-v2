-- Framing points (2026-09-12): CardKlp.role and CardAuthoring.substanceSeparation.
-- Both nullable, no backfill: rows written before this migration never ran the
-- classification and must not read as if they had.
ALTER TABLE "CardKlp" ADD COLUMN "role" TEXT;
ALTER TABLE "CardAuthoring" ADD COLUMN "substanceSeparation" DOUBLE PRECISION;
