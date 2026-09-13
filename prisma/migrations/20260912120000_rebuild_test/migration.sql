-- The rebuild test (docs/superpowers/specs/2026-09-12-rebuild-test-design.md).
-- cardCoverage replaces the circular reference score as the completeness
-- number; referenceParity measures extraction loss; cardDisputes is the
-- grader's override channel, a warning to the set owner. Nullable, no
-- backfill: rows authored before this migration have no rebuild and say so.
ALTER TABLE "CardAuthoring" ADD COLUMN "rebuiltAnswer" TEXT;
ALTER TABLE "CardAuthoring" ADD COLUMN "cardCoverage" DOUBLE PRECISION;
ALTER TABLE "CardAuthoring" ADD COLUMN "referenceParity" DOUBLE PRECISION;
ALTER TABLE "CardAuthoring" ADD COLUMN "cardDisputes" JSONB;
ALTER TABLE "CardAuthoring" ADD COLUMN "rebuildVerdicts" JSONB;
