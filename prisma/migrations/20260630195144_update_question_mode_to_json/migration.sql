/*
  Warnings:

  - The `questionMode` column on the `QuizAttempt` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "QuizAttempt" DROP COLUMN "questionMode",
ADD COLUMN     "questionMode" JSONB;
