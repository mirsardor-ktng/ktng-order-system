# Regression Report: Draft Order Lifecycle & `orderFileUrl` Bugfix

## 1. Root Cause Analysis

### Background
During **Performance Refactoring V2 (Phase 7-10)** in commit `eeca988`, synchronous Excel template compilation and cloud storage upload were extracted from the critical path of database transactions and converted into non-blocking background operations (`void OrdersService.generateAndAttachExcel(...)`).

### The Bug
In `OrdersService.updateOrder` (`src/lib/orders/orders.service.ts`), the synchronous preparation block was removed:
```typescript
// Removed in Phase 7-10:
let orderFileUrl = existingOrder.fileUrl;
let fileId = existingOrder.fileId;
let fileName = existingOrder.fileName;
```
However, inside the `$transaction` block at lines 1151–1153, the call to `tx.order.update` still attempted to read these variables:
```typescript
const order = await tx.order.update({
  where: { id: orderId },
  data: {
    status: orderStatus,
    totalPacks,
    totalBlocks,
    totalCases,
    totalPrice,
    fileUrl: orderFileUrl, // <--- ReferenceError: orderFileUrl is not defined!
    fileId,                // <--- ReferenceError: fileId is not defined!
    fileName,              // <--- ReferenceError: fileName is not defined!
    ...
```

At runtime, whenever an existing draft was submitted or updated (`updateOrder`), the JavaScript runtime threw:
```text
[Update Order Error] ReferenceError: orderFileUrl is not defined
    at n.default.$transaction.timeout
    at async Proxy._transactionWithCallback
    at async I.updateOrder
    at async l (/var/task/.next/server/app/api/orders/route.js)
```

---

## 2. Why New-Order Flow Was Unaffected

In `OrdersService.createOrder` (`src/lib/orders/orders.service.ts`, lines 374–376), new orders were already implemented cleanly without referencing undefined variables:
```typescript
const order = await tx.order.create({
  data: {
    orderNumber,
    customerId: customer.id,
    ...
    fileUrl: null,
    fileId: null,
    fileName: null,
    ...
```
After the transaction commits, `createOrder` fires `void OrdersService.generateAndAttachExcel(...)` in the background, which asynchronously uploads the Excel file and updates the order's `fileUrl`, `fileId`, and `fileName`.

Because `createOrder` explicitly set `fileUrl: null, fileId: null, fileName: null`, it never evaluated the missing variables. Only `updateOrder` retained the dangling identifiers.

---

## 3. Exact Fix Applied

In `src/lib/orders/orders.service.ts` at line 1151, replaced the undefined variable references with `null`:

```diff
       const order = await tx.order.update({
         where: { id: orderId },
         data: {
           status: orderStatus,
           totalPacks,
           totalBlocks,
           totalCases,
           totalPrice,
-          fileUrl: orderFileUrl,
-          fileId,
-          fileName,
+          fileUrl: null,
+          fileId: null,
+          fileName: null,
           createdAt: createdAtUpdate,
           updatedAt: now,
```

### Architectural Rationale:
1. **Clean Slate for Updated Items:** When an existing draft is edited and converted to `NEW`, the previous items are replaced (`await tx.orderItem.deleteMany`). Setting `fileUrl: null, fileId: null, fileName: null` ensures no stale spreadsheet metadata persists from earlier revisions.
2. **Asynchronous Attachment:** If the order is submitted as `NEW`, `void OrdersService.generateAndAttachExcel(...)` is triggered immediately following the transaction to generate and attach the fresh Excel document.
3. **On-Demand Fallback Integrity:** If a user requests immediate download before background generation finishes, `OrdersService.ensureExcelGenerated(orderId)` detects `fileId === null`, compiles the latest order items on-demand, attaches the file, and serves it seamlessly.
4. **Draft Consistency:** Draft orders (`status: 'DRAFT'`) retain `fileUrl: null, fileId: null, fileName: null`, which accurately reflects that draft orders do not have commercial spreadsheets.

---

## 4. Test Verification & Results

### Automated Lifecycle Regression Test: `scripts/test-draft-order-regression.ts`
Executed against live Supabase PostgreSQL:

