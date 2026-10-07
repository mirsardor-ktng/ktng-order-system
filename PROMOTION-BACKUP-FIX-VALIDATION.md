# PROMOTION-BACKUP-FIX-VALIDATION.md

## 1. Backup Diagnostic & Fix

### Old behavior
When attempting to restore users via Google Drive (`/api/admin/gdrive`), the route called:
```ts
fileBuffer = await downloadFile('users.enc.json', 'users.enc.json', 'Users');
```
Because `'users.enc.json'` was supplied as the `fileId` instead of an actual Google Drive file ID, the Google Drive API responded with a `404 Not Found` error.

### Root cause
Google Drive API v3 requires a specific alphanumeric `fileId` (e.g. `1EGQv2IuXGtNP-efexTkpedT5a-T1APcR`) rather than the human-readable file name when requesting binary file downloads.

### Fix
Implemented `findFileInFolder(fileName, folderName)` in `src/lib/gdrive.ts` and `src/lib/storage/storage.service.ts`:
1. Searches the specified parent folder (`Users`) for the given file name (`users.enc.json`).
2. Sorts by `modifiedTime desc` to obtain the most recent backup.
3. Retrieves the valid Google Drive `fileId`.
4. Passes `fileMeta.id` to `downloadFile(fileMeta.id, fileMeta.name, 'Users')`.

### Actual Google Drive file found
- **File Name**: `users.enc.json`
- **File ID**: `1EGQv2IuXGtNP-efexTkpedT5a-T1APcR`
- **Parent Folder**: `Users` (Folder ID: `1IalaJCiUogbPfW5w0r8KpN4YENDanMKY`)
- **Modified Time**: `2026-10-03T21:01:26.946Z`
- **Size**: 4,161 bytes

### Successful download & decryption
- **Downloaded**: 4,161 bytes from Google Drive API.
- **Decryption**: Successfully decrypted with AES-256 standard passphrase.
- **Result**: Valid JSON array containing 9 users with valid `id`, `email`, `role`, and `passwordHash`.

---

## 2. Promotion Calculation & Rounding Fixes

### Old behavior
1. In Stage 1: `k_promo` used `sourceBaseCost / participatingNominalCost`, which omitted base packs of the bonus product if present.
2. In Stage 4: Lines 341-344 forcefully set bonus products to zero:
   ```ts
   if (item.basePacks === 0 && item.bonusPacks > 0) {
     item.effectivePrice = 0;
     item.finalLinePrice = 0;
   }
   ```
   This caused a double discount (qualifying SKU received discounted price while bonus SKU was simultaneously zeroed).

### Fix
1. In Stage 1: Both `participatingBaseCost` and `participatingNominalCost` are calculated over all items participating in the SKU promotion (`[...qualifyingSourceIds, promo.bonusProductId]`), yielding $k_{\text{promo}} = \text{participatingBaseCost} / \text{participatingNominalCost} = 1 - (\text{promoValue} / \text{participatingNominalCost})$.
2. In Stage 4: Removed the zeroing block. Unit prices for all items are derived as `rawUnitPrice = stage3LinePrice / totalPacks`, rounded to integer tiyin (`Math.round(rawUnitPrice * 100) / 100`), and line totals calculated strictly as `effectivePrice * totalPacks`.
3. Order Total: Calculated authoritatively as `sum(lineTotals)`.

### Test Matrix Results

| Test | Expected | Actual | Result |
| :--- | :--- | :--- | :---: |
| **SAME_SKU (10+1)** | 110 packs, eff: 9090.91, total: 1,000,000.10 | 110 packs, eff: 9090.91, total: 1000000.10 | **PASS** |
| **ANOTHER_SKU** | A: 8928.57, B: 10714.29, net: 999,999.90 | A: 8928.57, B: 10714.29, net: 999999.90 | **PASS** |
| **ANOTHER_SKU + unrelated C** | C discount: 0, net: 1,749,999.90 | C discount: 0, net: 1749999.90 | **PASS** |
| **Multiple promotions** | Independent participant sets, no cross-contamination | Promo 1: A=892857, B=107142.9; Promo 2: D=1777778, E=222222.2 | **PASS** |
| **No promotion** | 0 discount, full gross price | 0 discount, 1600000 UZS total | **PASS** |
| **Order % + SKU promo** | Stage 1 SKU + Stage 2 10% compound: 899,999.60 | 899999.60 UZS | **PASS** |
| **Fixed + SKU promo** | Stage 1 SKU + Stage 3 fixed cap: 899,999.60 | 899999.60 UZS | **PASS** |
| **Final rounding rule** | Order total strictly derived from rounded unit prices | 999,999.90 (differs from unrounded 1,000,000.00) | **PASS** |
| **Excel reconciliation** | Excel total matches calculation engine total | Exactly matches 999,999.90 UZS | **PASS** |
| **Destructive cleanup guards** | Reject undefined or empty string IDs | Throws `Refusing cleanup: missing orderId` | **PASS** |

---

## 3. Regression & Build

- **Pure Calculation Engine Unit Tests**: 22 passed, 0 failed (`scripts/test-calculation-engine.ts`).
- **Excel Quantity Breakdown Tests**: 16 passed, 0 failed (`scripts/test-excel-breakdown.ts`).
- **Promotion & Backup Test Suite**: 34 passed, 0 failed (`scripts/test-promotion-rounding-backup.ts`).
- **Production Build (`npm run build`)**: Success (exit code 0, all 32 pages and route handlers compiled cleanly).
- **Client/Server Calculation Parity**: Both client (`customer/page.tsx`) and server (`promotions.service.ts`) share `calculateOrderPure`.
