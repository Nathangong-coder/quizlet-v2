-- prisma/migrations/20260907000000_shared_credentials/migration.sql
--
-- Lets an owner offer a credential to every user of the install, with a
-- per-borrower token budget.
--
-- Why this exists: a non-technical learner cannot obtain an API key, and being
-- asked for one is where they stop. Sharing the owner's key removes that, at
-- the cost of the owner being billed for other people's requests -- so it is
-- opt-in, OFF by default, and the budget is not optional in practice.
--
-- The budget is PER BORROWER, not a global pool. A shared pool would let the
-- first heavy user exhaust it for everyone, and the owner could not tell a
-- runaway from real demand. Usage is summed from AiCallLog, which already
-- records userId, credentialId and token counts per attempt -- so there is no
-- second counter that can drift, and it survives a redeploy.
ALTER TABLE "AiCredential" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiCredential" ADD COLUMN "sharedTokenBudget" INTEGER;

-- Usage is read as "tokens this user spent on this credential", so the index
-- that matters is (credentialId, userId). Without it the budget check is a
-- sequential scan of the call log on every generation.
CREATE INDEX "AiCallLog_credentialId_userId_idx" ON "AiCallLog"("credentialId", "userId");
