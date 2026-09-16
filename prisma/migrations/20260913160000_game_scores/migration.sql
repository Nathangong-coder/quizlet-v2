-- Game leaderboards (2026-09-13): one row per finished run.
CREATE TABLE "GameScore" (
    "id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameScore_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameScore_setId_game_mode_score_idx" ON "GameScore"("setId", "game", "mode", "score");
CREATE INDEX "GameScore_userId_idx" ON "GameScore"("userId");
ALTER TABLE "GameScore" ADD CONSTRAINT "GameScore_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameScore" ADD CONSTRAINT "GameScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
