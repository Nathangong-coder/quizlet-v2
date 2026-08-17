-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "emailUpdates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handle" TEXT,
ADD COLUMN     "normalizedHandle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedHandle_key" ON "User"("normalizedHandle");

