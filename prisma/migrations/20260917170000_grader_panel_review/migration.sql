-- Spec 5 benchmark: the reconciliation pass. Additive.
CREATE TABLE "GraderPanelReview" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "graderVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "disagreement" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "manualVerdict" TEXT,
    "manualNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraderPanelReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GraderPanelReview_resultId_idx" ON "GraderPanelReview"("resultId");
CREATE INDEX "GraderPanelReview_outcome_idx" ON "GraderPanelReview"("outcome");
ALTER TABLE "GraderPanelReview" ADD CONSTRAINT "GraderPanelReview_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "GraderPanelResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
