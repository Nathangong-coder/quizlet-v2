-- Spec 5 benchmark: the expression axis on a panel result (legacy rubric until Phase B). Additive, nullable.
ALTER TABLE "GraderPanelResult" ADD COLUMN "expression" JSONB;
