-- Spec 5 Phase A §8: the grader benchmark's three tables. Additive only.
--
-- GraderPanel: one adversary-written panel per (card, klpVersion, kind) —
-- `levels` (expert / competent / weak / wrong with intended ranks) or
-- `modes` (one answer per failure shape). A re-authored card is a new
-- klpVersion and so a new panel; the old one stays as history and dies with
-- the card. GraderPanelAnswer: the answer text plus the adversary's stated
-- intent (level | mode, intendedRank, rationale) — the grader is shown the
-- text alone. GraderPanelResult: the runtime grader's per-KLP / relation /
-- form verdicts on one answer under one (graderVersion, promptVersion,
-- model), so a grader change is a new result row against a fixed panel.
-- Scoring is computed in TypeScript from these columns; nothing derived is
-- stored. Every table cascades from its parent.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`
-- and trimmed of the five pre-existing drift lines (three index drops and
-- the sibling branch's StudyEvent.selfRating* / LearnerTuning.captureSelfRating)
-- that belong to other work.

-- CreateTable
CREATE TABLE "GraderPanel" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraderPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraderPanelAnswer" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "level" TEXT,
    "mode" TEXT,
    "intendedRank" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "GraderPanelAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraderPanelResult" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "graderVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "verdicts" JSONB NOT NULL,
    "relationVerdicts" JSONB NOT NULL,
    "formVerdicts" JSONB NOT NULL,
    "unresolvedQuotes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraderPanelResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GraderPanel_cardId_klpVersion_kind_key" ON "GraderPanel"("cardId", "klpVersion", "kind");

-- CreateIndex
CREATE INDEX "GraderPanelAnswer_panelId_idx" ON "GraderPanelAnswer"("panelId");

-- CreateIndex
CREATE INDEX "GraderPanelResult_answerId_idx" ON "GraderPanelResult"("answerId");

-- AddForeignKey
ALTER TABLE "GraderPanel" ADD CONSTRAINT "GraderPanel_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraderPanelAnswer" ADD CONSTRAINT "GraderPanelAnswer_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "GraderPanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraderPanelResult" ADD CONSTRAINT "GraderPanelResult_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "GraderPanelAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