```text
=== REGRESSION TEST: Draft Lifecycle & ReferenceError: orderFileUrl Fix ===

Test customer: Test customer 1 (cmrlyy5i30002ykmvzu56kppm)
Product 1: ESSE Change M (SKU: 10009156A2, Stock: 80060)
Product 2: ESSE Change UP (SKU: 10009153A2, Stock: 196930)

--- TEST A: Standard NEW ORDER Flow ---
[PERF] PromotionsService.calculateOrder configLoadMs: 1462, cacheHit: false, cacheMiss: true, calculationMs: 1, totalMs: 1463
[PERF] OrdersService.createOrder customerMs: 1133, groupsMs: 1133, productsMs: 251, promotionMs: 1463, validationMs: 2848, stockDeductionMs: 263, promoDeductionMs: 0, orderCreateMs: 1051, orderItemSkuMs: 263, transactionStageTotalMs: 1577, transactionMs: 1839, auditLogMs: 252, totalMs: 4940
Created NEW order: ORD-20261003-130616-164 (ID: cmus3yehi0002hqpq1nf6qz60)
Stock correctly deducted: 80060 -> 80050
Order A cancelled and stock restored cleanly.

--- TEST B: DRAFT ORDER Flow (Draft -> Edit Draft -> Submit) ---
Step 1: Creating draft order...
[PERF] PromotionsService.calculateOrder configLoadMs: 0, cacheHit: true, cacheMiss: false, calculationMs: 0, totalMs: 0
[PERF] OrdersService.createOrder customerMs: 262, groupsMs: 262, productsMs: 262, promotionMs: 0, validationMs: 524, stockDeductionMs: 0, promoDeductionMs: 0, orderCreateMs: 524, orderItemSkuMs: 0, transactionStageTotalMs: 524, transactionMs: 785, auditLogMs: 263, totalMs: 1572
Draft created: ORD-20261003-130622-198 (ID: cmus3yiq1000dhqpqjqh78889, Status: DRAFT)
Stock unchanged for draft (remains 80060).

Step 2: Editing draft with updated items...
[PERF] PromotionsService.calculateOrder configLoadMs: 0, cacheHit: true, cacheMiss: false, calculationMs: 0, totalMs: 0
[PERF] OrdersService.updateOrder orderLookupMs: 1175, oldItemSkusMs: 263, groupsMs: 263, productsMs: 262, promotionMs: 0, validationMs: 1963, stockRestoreMs: 0, stockDeductionMs: 0, promoDeductionMs: 0, orderDeleteItemsMs: 261, orderUpdateMs: 786, orderItemSkuMs: 0, transactionMs: 1309, auditLogMs: 262, totalMs: 3534
Draft updated successfully: Черновик ORD-20261003-130622-198 обновлён.

Step 3: Submitting draft order (converting DRAFT -> NEW)...
[PERF] PromotionsService.calculateOrder configLoadMs: 0, cacheHit: true, cacheMiss: false, calculationMs: 0, totalMs: 0
[PERF] OrdersService.updateOrder orderLookupMs: 654, oldItemSkusMs: 131, groupsMs: 132, productsMs: 131, promotionMs: 0, validationMs: 1048, stockRestoreMs: 0, stockDeductionMs: 262, promoDeductionMs: 0, orderDeleteItemsMs: 131, orderUpdateMs: 655, orderItemSkuMs: 262, transactionMs: 1571, auditLogMs: 375, totalMs: 2994
Draft order submitted successfully in 2994 ms!
Result message: "Заказ ORD-20261003-130622-198 успешно оформлен!"
New Order status: NEW
Product 1 stock: 80060 -> 80040 (deducted 20)
Product 2 stock: 196930 -> 196920 (deducted 10)

Step 4: Testing Excel generation on-demand fallback (ensureExcelGenerated)...
ensureExcelGenerated result: {
  fileId: '184-tFDWmerLfPPcI1jEMzOkPivkQLiE8',
  fileName: '2026-10-03_13-06_Testcustomer1.xlsx',
  fileUrl: '/api/orders/download?fileId=184-tFDWmerLfPPcI1jEMzOkPivkQLiE8&fileName=2026-10-03_13-06_Testcustomer1.xlsx'
}
Excel file confirmed: 2026-10-03_13-06_Testcustomer1.xlsx (fileId: 184-tFDWmerLfPPcI1jEMzOkPivkQLiE8)

Step 5: Cleaning up (cancelling submitted order)...
Stock fully restored to initial values: P1=80060, P2=196930

=============================================================
✓ ALL REGRESSION TESTS PASSED!
  - ReferenceError: orderFileUrl is resolved
  - NEW order flow works
  - DRAFT -> Edit -> Submit flow works
  - Stock atomic deduction & restore work
  - Excel fallback ensureExcelGenerated works
=============================================================
```

---

## 5. Test Suite Verification

| Suite | Status | Metrics / Details |
| :--- | :---: | :--- |
| `test-draft-order-regression.ts` | **PASS** | Complete draft lifecycle verified: Create -> Edit -> Submit -> Stock -> Excel. |
| `test-batch-stock.ts` | **PASS** | Atomic batch stock decrement operates in single roundtrip. |
| `test-calculation-engine.ts` | **PASS** | 22/22 pure calculation unit tests passed. |
| `test-order-create-perf.ts` | **PASS** | Cold run: 4.7s; Warm run: 2.5s; 5-SKU batch creation verified. |
| `npm run build` | **PASS** | 32/32 Next.js routes compiled with zero errors. |

---

## 6. Build Result

```text
✓ Compiled successfully
✓ Generating static pages (32/32)
Finalizing page optimization ...
Collecting build traces ...
32/32 routes compiled (0 errors)
```
