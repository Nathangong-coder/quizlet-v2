-- prisma/migrations/20260727120000_multi_provider_credentials/migration.sql

-- Drop the one-key-per-user constraint; keep the row itself.
DROP INDEX IF EXISTS "AiCredential_userId_key";

-- AlterTable
ALTER TABLE "AiCredential" ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Default',
ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "defaultModel" TEXT NOT NULL DEFAULT 'gemini-3.6-flash',
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'primary',
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorKind" TEXT;

-- Name the pre-existing Google row so it is recognisable in the new list UI.
UPDATE "AiCredential" SET "label" = 'Google (existing)' WHERE "label" = 'Default';

-- CreateIndex
CREATE INDEX "AiCredential_userId_idx" ON "AiCredential"("userId");
CREATE INDEX "AiCredential_userId_provider_idx" ON "AiCredential"("userId", "provider");

-- CreateTable
CREATE TABLE "AiTaskRouting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "credentialId" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskRouting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskRouting_userId_task_key" ON "AiTaskRouting"("userId", "task");
CREATE INDEX "AiTaskRouting_userId_idx" ON "AiTaskRouting"("userId");

-- AddForeignKey
ALTER TABLE "AiTaskRouting" ADD CONSTRAINT "AiTaskRouting_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskRouting" ADD CONSTRAINT "AiTaskRouting_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "AiCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
