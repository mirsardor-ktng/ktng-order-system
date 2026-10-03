# PERFORMANCE AUDIT REPORT — B2B Order System V2
**Date:** October 2026  
**Environment:** Next.js (App Router, Node.js runtime) + Prisma ORM 5.22.0 + PostgreSQL (Supabase AWS Singapore `aws-1-ap-southeast-1.pooler.supabase.com:5432`)

---

## 1. Executive Summary

A comprehensive architectural and performance audit of the B2B Order System was conducted to investigate critical production bottlenecks:
- **`POST /api/orders/calculate` latency:** 1,787 ms – 11,250 ms (pure math calculation is 0 ms; 100% of time spent on 3 database queries).
- **`Prisma P2024: Timed out fetching a new connection from the connection pool`:** pool size 3, timeout 10s starved by long transactions and burst parallel queries.
- **`GET /api/products` (Catalog):** 4,468 ms (2 sequential queries + 2 implicit relation join queries).
- **`OrdersService.createOrder`:** 32,294 ms (~32.3s):
  - Validation & duplicate DB queries: 5,931 ms.
  - Excel template download, compilation & Google Drive/storage upload: 5,086 ms on the critical path.
  - Stock deduction inside `$transaction`: 16,554 ms (N sequential network roundtrips for 30–40 SKUs).
  - Entire DB transaction duration: 19,934 ms holding an exclusive connection.

---

## 2. Comprehensive Performance Audit Table

| Operation | Current duration | DB queries | Repeated queries | Root cause | Proposed solution | Expected impact | Risk |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GET /api/products (Catalog view)** | ~4,468 ms | 2 sequential queries + 2 relation queries (`tags`, `skus`) | Full table fetch on every customer visit | No in-memory caching of catalog groups; full column fetch without minimal `select`; cross-continental latency to Singapore pooler. | Implement in-memory cache (TTL 60s or version-invalidated) with targeted `select`; parallelize or combine queries. | Latency drops from ~4,468 ms to <100 ms (cache hit) / <600 ms (cache miss). | Low. Stale catalog if cache invalidation on admin edits is missed; mitigated by explicit cache clear on product/group updates. |
| **POST /api/orders/calculate (Cart changes)** | 1,787 – 11,250 ms | 3 parallel queries in `Promise.all` (`Promotion`, `Product`, `ProductGroup`) | 100% repeated on every quantity change (+, -, typing) | Pure math is 0 ms. 100% duration is DB I/O. Calling remote DB on every debounce (350ms) starves pool of 3 connections. | Move pure calculation engine to client-side. Cache server-side Order Calculation Config in memory for authoritative fallback. | Cart updates in 0–1 ms locally. Network calculate requests reduced to 0 for normal cart actions. | Low. Pure math logic must match 100% between client and server. |
| **OrdersService.createOrder (Pre-transaction reads)** | ~5,931 ms | 4–6 queries (`User`, `ProductGroup`, `Product`, + duplicate in `calculateOrder`) | `ProductGroup` and `Product` loaded once in `createOrder`, then loaded a second time inside `calculateOrder` | Redundant duplicate loading of the exact same product and group records across Singapore network. | Pass already-loaded products/groups directly to `calculateOrder` or use shared server cache. Consolidate reads. | Reduces validation & pre-transaction DB time from ~5,931 ms to <800 ms. | None. Exactly same data models used. |
| **OrdersService.compileAndUploadExcel** | ~5,086 ms | 1 query (`Template.findFirst`) + external storage network download + upload | Template queried from DB every order; Excel upload blocks order response | Synchronous file compilation and storage I/O on the critical order creation path. | Offload Excel compilation and storage upload to background asynchronous task after order transaction commits. Return order response immediately. | Eliminates 5,086 ms from order creation latency. | Low. Must ensure background task logs and handles upload failures with retry/status tracking. |
| **Stock Deduction in Transaction** | ~16,554 ms | 30–40 sequential `tx.product.updateMany` calls | 1 sequential roundtrip per ordered SKU in a loop | `for ([productId, neededPacks] of stockDecrements) { await tx.product.updateMany(...) }` executes N sequential queries over ~300ms ping to Singapore. | Batch stock verification and atomic decrement via batch update / batched SQL or parallel atomic updates within transaction. | Reduces stock deduction from 16,554 ms to <800 ms. | Medium. Must strictly guarantee atomic conditional decrement (`stockPacks >= neededPacks`) to prevent overselling. |
| **Database Transaction ($transaction)** | ~19,934 ms | 30–45 sequential queries inside single transaction | All stock updates, promo updates, order create, item create, and SKU allocs | Holding an open PostgreSQL transaction across 30+ network roundtrips keeps connection locked for ~20 seconds. | Minimize transaction scope: batch operations, remove non-essential reads/writes, commit immediately after atomic decrement & order insert. | Reduces transaction time from ~20s to <1.5s, eliminating connection pool starvation. | Low. Preserves full atomicity. |
| **Prisma Connection Pool & P2024** | Timeout at 10s | Burst of 3 concurrent queries per calculate + 20s long transaction | Concurrent requests battle for 3 connections | `connection_limit: 3, timeout: 10` on pooler. 1 long transaction (20s) leaves only 2 connections. Two parallel calculate requests (`Promise.all` with 3 queries each) exceed pool size and time out. | Optimize pool configuration (`connection_limit` tuned appropriately, `pool_timeout` tuned, session vs transaction pooler consideration) + eliminate 20s transactions and eliminate repetitive calculate queries. | Zero P2024 connection pool timeouts under normal load. | Low. |
| **Audit Logging** | ~1,342 ms | 1 query (`AuditLog.create`) | None | Synchronous DB insert after transaction commits. | Optimize audit insert or run asynchronously post-response if compliance permits. | Saves ~500–1,300 ms. | Very low. |

