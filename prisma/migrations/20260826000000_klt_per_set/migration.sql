-- CreateTable
CREATE TABLE "SetKltNode" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "kltId" TEXT NOT NULL,
    "parentKltId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "ancestorIds" TEXT[],

    CONSTRAINT "SetKltNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KltPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paths" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KltPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetKltNode_setId_parentKltId_idx" ON "SetKltNode"("setId", "parentKltId");

-- CreateIndex
CREATE INDEX "SetKltNode_setId_depth_idx" ON "SetKltNode"("setId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "SetKltNode_setId_kltId_key" ON "SetKltNode"("setId", "kltId");

-- CreateIndex
CREATE UNIQUE INDEX "KltPreset_name_key" ON "KltPreset"("name");

-- AddForeignKey
ALTER TABLE "SetKltNode" ADD CONSTRAINT "SetKltNode_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetKltNode" ADD CONSTRAINT "SetKltNode_kltId_fkey" FOREIGN KEY ("kltId") REFERENCES "Klt"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex (hand-added; ancestorIds needs GIN for the containment queries the rollup runs on every dashboard load)
CREATE INDEX "SetKltNode_ancestorIds_idx" ON "SetKltNode" USING GIN ("ancestorIds");
