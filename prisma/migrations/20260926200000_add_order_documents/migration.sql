-- CreateEnum
CREATE TYPE "OrderDocumentType" AS ENUM ('WAREHOUSE_ASSEMBLY_REQUEST');

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'COMMERCIAL';

-- CreateTable
CREATE TABLE "OrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderDocumentType" NOT NULL DEFAULT 'WAREHOUSE_ASSEMBLY_REQUEST',
    "fileId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderDocument_orderId_type_idx" ON "OrderDocument"("orderId", "type");

-- CreateIndex
CREATE INDEX "OrderDocument_createdAt_idx" ON "OrderDocument"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