---

## 3. Deep-Dive Findings

### 3.1. Database Query Analysis
1. **N+1 and Sequential Loops:**
   - `OrdersService.createOrder` (lines 503–517):
     ```typescript
     for (const [productId, neededPacks] of stockDecrements) {
       const res = await tx.product.updateMany({
         where: { id: productId, stockPacks: { gte: neededPacks } },
         data: { stockPacks: { decrement: neededPacks } }
       });
     }
     ```
     For a standard B2B order with 35 SKUs, this issues **35 separate sequential roundtrips** to Supabase AWS Singapore over the internet. At ~300–450 ms roundtrip time, this alone accounts for `16,554 ms`!
   - `OrdersService.createOrder` (lines 522–529):
     ```typescript
     for (const deduction of promoResult.fixedAmountDeductions) {
       await tx.promotion.update({ ... });
     }
     ```
     Sequential promotion deduction queries.

2. **Duplicate Queries:**
   - In `OrdersService.createOrder`:
     - Lines 255–264: `prisma.productGroup.findMany(...)` loads groups.
     - Lines 273–278: `prisma.product.findMany(...)` loads products.
     - Line 349: Calls `PromotionsService.calculateOrder(rawItems, session.companyId)`.
     - Inside `PromotionsService.calculateOrder` (lines 146–192):
       - Re-queries `prisma.product.findMany(...)` for the exact same products.
       - Re-queries `prisma.productGroup.findMany(...)` for the exact same groups.
       - Re-queries `prisma.promotion.findMany(...)`.

3. **Missing Database Indexes:**
   - `ProductGroup`: **Zero indexes** (only primary key `id`). `where: { isActive: true }, orderBy: { displayName: 'asc' }` forces table scan and sort.
   - `Promotion`: **Zero indexes**. Every calculation queries `where: { isActive: true, ... date checks }` with no index on `isActive`, `startDate`, `endDate`, `type`.
   - `Template`: **Zero indexes**. `findFirst({ where: { isActive: true } })` does table scan.
   - `Order`: Lacks index on `createdAt` alone for seller/admin date filtering.
   - `User`: Lacks index on `companyId` and `roleTemplateId`.

### 3.2. Application Architecture Analysis
1. **Critical Path Congestion:**
   - Order creation currently executes:
     1. User lookup (`findUnique`)
     2. Group lookup (`findMany`)
     3. Product lookup (`findMany`)
     4. Calculate order (`findMany` x 3)
     5. Stock validation in memory
     6. Template lookup (`findFirst`)
     7. Template download from remote storage
     8. Excel generation via ExcelJS
     9. Excel upload to remote storage
     10. `prisma.$transaction` (Stock decrements x 35, Promo updates, Order insert, Items insert, OrderItemSku insert)
     11. AuditLog insert
   - Total latency: **32.3 seconds**!
   - Operations #6, #7, #8, #9 and #11 have NO dependency on the database transaction and should NOT delay the user response.

2. **Redundant Server-Side Recalculations:**
   - The promotion calculation logic (`PromotionsService.calculateOrder`) is 100% deterministic pure mathematics:
     - SKU bonus (10+1, 5+2)
     - Percentage discounts
     - Fixed amount budget deductions
     - Tiin roundings
   - In production logs, `calculationMs: 0` (takes <1 millisecond).
   - Yet every keystroke or click in the shopping cart triggers a network roundtrip that loads hundreds of rows from PostgreSQL.

### 3.3. Client-Side Interaction Analysis
- In `src/app/customer/page.tsx`:
  - `useEffect([cart, products])` has a 350ms debounce.
  - If a customer adjusts quantities on 5 products, 5 debounced network calls are made.
  - Each call occupies 3 connections in parallel via `Promise.all`.
  - While one call is waiting 11 seconds, subsequent calls queue up, leading directly to `P2024 connection pool timeout`.

---

## 4. Architectural Target & Refactoring Roadmap

### Phase 2: Prisma & Connection Pool Configuration
- Configure connection parameters and pool timeout in Prisma/pooler.
- Eliminate burst competition.

### Phase 3: Database Indexes
- Add strategic indexes in `prisma/schema.prisma` for `ProductGroup`, `Promotion`, `Template`, `Order`, `Product`.

### Phase 4: Order Calculation Configuration & In-Memory Cache
- Create `OrderCalculationConfig` cache in server memory with TTL and event-driven invalidation.
- Eliminate redundant DB queries in `calculateOrder` and `createOrder`.

### Phase 5 & 6: Client-Side Pure Calculation Engine & Cart Integration
- Extract deterministic calculation engine into pure TypeScript module.
- Load configuration once on catalog visit.
- Update cart totals, line prices, bonuses, and savings instantly (0–1 ms) without network calls.
- Keep server-side calculation as the authoritative verification during order submission.

### Phase 7 & 8: Stock Deduction & Transaction Optimization
- Optimize stock deduction in transaction: eliminate N sequential queries.
- Strip excessive `include` clauses from `order.create`.
- Shorten transaction duration from ~20s to <1.5s.

### Phase 9: Non-Critical Path Offloading
- Move Excel compilation and storage upload to background asynchronous processing.
- Order is saved and confirmed in <2 seconds; Excel is attached in the background.

### Phase 10: Performance Measurement & Verification
- Measure metrics before and after using realistic 30–40 SKU scenarios.
- Verify 100% business logic parity.
