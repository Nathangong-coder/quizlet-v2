-- Folder metadata stays small and local to the folder surface. Pinned folders
-- are the subset rendered in the application rail.
ALTER TABLE "Folder" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Folder" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Folder_userId_pinned_updatedAt_idx" ON "Folder"("userId", "pinned", "updatedAt");
