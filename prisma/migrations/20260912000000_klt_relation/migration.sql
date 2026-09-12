-- KltRelation: a typed, directed edge between two concepts, BESIDE the per-set
-- tree (SetKltNode), never inside it. The tree stays a tree so mastery rollup
-- counts every key point once; the second parent a concept would have had
-- becomes an edge here instead. Never enters the rollup.
--
-- Provenance: `minted` (a key point whose content IS the link, reconciled
-- across two models — item 2's write step) or `projected` (a within-card
-- KlpRelation lifted through its endpoints' topic links — item 3). cardIds and
-- klpIds are the evidence count behind the edge. Acyclicity over the directed
-- types is enforced by the writer, not here.
CREATE TABLE "KltRelation" (
    "id" TEXT NOT NULL,
    "fromKltId" TEXT NOT NULL,
    "toKltId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "cardIds" TEXT[],
    "klpIds" TEXT[],
    "models" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KltRelation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KltRelation_fromKltId_toKltId_type_key" ON "KltRelation"("fromKltId", "toKltId", "type");
CREATE INDEX "KltRelation_toKltId_idx" ON "KltRelation"("toKltId");

ALTER TABLE "KltRelation" ADD CONSTRAINT "KltRelation_fromKltId_fkey" FOREIGN KEY ("fromKltId") REFERENCES "Klt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KltRelation" ADD CONSTRAINT "KltRelation_toKltId_fkey" FOREIGN KEY ("toKltId") REFERENCES "Klt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
