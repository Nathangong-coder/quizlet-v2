-- CreateTable
CREATE TABLE "LearnerTuning" (
    "userId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'balanced',
    "bands" JSONB,
    "thresholds" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerTuning_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "LearnerTuning" ADD CONSTRAINT "LearnerTuning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

