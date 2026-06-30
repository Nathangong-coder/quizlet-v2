-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "categoryIds" JSONB,
ADD COLUMN     "failedOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promptSide" TEXT,
ADD COLUMN     "questionMode" TEXT,
ADD COLUMN     "starredOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CardCategory" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardCategoryAssignment" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CardCategoryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardContentBlock" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "assetId" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "cardId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardCategory_setId_idx" ON "CardCategory"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCategory_setId_normalizedName_key" ON "CardCategory"("setId", "normalizedName");

-- CreateIndex
CREATE INDEX "CardCategoryAssignment_categoryId_idx" ON "CardCategoryAssignment"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCategoryAssignment_cardId_categoryId_key" ON "CardCategoryAssignment"("cardId", "categoryId");

-- CreateIndex
CREATE INDEX "CardContentBlock_cardId_side_position_idx" ON "CardContentBlock"("cardId", "side", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CardAsset_storageKey_key" ON "CardAsset"("storageKey");

-- CreateIndex
CREATE INDEX "CardAsset_userId_idx" ON "CardAsset"("userId");

-- CreateIndex
CREATE INDEX "CardAsset_setId_idx" ON "CardAsset"("setId");

-- AddForeignKey
ALTER TABLE "CardCategory" ADD CONSTRAINT "CardCategory_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCategoryAssignment" ADD CONSTRAINT "CardCategoryAssignment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCategoryAssignment" ADD CONSTRAINT "CardCategoryAssignment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CardCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardContentBlock" ADD CONSTRAINT "CardContentBlock_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardContentBlock" ADD CONSTRAINT "CardContentBlock_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
