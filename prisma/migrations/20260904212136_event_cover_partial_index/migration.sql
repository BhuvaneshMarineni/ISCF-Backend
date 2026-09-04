/*
  Warnings:

  - Made the column `isCover` on table `event_images` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "event_images_eventId_isCover_key";

-- AlterTable
UPDATE "event_images" SET "isCover" = false WHERE "isCover" IS NULL;
ALTER TABLE "event_images" ALTER COLUMN "isCover" SET NOT NULL,
ALTER COLUMN "isCover" SET DEFAULT false;

CREATE UNIQUE INDEX "event_images_one_cover_per_event_idx"
ON "event_images" ("eventId")
WHERE "isCover" = true;
