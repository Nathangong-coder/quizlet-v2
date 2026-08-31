-- Private folders group sets, postmortems, and study notes without changing
-- the meaning of any existing learner-memory rows.
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FolderSet" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FolderPostmortem" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "postmortemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderPostmortem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "analysis" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudyNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FolderNote" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Folder_userId_name_key" ON "Folder"("userId", "name");
CREATE INDEX "Folder_userId_updatedAt_idx" ON "Folder"("userId", "updatedAt");
CREATE UNIQUE INDEX "FolderSet_folderId_setId_key" ON "FolderSet"("folderId", "setId");
CREATE INDEX "FolderSet_setId_idx" ON "FolderSet"("setId");
CREATE UNIQUE INDEX "FolderPostmortem_folderId_postmortemId_key" ON "FolderPostmortem"("folderId", "postmortemId");
CREATE INDEX "FolderPostmortem_postmortemId_idx" ON "FolderPostmortem"("postmortemId");
CREATE INDEX "StudyNote_userId_updatedAt_idx" ON "StudyNote"("userId", "updatedAt");
CREATE UNIQUE INDEX "FolderNote_folderId_noteId_key" ON "FolderNote"("folderId", "noteId");
CREATE INDEX "FolderNote_noteId_idx" ON "FolderNote"("noteId");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderSet" ADD CONSTRAINT "FolderSet_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderSet" ADD CONSTRAINT "FolderSet_setId_fkey"
    FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderPostmortem" ADD CONSTRAINT "FolderPostmortem_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderPostmortem" ADD CONSTRAINT "FolderPostmortem_postmortemId_fkey"
    FOREIGN KEY ("postmortemId") REFERENCES "PostmortemSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNote" ADD CONSTRAINT "StudyNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderNote" ADD CONSTRAINT "FolderNote_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderNote" ADD CONSTRAINT "FolderNote_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "StudyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
