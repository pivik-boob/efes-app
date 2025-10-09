-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "metAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_pairKey_dayKey_key" ON "Meeting"("pairKey", "dayKey");
