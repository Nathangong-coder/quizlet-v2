-- 2026-09-16: the minted topic fragment lives on the card, so the tree can be rebuilt from the database.
ALTER TABLE "Card" ADD COLUMN "topicProposal" JSONB;
ALTER TABLE "Card" ADD COLUMN "topicKlpVersion" INTEGER;
