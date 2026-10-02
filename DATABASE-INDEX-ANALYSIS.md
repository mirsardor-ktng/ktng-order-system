# DATABASE INDEX ANALYSIS — B2B Order System V2
**Date:** October 2026

This document details the analysis of query patterns across the B2B Order Platform and the exact rationale for added database indexes.

---

## 1. Index Audit by Model

### 1.1. `ProductGroup`
- **Queries:**
  - `ProductGroupService.getCatalogGroups`: `prisma.productGroup.findMany({ where: { isActive: true }, orderBy: { displayName: 'asc' } })`
  - `OrdersService.createOrder`: `prisma.productGroup.findMany({ where: { isActive: true, OR: [...] } })`
- **Missing index:** None existed (table only had primary key `id`).
- **Added Index:**
  - `@@index([isActive, displayName])`
- **Rationale:** Enables an index scan on active logical product groups ordered alphabetically, avoiding sequential table scans.

---

### 1.2. `Promotion`
- **Queries:**
  - `PromotionsService.getApplicablePromotions`:
    ```sql
    WHERE "isActive" = true
      AND ("startDate" IS NULL OR "startDate" <= $1)
      AND ("endDate" IS NULL OR "endDate" >= $1)
    ```
  - SKU & Group checks: filtering by `type`, `sourceProductId`, `sourceGroupId`, `bonusProductId`.
- **Missing index:** Table had ZERO indexes.
- **Added Indexes:**
  - `@@index([isActive, startDate, endDate])` — Primary index for active promotion eligibility resolution.
  - `@@index([type, isActive])` — Fast lookups when filtering promotions by stage (`SKU_BONUS`, `ORDER_PERCENTAGE`, `ORDER_FIXED_AMOUNT`).
  - `@@index([sourceProductId])` — Foreign key index for SKU bonus resolution.
  - `@@index([sourceGroupId])` — Foreign key index for group-level promotion resolution.
  - `@@index([bonusProductId])` — Foreign key index for bonus product joins.

---

### 1.3. `Product`
- **Existing indexes:**
  - `@@index([groupId, isActive, priority])`
- **Queries:**
  - `ProductsService.getProducts`: `where: { isActive: true }, orderBy: [{ isFavorite: 'desc' }, { name: 'asc' }]`
  - `ProductGroupService.getCatalogGroups`: `where: { groupId: null, isActive: true }, orderBy: { name: 'asc' }`
- **Added Index:**
  - `@@index([isActive, isFavorite, name])`
- **Rationale:** Serves customer and seller product catalog queries directly from the B-tree index, removing sort overhead.

---

### 1.4. `Template`
- **Queries:**
  - `compileAndUploadExcel`: `prisma.template.findFirst({ where: { isActive: true } })`
- **Missing index:** Table had ZERO indexes.
- **Added Index:**
  - `@@index([isActive])`
- **Rationale:** O(1) B-tree lookup for the active template.

---

### 1.5. `Order`
- **Existing indexes:**
  - `@@index([customerId, createdAt])`
  - `@@index([status, createdAt])`
  - `@@index([companyId, createdAt])`
  - `@@index([createdByUserId])`
- **Queries:**
  - Server-side date range filtering across all orders (validator/admin views): `where: { createdAt: { gte: start, lt: end } }`
- **Added Index:**
  - `@@index([createdAt])`
- **Rationale:** When an admin or seller views orders without customer/company filter, existing composite indexes cannot be utilized. A standalone `createdAt` index provides optimal index range scans for date periods.

---

### 1.6. `OrderItem`
- **Existing indexes:**
  - `@@index([orderId])`
  - `@@index([productId])`
- **Added Index:**
  - `@@index([groupId])`
- **Rationale:** Accelerates analytical queries, group-level order aggregation, and reporting.

---

### 1.7. `User`
- **Existing indexes:**
  - `@unique email`
- **Queries:**
  - Company user resolution: `where: { companyId }`
  - Role checks: `include: { roleTemplate: true }`
- **Added Indexes:**
  - `@@index([companyId])`
  - `@@index([roleTemplateId])`
- **Rationale:** Foreign key lookups during order permission validation and company membership checks.

---

## 2. Summary of Index Additions

| Model | Index Columns | Purpose |
| :--- | :--- | :--- |
| `ProductGroup` | `[isActive, displayName]` | Fast catalog group listings |
| `Promotion` | `[isActive, startDate, endDate]` | Active date range checks |
| `Promotion` | `[type, isActive]` | Promotion stage filtering |
| `Promotion` | `[sourceProductId]`, `[sourceGroupId]`, `[bonusProductId]` | Foreign key resolution |
| `Product` | `[isActive, isFavorite, name]` | Fast sorted product listing |
| `Template` | `[isActive]` | Active template lookup |
| `Order` | `[createdAt]` | Global period date filtering |
| `OrderItem` | `[groupId]` | Logical product aggregation |
| `User` | `[companyId]`, `[roleTemplateId]` | Company & role relations |
