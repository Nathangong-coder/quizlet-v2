-- prisma/migrations/20260904000000_klp_authoring/migration.sql

CREATE TABLE "CardAuthoring" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "referenceAnswer" TEXT NOT NULL,
    "separationScore" DOUBLE PRECISION NOT NULL,
    "revisions" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardAuthoring_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardAuthoring_cardId_createdAt_idx" ON "CardAuthoring"("cardId", "createdAt");
ALTER TABLE "CardAuthoring" ADD CONSTRAINT "CardAuthoring_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthoringProbe" (
    "id" TEXT NOT NULL,
    "authoringId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "verdicts" JSONB NOT NULL,
    CONSTRAINT "AuthoringProbe_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthoringProbe_authoringId_idx" ON "AuthoringProbe"("authoringId");
ALTER TABLE "AuthoringProbe" ADD CONSTRAINT "AuthoringProbe_authoringId_fkey"
    FOREIGN KEY ("authoringId") REFERENCES "CardAuthoring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KlpRelation" (
    "id" TEXT NOT NULL,
    "fromKlpId" TEXT NOT NULL,
    "toKlpId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "probe" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KlpRelation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KlpRelation_fromKlpId_toKlpId_type_key" ON "KlpRelation"("fromKlpId", "toKlpId", "type");
CREATE INDEX "KlpRelation_fromKlpId_idx" ON "KlpRelation"("fromKlpId");
CREATE INDEX "KlpRelation_toKlpId_idx" ON "KlpRelation"("toKlpId");
ALTER TABLE "KlpRelation" ADD CONSTRAINT "KlpRelation_fromKlpId_fkey"
    FOREIGN KEY ("fromKlpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KlpRelation" ADD CONSTRAINT "KlpRelation_toKlpId_fkey"
    FOREIGN KEY ("toKlpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
