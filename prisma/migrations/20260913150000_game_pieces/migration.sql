-- Learning games (2026-09-13): the game piece layer and the set's last prepare summary.
ALTER TABLE "Set" ADD COLUMN "gamesPreparedAt" TIMESTAMP(3);
ALTER TABLE "Set" ADD COLUMN "gamesPrepareSummary" JSONB;

CREATE TABLE "GamePiece" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "klpId" TEXT,
    "klpVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GamePiece_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GamePiece_setId_klpVersion_idx" ON "GamePiece"("setId", "klpVersion");
CREATE INDEX "GamePiece_cardId_idx" ON "GamePiece"("cardId");
CREATE INDEX "GamePiece_sourceHash_idx" ON "GamePiece"("sourceHash");
ALTER TABLE "GamePiece" ADD CONSTRAINT "GamePiece_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GamePiece" ADD CONSTRAINT "GamePiece_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
