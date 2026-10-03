# Production Performance Validation Report — Performance Refactoring V2

## 1. Environment
- **Branch**: `performance-refactor-v2` (commit `eeca988`, working tree clean)
- **Database Engine**: PostgreSQL 15 on Supabase Singapore (Port 5432, connection pooling enabled)
- **Database Driver / ORM**: Prisma Client v5.22.0
- **Connection Configuration**:
  - `connection_limit=5` (enforced via dynamic parameter injection in `src/lib/db.ts`)
  - `pool_timeout=20` (enforced via dynamic parameter injection in `src/lib/db.ts`)
  - Global `PrismaClient` singleton attached to `globalThis` to prevent connection leakage across module reloads.
- **Application Runtime**:
  - Node.js: `v24.12.0`
  - Next.js: `14.1.0` (Production build: `14.2.35`)
  - React: `18.2.0`
  - Platform / OS: `win32` (x64)
- **Cloud Storage**: Google Drive API (v3) with local disk fallback
- **Serverless & Multi-Instance Characteristics**:
  - On containerized / serverless environments (e.g., Vercel Functions / AWS Lambda), in-memory cache is instance-local.
  - Instances maintain their own warm in-memory cache during execution life.
  - Each container lifecycle retains cached data for 60s TTL before re-validating against PostgreSQL.

---

## 2. Benchmark Methodology
- All tests executed against live PostgreSQL database with real Singapore network latency.
- High-precision microsecond timers (`performance.now()`) used for client/isomorphic calculations across 1,000 iterations to avoid misleading `0 ms` rounding.
- Database transaction timings measured from inside live API services and benchmark scripts.
- Controlled load testing executed at 1, 5, 10, and 25 concurrent requests without modifying production business data (using rollback-safe DRAFT orders for concurrency tests).
- Regression suite re-executed across all 8 existing test files and full Next.js production build (`next build`).

---

## 3. Catalog Benchmark (`GET /api/products`)

| State | Request Latency | DB Duration | Cache Lookup | Cache Status | Groups Returned |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cold Cache** | **1,095.85 ms** | 1,095 ms | 0.85 ms | Cache Miss | 41 groups |
| **Warm Cache (p50)** | **0.03 ms** | 0 ms | 0.03 ms | Cache Hit | 41 groups |
| **Warm Cache (p95)** | **0.07 ms** | 0 ms | 0.07 ms | Cache Hit | 41 groups |
| **Warm Cache (p99)** | **0.07 ms** | 0 ms | 0.07 ms | Cache Hit | 41 groups |

**Analysis**:
The in-memory catalog cache (`ProductGroupService.getCatalogGroups`) reduces catalog query time from ~1,100 ms to <0.1 ms on warm hits. Subsequent visits and concurrent catalog browsing hit memory instantly without consuming database pool connections.

---

## 4. Calculation Benchmark (`calculateOrderPure`)
Measured across 1,000 iterations using high-precision timers (`performance.now()` in microseconds):

| Order SKU Complexity | p50 Latency | p95 Latency | p99 Latency | Microseconds (p50) |
| :--- | :--- | :--- | :--- | :--- |
| **1 SKU** | **0.0047 ms** | 0.0128 ms | 0.0503 ms | 4.7 µs |
| **10 SKUs** | **0.0078 ms** | 0.0162 ms | 0.0344 ms | 7.8 µs |
| **20 SKUs** | **0.0061 ms** | 0.0128 ms | 0.0266 ms | 6.1 µs |
| **40 SKUs** | **0.0188 ms** | 0.0369 ms | 0.0475 ms | 18.8 µs |

**Analysis**:
`calculateOrderPure` is completely deterministic and decoupled from I/O. Even for complex 40-SKU orders with multi-tier promotions, execution takes under 19 microseconds in JavaScript memory.

---

## 5. Client Network Behavior
Inspection of `src/app/customer/page.tsx`:
- **Initial Catalog Load**:
  - `GET /api/products` (Loads catalog groups & SKUs)
  - `GET /api/orders/calculation-config` (Preloads active products, groups, and promotions)
