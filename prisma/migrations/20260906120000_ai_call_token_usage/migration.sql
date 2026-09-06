-- prisma/migrations/20260906120000_ai_call_token_usage/migration.sql
--
-- Token usage per AI attempt, so cost is measurable rather than guessed.
--
-- All NULLABLE. A failed attempt usually reports no usage at all, and nothing
-- before this migration recorded any -- and a 0 would be a claim that the call
-- was free, which would make every cost total silently understate.
--
-- reasoningTokens is broken out because it is normally the MAJORITY of output
-- and is invisible in the text: one grading call spent 1,963 output tokens of
-- which 1,589 were reasoning. Counting only visible text is wrong by ~5x.
ALTER TABLE "AiCallLog" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "AiCallLog" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "AiCallLog" ADD COLUMN "reasoningTokens" INTEGER;
ALTER TABLE "AiCallLog" ADD COLUMN "cachedTokens" INTEGER;
