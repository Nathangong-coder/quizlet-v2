-- How the reference answer scored on each final KLP, in KLP order.
--
-- Nullable with no backfill, deliberately. Every existing run discarded these
-- verdicts after computing the separation score, and they cannot be recovered
-- without re-grading — which would cost real AI calls to reproduce a number
-- for a KLP set that may since have been superseded. A per-KLP information
-- measure is therefore forward-looking, and the NULLs say so honestly.
ALTER TABLE "CardAuthoring" ADD COLUMN "referenceVerdicts" JSONB;
