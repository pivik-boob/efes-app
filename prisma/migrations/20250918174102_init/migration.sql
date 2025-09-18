-- CreateTable
CREATE TABLE "public"."Profile" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "mood" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "design" TEXT,
    "photoFileId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."Meeting" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "dayKey" TIMESTAMP(3) NOT NULL,
    "metAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GiftCode" (
    "voucher" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "message" TEXT,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GiftCode_pkey" PRIMARY KEY ("voucher")
);

-- CreateIndex
CREATE INDEX "Meeting_dayKey_idx" ON "public"."Meeting"("dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_pairKey_dayKey_key" ON "public"."Meeting"("pairKey", "dayKey");

-- CreateIndex
CREATE INDEX "GiftCode_toUserId_idx" ON "public"."GiftCode"("toUserId");

-- CreateIndex
CREATE INDEX "GiftCode_fromUserId_idx" ON "public"."GiftCode"("fromUserId");

-- AddForeignKey
ALTER TABLE "public"."GiftCode" ADD CONSTRAINT "GiftCode_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."Profile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GiftCode" ADD CONSTRAINT "GiftCode_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."Profile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
