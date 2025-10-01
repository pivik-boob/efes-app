/*
  Warnings:

  - You are about to drop the column `age` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `contact` on the `Profile` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."GiftCode_fromUserId_idx";

-- DropIndex
DROP INDEX "public"."GiftCode_toUserId_idx";

-- AlterTable
ALTER TABLE "public"."Meeting" ALTER COLUMN "dayKey" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."Profile" DROP COLUMN "age",
DROP COLUMN "contact",
ADD COLUMN     "age21" BOOLEAN,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "tgUsername" TEXT,
ALTER COLUMN "mood" DROP NOT NULL,
ALTER COLUMN "mood" SET DEFAULT '🙂',
ALTER COLUMN "design" SET DEFAULT 'classic';

-- CreateIndex
CREATE INDEX "Meeting_userAId_metAt_idx" ON "public"."Meeting"("userAId", "metAt");

-- CreateIndex
CREATE INDEX "Meeting_userBId_metAt_idx" ON "public"."Meeting"("userBId", "metAt");
