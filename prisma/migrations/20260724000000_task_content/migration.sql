-- AlterTable: add flexible content storage for task activities (links, video,
-- quiz/survey questions) and response storage for how a user answered them.
ALTER TABLE "Task" ADD COLUMN "content" JSONB;
ALTER TABLE "TaskCompletion" ADD COLUMN "responses" JSONB;