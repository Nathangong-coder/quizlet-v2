-- Card text blocks carry safe, renderer-independent paragraph formatting.
ALTER TABLE "CardContentBlock" ADD COLUMN "listType" TEXT;
ALTER TABLE "CardContentBlock" ADD COLUMN "indent" INTEGER NOT NULL DEFAULT 0;