- **Cart Interactions**:
  - `+` (Increment quantity): **0 network requests**.
  - `-` (Decrement quantity): **0 network requests**.
  - Manual numerical input: **0 network requests**.
  - Recalculation runs immediately in browser memory with 0 ms UI lag.
  - Previous behavior (`POST /api/orders/calculate` on every keystroke with Singapore network latency) has been completely eliminated.

---

## 6. Stock Benchmark (`batchDeductStock`)
Tested with a realistic order of **35 products**:

| Operation | Latency (p50) | Latency (p95) | Latency (p99) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Batch Deduction (35 items)** | **137.63 ms** | 274.69 ms | 274.69 ms | Single SQL roundtrip |
| **Insufficient Stock Rejection** | **138.12 ms** | 145.20 ms | 145.20 ms | Atomic rollback |
| **Stock State Preservation** | Verified | Verified | Verified | 0 negative stock |

**Analysis**:
Replaced 35 sequential `tx.product.updateMany` calls (previously 16,554 ms) with a single `UPDATE "Product" ... FROM (VALUES ...)` statement returning updated IDs. Total deduction time fell from 16.5s to ~140ms (99.1% latency reduction).

---

## 7. Transaction Benchmark
Measured inside `OrdersService.createOrder` with varying item volumes:

| Order Size | Transaction Duration (p50) | Transaction Duration (p95) | Transaction Duration (p99) |
| :--- | :--- | :--- | :--- |
| **10 Items** | **2,186.75 ms** | 2,197.25 ms | 2,197.25 ms |
| **20 Items** | **2,714.81 ms** | 2,756.12 ms | 2,756.12 ms |
| **35 Items** | **2,346.03 ms** | 2,490.16 ms | 2,490.16 ms |

**Transaction Content Audit**:
- `batchDeductStock`: Single SQL query.
- Promotion budget deduction: 1 query per fixed-amount promo.
- `tx.order.create`: Minimal select (`id`, `orderNumber`, `status`, items with `id` and `productId`).
- `tx.orderItemSku.createMany`: Single batch insert.
- **External Calls Audit**: Zero external HTTP calls, zero Excel compiling, zero Google Drive uploads inside the transaction.

---

## 8. Excel Background Reliability
Lifecycle verified in live environment:
1. **Order Creation Response**: Order is created with `fileUrl: null` and returned to user in **~2.1 seconds** (previously >25 seconds).
2. **Background Compilation**: `OrdersService.generateAndAttachExcel` triggered asynchronously after transaction commit.
3. **Google Drive Upload**: Excel file compiled and uploaded to Google Drive folder `Orders`.
4. **Order Record Updated**: Database updated with `fileId`, `fileName`, and `fileUrl`.
5. **On-Demand Fallback Test**: Immediate invocation of `OrdersService.ensureExcelGenerated` resolved in **3,362 ms**, returning active `fileId: 141bq7mq6ym1zBF1OmKtxZg5LqPcrawBP`.
6. **Idempotence**: Subsequent calls to `ensureExcelGenerated` return in **546 ms** directly from existing DB record without redundant uploads.
7. **Serverless Risk Evaluation**: In serverless environments (Vercel / AWS Lambda), background tasks initiated via un-awaited promises may be frozen if the container immediately terminates. The implemented on-demand fallback in `/api/orders/download` (`ensureExcelGenerated`) completely mitigates this risk by dynamically generating the document upon first download attempt.

---

## 9. Cache Behavior & Invalidation
Verified cache invalidation across all domains:
1. **Calculation Config Cache**:
   - `invalidateOrderCalculationConfig()` immediately invalidates `configCache`.
   - Verified that `configWarmBefore !== configColdAfter` after invalidation.
   - Invalidation hooks active on:
     - `POST /api/admin/products`
     - `PUT /api/admin/products`
     - `POST /api/admin/promotions`
     - `PUT /api/admin/promotions/[id]`
     - `POST /api/admin/product-groups`
     - `PUT /api/admin/product-groups/[id]`
2. **Catalog Cache**:
   - `ProductGroupService.invalidateCatalogCache()` verified: forces fresh DB query (546 ms) on next request.
