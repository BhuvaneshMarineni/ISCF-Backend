/*
  Warnings:

  - You are about to drop the column `status` on the `events` table. All the data in the column will be lost.

*/
-- CreateEnum
ALTER TYPE "EventStatus" RENAME TO "ContentStatus";

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- DropIndex
DROP INDEX "events_status_eventDate_idx";

-- AlterTable
ALTER TABLE "events" RENAME COLUMN "status" TO "publicationStatus";
ALTER TABLE "events"
ADD COLUMN     "recurrenceDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3),
ADD COLUMN     "recurrenceType" "RecurrenceType" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "events_publicationStatus_eventDate_idx" ON "events"("publicationStatus", "eventDate");
