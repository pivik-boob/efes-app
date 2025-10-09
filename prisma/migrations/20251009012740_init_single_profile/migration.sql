-- CreateEnum
CREATE TYPE "BottleDesign" AS ENUM ('EFES', 'MILLER', 'KRUZHKA_SVEZHEGO', 'BELY_MEDVED');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "mood" TEXT NOT NULL,
    "bottleDesign" "BottleDesign" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_telegramUsername_key" ON "Profile"("telegramUsername");
