-- DropIndex
DROP INDEX "TaskCompletion_userId_taskId_key";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "maxPerWindow" INTEGER,
ADD COLUMN     "maxTotal" INTEGER;