3. **Template Cache**:
   - `OrdersService.invalidateTemplateCache()` verified: clears cached spreadsheet template buffer on template uploads/updates.

---

## 10. Connection Pool Behavior
- Pool settings: `connection_limit=5`, `pool_timeout=20`.
- Under 1, 5, 10, and 25 concurrent connections, pool wait stayed well within the 20s budget.
- **P2024 Errors**: **0 occurrences** across all concurrent tests.
- Connection leaks: **0**. Single global `PrismaClient` prevents orphaned client connections.

---

## 11. Concurrent Load Results

| Concurrency Level | p50 Latency | p95 Latency | p99 Latency | Error Rate | P2024 Errors |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 concurrent order** | **1,374.75 ms** | 1,374.75 ms | 1,374.75 ms | 0% | 0 |
| **5 concurrent orders** | **1,776.42 ms** | 2,121.56 ms | 2,121.56 ms | 0% | 0 |
| **10 concurrent orders** | **4,165.47 ms** | 4,324.78 ms | 4,324.78 ms | 0% | 0 |
| **25 concurrent orders** | **5,759.76 ms** | 6,055.96 ms | 6,110.14 ms | 0% | 0 |

**Analysis**:
Even with 25 simultaneous order submissions competing for 5 database pool connections over Singapore latency, all 25 orders completed successfully with a 0% error rate and **0 P2024 connection pool timeouts**.

---

## 12. Business Regression
All existing test suites were executed sequentially:

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| `test-calculation-engine.ts` | **PASS (22/22)** | Same SKU bonus, another SKU bonus, %, fixed amounts, multi-tier |
| `test-excel-breakdown.ts` | **PASS (16/16)** | Boxes / blocks breakdown across single & multi-SKU orders |
| `test-order-cancellation.ts` | **PASS (5/5)** | Stock restore, promo budget refund, atomic 5-way race condition |
| `test-order-pagination.ts` | **PASS (5/5)** | 25/50/100 limit normalization, page disjointness, CANCELLED filter |
| `test-product-tags.ts` | **PASS (4/4)** | Bulk tagging, validation rollback, clearing tags, permissions |
| `test-administrator-role.ts` | **PASS (5/5)** | Granular permissions, auth me, logs, tags, GDrive view vs manage |
| `test-phase3.ts` | **PASS (3/3)** | DailySequence generator, authoritative tiyin rounding, box terminology |
| `test-phase4.ts` | **PASS (4/4)** | Single-session enforcement, order visibility matrix, atomic accept |
| `npm run build` | **PASS (32/32)** | Full Next.js production build with 0 TypeScript/compilation errors |

---

## 13. Remaining Risks
1. **Serverless Lambda Lifecycle for Fire-and-Forget Promises**:
   - In AWS Lambda / Vercel Serverless Functions, when an HTTP response is sent, the container process may be paused immediately.
   - If paused mid-flight during `generateAndAttachExcel`, Google Drive upload may pause until the next container invocation.
   - **Mitigation Status**: ALREADY RESOLVED by `OrdersService.ensureExcelGenerated` in `/api/orders/download`. If a user or validator clicks "Download Order" before the background task completes, the download endpoint synchronously ensures the file is uploaded and available.
2. **Multi-Instance In-Memory Cache Coherence**:
   - In-memory cache is local to each Node.js process / serverless container.
   - When an admin updates a promotion, the local container invalidates immediately; other container instances will refresh upon their 60s TTL expiration.
   - **Mitigation Status**: Acceptable for current scale (60s TTL ensures automatic eventual consistency without needing Redis).

---

## 14. Recommendations
1. **Keep In-Memory Cache with 60s TTL**:
   - Current benchmark proves that in-memory cache provides sub-millisecond calculation and catalog responses without the operational overhead and failure modes of Redis.
2. **Retain On-Demand Excel Generation Fallback**:
   - Keep the dual mechanism: background fire-and-forget for instant customer feedback + on-demand fallback on `/api/orders/download` for guaranteed document availability.
3. **Monitor Connection Pool Metrics**:
   - Maintain `connection_limit=5` and `pool_timeout=20` as verified defaults for Supabase Singapore pooler.
