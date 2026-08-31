-- Allow a folder to contain another folder, while keeping membership
-- explicit and independently removable.
CREATE TABLE "FolderFolder" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FolderFolder_parentId_childId_key" ON "FolderFolder"("parentId", "childId");
CREATE INDEX "FolderFolder_childId_idx" ON "FolderFolder"("childId");

ALTER TABLE "FolderFolder" ADD CONSTRAINT "FolderFolder_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderFolder" ADD CONSTRAINT "FolderFolder_childId_fkey"
    FOREIGN KEY ("childId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
