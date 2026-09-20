-- AlterTable
ALTER TABLE "CardAuthoring" ADD COLUMN     "combinedSeparation" DOUBLE PRECISION,
ADD COLUMN     "referenceRelationVerdicts" JSONB,
ADD COLUMN     "relationSeparation" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "AuthoringProbe" ADD COLUMN     "relationVerdicts" JSONB;
