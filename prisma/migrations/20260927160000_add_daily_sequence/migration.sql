-- CreateTable
CREATE TABLE "DailySequence" (
    "dateKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySequence_pkey" PRIMARY KEY ("dateKey")
);
