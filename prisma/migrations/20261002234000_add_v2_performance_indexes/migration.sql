-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderItem_groupId_idx" ON "OrderItem"("groupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_isActive_isFavorite_name_idx" ON "Product"("isActive", "isFavorite", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductGroup_isActive_displayName_idx" ON "ProductGroup"("isActive", "displayName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_isActive_startDate_endDate_idx" ON "Promotion"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_type_isActive_idx" ON "Promotion"("type", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_sourceProductId_idx" ON "Promotion"("sourceProductId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_sourceGroupId_idx" ON "Promotion"("sourceGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_bonusProductId_idx" ON "Promotion"("bonusProductId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Template_isActive_idx" ON "Template"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_roleTemplateId_idx" ON "User"("roleTemplateId");
