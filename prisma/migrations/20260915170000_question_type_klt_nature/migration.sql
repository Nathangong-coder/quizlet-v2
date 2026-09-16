-- 2026-09-15: persist the writer's question type; mark what kind of node a topic is.
ALTER TABLE "CardAuthoring" ADD COLUMN "questionType" TEXT;
ALTER TABLE "Klt" ADD COLUMN "nature" TEXT NOT NULL DEFAULT 'concept';
