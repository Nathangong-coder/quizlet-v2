-- AlterTable
ALTER TABLE "StudyEvent" ADD COLUMN     "quizAnswerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StudyEvent_quizAnswerId_key" ON "StudyEvent"("quizAnswerId");

-- AddForeignKey
ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_quizAnswerId_fkey" FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
