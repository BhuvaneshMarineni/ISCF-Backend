/*
  Warnings:

  - Made the column `isCover` on table `gallery_photos` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "gallery_photos_albumId_isCover_key";

-- AlterTable
UPDATE "gallery_photos" SET "isCover" = false WHERE "isCover" IS NULL;
ALTER TABLE "gallery_photos" ALTER COLUMN "isCover" SET NOT NULL,
ALTER COLUMN "isCover" SET DEFAULT false;

CREATE UNIQUE INDEX "gallery_photos_one_cover_per_album_idx"
ON "gallery_photos" ("albumId")
WHERE "isCover" = true;
