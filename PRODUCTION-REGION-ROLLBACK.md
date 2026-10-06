# KTNG B2B Order System: Production Region Rollback Plan

## Overview
This document specifies the rollback targets and procedures for the Singapore (`sin1`) production migration.

---

## Deployment Parameters

### Current Known-Good Production Deployment (Rollback Target)
* **CURRENT PRODUCTION REGION:** `iad1` (Washington, D.C., USA)
* **CURRENT PRODUCTION DOMAIN:** `https://ktng-order-system.vercel.app`
* **CURRENT PRODUCTION DEPLOYMENT URL:** `https://ktng-order-system-hq1wn4pk5-mirsardors-projects.vercel.app`
* **CURRENT GITHUB DEPLOYMENT ID:** `6832228195`
* **CURRENT PRODUCTION COMMIT SHA:** `037aba9fe69b9f7ac9dde7acd98c8cab21835878` (`037aba9`)
* **DEPLOYMENT TIMESTAMP:** `2026-10-03T19:42:41Z`

### Target Migration Parameters
* **TARGET REGION:** `sin1` (Singapore)
* **TARGET PRODUCTION DOMAIN:** `https://ktng-order-system.vercel.app`
* **TARGET CONFIGURATION:** `vercel.json` (`{"regions": ["sin1"]}`)
* **TARGET COMMIT:** Head of `phase-13c-region-ab` / merged into `main`

---

## Rollback Procedure

If any critical failure occurs post-deployment (such as stock calculation discrepancies, persistent transaction failures, or authentication regressions):

### Method 1: Instant Vercel Dashboard Rollback (Zero Git delay)
1. Navigate to the project deployments page on Vercel:
   `https://vercel.com/mirsardors-projects/ktng-order-system`
2. Locate the known-good deployment:
   `ktng-order-system-hq1wn4pk5-mirsardors-projects.vercel.app` (Commit `037aba9`).
3. Click the `...` menu on the deployment and select **Instant Rollback / Promote to Production**.
4. Confirm promotion. Vercel routes 100% of production traffic back to `iad1` in seconds.

### Method 2: Git Rollback
If a Git revert is required:
1. Revert the merge commit on `main` or remove `vercel.json`:
   ```bash
   git revert -m 1 <MERGE_COMMIT_SHA>
   git push origin main
   ```
2. Wait for Vercel to build and deploy commit `037aba9` state.

---

## Post-Rollback Verification Checklist
After initiating a rollback, verify:
1. `X-Vercel-Id` header returns `::iad1::` on `https://ktng-order-system.vercel.app/api/products`.
2. Application loads: Login, Customer Dashboard, Seller Dashboard.
3. Test login with `loadtest-user-001@ktng-test.local`.
4. Order creation succeeds and stock deduction reconciles.
5. Record incident details and cause.
