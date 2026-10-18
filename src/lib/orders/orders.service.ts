import { NextRequest } from 'next/server';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import prisma from '../db';
import { Prisma } from '@prisma/client';
import { normalizePacks } from '../conversion';
import { generateExcelOrder } from '../excel';
import { storageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ProductGroupService, SkuAllocation } from '../product-groups/product-groups.service';

import { JWTPayload, hasPermission, isSuperAdmin } from '../auth';
import { getTashkentStartOfDay, getTashkentStartOfNextDay } from '../date-utils';

export interface AppliedPromotionDeduction {
  promotionId: string;
  amount: number;
  [key: string]: any;
}

function validateOrderItems(items: any[]): void {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    const err: any = new Error('Заказ должен содержать от 1 до 100 позиций.');
    err.status = 400;
    throw err;
  }
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      const err: any = new Error('Некорректная позиция заказа.');
      err.status = 400;
      throw err;
    }
    const rawQuantity = item.baseQuantityPacks ?? item.quantityPacks ?? item.packs;
    const quantity = Number(rawQuantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000) {
      const err: any = new Error('Количество должно быть целым числом от 1 до 100000.');
      err.status = 400;
      throw err;
    }
  }
}

export type OrderPromotionResolutionSource =
  | 'PERSISTED_EXACT'
  | 'LEGACY_ZERO_DISCOUNT'
  | 'ADMIN_RESOLVED';

export interface OrderPromotionResolution {
  isLegacy: boolean;
  source: OrderPromotionResolutionSource;
  deductions: AppliedPromotionDeduction[];
  warning?: string;
}

export class LegacyAmbiguousPromotionError extends Error {
  status: number;
  code: string;
  orderId?: string;
  orderNumber?: string;

  constructor(orderIdentifier: string, details?: string) {
    super(
      `Заказ ${orderIdentifier} оформлен в предыдущей версии системы без точного сохранения промо-бюджетов (legacy). ` +
      `Заказ содержит скидки, которые невозможно однозначно восстановить автоматически. ` +
      `Автоматическое восстановление промо-бюджета заблокировано для предотвращения финансовых искажений. ` +
      (details ? `Детали: ${details}. ` : '') +
      `Для обработки заказа требуется явная административная сверка промо-бюджета (adminResolvedDeductions).`
    );
    this.name = 'LegacyAmbiguousPromotionError';
    this.status = 409;
    this.code = 'LEGACY_AMBIGUOUS_PROMOTION_BUDGET';
  }
}

export class OrdersService {
  /**
   * Generates a collision-resistant unique order number.
   * Strategy: Strictly UTC-consistent date and time to eliminate cross-day timezone mismatches.
   * Format: ORD-YYYYMMDD-HHMMSS-XXXXXXXX (8 uppercase hex chars = >4.29 billion possibilities/sec)
   */
  static generateOrderNumber(date: Date = new Date()): string {
    const iso = date.toISOString();
    const dateStr = iso.slice(0, 10).replace(/-/g, '');
    const timeStr = iso.slice(11, 19).replace(/:/g, '');
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${dateStr}-${timeStr}-${randomSuffix}`;
  }

  /**
   * Atomically decrements promotion budget for multiple fixed-amount promotions.
   * Enforces remainingAmount >= needed at the database level to prevent race conditions.
   * Throws error with promotion details if budget is insufficient, rolling back transaction.
   */
  static async batchDeductPromotionBudget(
    tx: any,
    deductions: Array<{ promotionId: string; amount: number }>
  ): Promise<void> {
    if (!deductions || deductions.length === 0) return;

    // Consolidate deductions by promotionId to handle multiple items under the same promotion
    const consolidated = new Map<string, number>();
    for (const d of deductions) {
      if (!d.promotionId || typeof d.amount !== 'number' || !Number.isFinite(d.amount) || isNaN(d.amount) || d.amount <= 0) continue;
      const roundedAmount = Math.round(d.amount * 100) / 100;
      consolidated.set(d.promotionId, Math.round(((consolidated.get(d.promotionId) || 0) + roundedAmount) * 100) / 100);
    }

    const entries = Array.from(consolidated.entries()).filter(([_, amount]) => amount > 0);
    if (entries.length === 0) return;

    // Sort entries by promotionId ASC to enforce global lock hierarchy
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    // Parameterized atomic update using Prisma.sql
    const valueClauses = entries.map(([id, needed]) => Prisma.sql`(${id}::text, ${needed}::double precision)`);
    const updatedRows = await tx.$queryRaw<Array<{ id: string; name: string; remainingAmount: number | null }>>`
      UPDATE "Promotion" AS p
      SET "remainingAmount" = CASE
            WHEN p."remainingAmount" IS NOT NULL THEN ROUND((p."remainingAmount" - v.needed)::numeric, 2)::double precision
            ELSE NULL
          END,
          "consumedAmount" = ROUND((COALESCE(p."consumedAmount", 0) + v.needed)::numeric, 2)::double precision
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, needed)
      WHERE p.id = v.id
        AND (p."remainingAmount" IS NULL OR ROUND(p."remainingAmount"::numeric, 2) >= ROUND(v.needed::numeric, 2))
      RETURNING p.id, p.name, p."remainingAmount"
    `;

    if (updatedRows.length !== entries.length) {
      const updatedSet = new Set(updatedRows.map((r: { id: string }) => r.id));
      const failedEntry = entries.find(([id]) => !updatedSet.has(id));
      const failedPromoId = failedEntry ? failedEntry[0] : '';

      // Query failed promo details to provide informative error
      const failedPromo = await tx.promotion.findUnique({
        where: { id: failedPromoId },
        select: { name: true, remainingAmount: true }
      });
      const promoName = failedPromo?.name || 'Фиксированная скидка';
      const available = failedPromo?.remainingAmount != null ? failedPromo.remainingAmount : 0;
      throw new Error(`Недостаточно бюджета для применения акции "${promoName}". Доступный остаток: ${available.toLocaleString('ru-RU')} сум. Оформление заказа отменено.`);
    }
  }

  /**
   * Atomically decrements stock for multiple products in a single SQL roundtrip.
   * Throws error with product name if any product has insufficient stock.
   */
  static async batchDeductStock(
    tx: any,
    stockDecrements: Map<string, number>,
    productMap?: Map<string, any>
  ): Promise<void> {
    const entries = Array.from(stockDecrements.entries()).filter(([_, packs]) => packs > 0);
    if (entries.length === 0) return;

    // Sort entries by productId ASC to enforce global lock hierarchy
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const valueClauses = entries.map(([id, needed]) => Prisma.sql`(${id}::text, ${needed}::integer)`);
    const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" - v.needed
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, needed)
      WHERE p.id = v.id AND p."stockPacks" >= v.needed
      RETURNING p.id
    `;

    if (updatedRows.length !== entries.length) {
      const updatedSet = new Set(updatedRows.map((r: { id: string }) => r.id));
      const failedEntry = entries.find(([id]) => !updatedSet.has(id));
      const pName = (failedEntry && productMap?.get(failedEntry[0])?.name) || 'неизвестно';
      throw new Error(`Превышен доступный лимит запасов для позиции: ${pName}. Пожалуйста, обновите страницу и проверьте остатки.`);
    }
  }

  /**
   * Atomically restores stock for multiple products in a single SQL roundtrip.
   */
  static async batchRestoreStock(
    tx: any,
    stockIncrements: Map<string, number>
  ): Promise<void> {
    const entries = Array.from(stockIncrements.entries()).filter(([_, packs]) => packs > 0);
    if (entries.length === 0) return;

    // Sort entries by productId ASC to enforce global lock hierarchy
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const valueClauses = entries.map(([id, packs]) => Prisma.sql`(${id}::text, ${packs}::integer)`);
    await tx.$executeRaw`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" + v.packs
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, packs)
      WHERE p.id = v.id
    `;
  }

  /**
   * Atomically restores promotion budget for multiple fixed-amount promotions in a single SQL roundtrip.
   * Restores remainingAmount (capped by allocatedAmount if present) and decrements consumedAmount (protected by GREATEST(0, ...)).
   * Enforces that all restored promotions exist in the database; throws error if any record is missing.
   */
  static async batchRestorePromotionBudget(
    tx: any,
    restorations: Array<{ promotionId: string; amount: number }>
  ): Promise<void> {
    if (!restorations || restorations.length === 0) return;

    const consolidated = new Map<string, number>();
    for (const r of restorations) {
      if (!r.promotionId || typeof r.amount !== 'number' || !Number.isFinite(r.amount) || isNaN(r.amount) || r.amount <= 0) continue;
      const roundedAmount = Math.round(r.amount * 100) / 100;
      consolidated.set(r.promotionId, Math.round(((consolidated.get(r.promotionId) || 0) + roundedAmount) * 100) / 100);
    }

    const entries = Array.from(consolidated.entries()).filter(([_, amount]) => amount > 0);
    if (entries.length === 0) return;

    // Sort entries by promotionId ASC to enforce global lock hierarchy
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const valueClauses = entries.map(([id, amount]) => Prisma.sql`(${id}::text, ${amount}::double precision)`);
    const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Promotion" AS p
      SET "remainingAmount" = CASE
            WHEN p."remainingAmount" IS NOT NULL THEN
              CASE
                WHEN p."allocatedAmount" IS NOT NULL THEN LEAST(p."allocatedAmount", ROUND((p."remainingAmount" + v.amount)::numeric, 2)::double precision)
                ELSE ROUND((p."remainingAmount" + v.amount)::numeric, 2)::double precision
              END
            ELSE NULL
          END,
          "consumedAmount" = GREATEST(0::double precision, ROUND((COALESCE(p."consumedAmount", 0) - v.amount)::numeric, 2)::double precision)
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, amount)
      WHERE p.id = v.id
      RETURNING p.id
    `;

    if (updatedRows.length !== entries.length) {
      const updatedSet = new Set(updatedRows.map((r: { id: string }) => r.id));
      const missing = entries.filter(([id]) => !updatedSet.has(id)).map(([id]) => id);
      throw new Error(`Не удалось восстановить промо-бюджет: промо-акции с ID [${missing.join(', ')}] не найдены в базе данных.`);
    }
  }

  /**
   * Validates and parses persisted appliedPromotions JSON metadata.
   * Throws explicit error if the metadata is invalid or malformed.
   * Enforces positive finite amounts and deterministically consolidates duplicate promotion IDs.
   */
  static parseAppliedPromotions(raw: any): AppliedPromotionDeduction[] {
    if (raw === null || raw === undefined) {
      throw new Error('Order appliedPromotions is null or undefined');
    }
    if (!Array.isArray(raw)) {
      throw new Error('Поврежденные данные промо-акций: appliedPromotions должен быть массивом (invalid JSON).');
    }
    const consolidated = new Map<string, number>();
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Поврежденные данные промо-акций: элемент [${i}] не является объектом.`);
      }
      if (typeof item.promotionId !== 'string' || !item.promotionId.trim()) {
        throw new Error(`Поврежденные данные промо-акций: элемент [${i}] не содержит корректного promotionId.`);
      }
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || isNaN(item.amount) || item.amount <= 0) {
        throw new Error(`Поврежденные данные промо-акций: элемент [${i}] содержит некорректную сумму скидки (должно быть положительным конечным числом).`);
      }
      const promoId = item.promotionId.trim();
      const rounded = Math.round(item.amount * 100) / 100;
      if (rounded > 0) {
        consolidated.set(promoId, Math.round(((consolidated.get(promoId) || 0) + rounded) * 100) / 100);
      }
    }

    const result: AppliedPromotionDeduction[] = [];
    const sortedIds = Array.from(consolidated.keys()).sort();
    for (const id of sortedIds) {
      result.push({
        promotionId: id,
        amount: consolidated.get(id)!
      });
    }
    return result;
  }

  /**
   * Resolves the exact promotion budget deductions to restore for an order.
   *
   * Priority:
   * 1. If explicit adminResolvedDeductions is provided: validate and return exact records.
   * 2. If appliedPromotions is persisted: strictly validate and return exact records.
   * 3. If appliedPromotions is null/undefined (Legacy Order):
   *    a. Zero-discount orders: safely return [] (provably zero).
   *    b. Orders with discounts: throw LegacyAmbiguousPromotionError to block automatic heuristic guessing.
   */
  static async resolveOrderPromotionDeductions(
    order: {
      id?: string;
      orderNumber?: string;
      appliedPromotions?: any;
      items: any[];
      companyId?: string | null;
      totalPrice?: number | null;
    },
    options?: {
      adminResolvedDeductions?: AppliedPromotionDeduction[];
      session?: JWTPayload;
    }
  ): Promise<OrderPromotionResolution> {
    // 1. Explicit admin override if provided
    if (options?.adminResolvedDeductions) {
      const isSuper = options?.session ? isSuperAdmin(options.session) : false;
      if (!isSuper) {
        const err: any = new Error('Только администраторы могут выполнять ручную сверку промо-бюджетов legacy-заказов.');
        err.status = 403;
        throw err;
      }
      const validated = OrdersService.parseAppliedPromotions(options.adminResolvedDeductions);
      return {
        isLegacy: true,
        source: 'ADMIN_RESOLVED',
        deductions: validated
      };
    }

    // 2. Persisted exact records
    if (order.appliedPromotions !== null && order.appliedPromotions !== undefined) {
      const deductions = OrdersService.parseAppliedPromotions(order.appliedPromotions);
      return {
        isLegacy: false,
        source: 'PERSISTED_EXACT',
        deductions
      };
    }

    // 3. Legacy order handling (appliedPromotions is null/undefined)
    if (!order.items || order.items.length === 0) {
      return {
        isLegacy: true,
        source: 'LEGACY_ZERO_DISCOUNT',
        deductions: []
      };
    }

    const baseItems: any[] = [];
    let nominalSubtotal = 0;

    for (const item of order.items) {
      if (item.isBonus) continue;
      const packs = item.baseQuantityPacks || item.quantityPacks || 0;
      const price = item.price ?? 0;
      if (packs <= 0 || price <= 0) continue;

      nominalSubtotal += packs * price;
      baseItems.push({
        productId: item.productId,
        baseQuantityPacks: packs,
        price
      });
    }

    const orderTotalPrice = order.totalPrice ?? nominalSubtotal;
    const maxRecordedDiscount = Math.max(0, Math.round((nominalSubtotal - orderTotalPrice) * 100) / 100);

    // 3a. Provably zero discount
    if (baseItems.length === 0 || maxRecordedDiscount <= 0) {
      return {
        isLegacy: true,
        source: 'LEGACY_ZERO_DISCOUNT',
        deductions: []
      };
    }

    // 3b. Ambiguous legacy order with discount: automatic heuristic estimation is strictly prohibited.
    const orderIdentifier = order.orderNumber || order.id || 'неизвестный';
    throw new LegacyAmbiguousPromotionError(
      orderIdentifier,
      `расчетный дисконт: ${maxRecordedDiscount.toLocaleString('ru-RU')} сум, позиций: ${baseItems.length}`
    );
  }

  /**
   * Reconstructs the exact fixed-amount promotion budget deductions that were
   * previously applied and consumed for an existing order.
   *
   * Rather than summing arbitrary line-item discounts, this runs the pure calculation engine
   * with ignoreBudgetLimits: true on the order's actual base items, and caps the result by
   * the order's documented gross-to-net discount (nominalSubtotal - totalPrice).
   */
  static async calculatePreviousFixedAmountDeductions(
    order: {
      items: any[];
      companyId?: string | null;
      totalPrice?: number | null;
    }
  ): Promise<Array<{ promotionId: string; amount: number }>> {
    if (!order.items || order.items.length === 0) return [];

    const baseItems: any[] = [];
    let nominalSubtotal = 0;

    for (const item of order.items) {
      if (item.isBonus) continue;
      const packs = item.baseQuantityPacks || item.quantityPacks || 0;
      const price = item.price ?? 0;
      if (packs <= 0 || price <= 0) continue;

      nominalSubtotal += packs * price;
      baseItems.push({
        productId: item.productId,
        baseQuantityPacks: packs,
        price
      });
    }

    if (baseItems.length === 0) return [];

    // If order had no discount relative to nominal pricing (e.g. manual pricing without promo), return empty
    const orderTotalPrice = order.totalPrice ?? nominalSubtotal;
    const maxRecordedDiscount = Math.max(0, Math.round((nominalSubtotal - orderTotalPrice) * 100) / 100);
    if (maxRecordedDiscount <= 0) return [];

    try {
      const calcResult = await PromotionsService.calculateOrder(baseItems, order.companyId, { ignoreBudgetLimits: true });
      if (!calcResult.fixedAmountDeductions || calcResult.fixedAmountDeductions.length === 0) {
        return [];
      }

      // Isolate fixed-amount ceiling by subtracting percentage discounts (Stage 2)
      const percentageDiscountAmount = Math.max(0, Math.round(((calcResult.stage1Price || 0) - (calcResult.stage2Price || 0)) * 100) / 100);
      const maxFixedDiscountAllowed = Math.max(0, Math.round((maxRecordedDiscount - percentageDiscountAmount) * 100) / 100);
      if (maxFixedDiscountAllowed <= 0) return [];

      // Bound restored deductions by the isolated fixed-amount ceiling
      let remainingAllowedDiscount = maxFixedDiscountAllowed;
      const result: Array<{ promotionId: string; amount: number }> = [];

      for (const d of calcResult.fixedAmountDeductions) {
        if (!d.promotionId || d.amount <= 0) continue;
        const cappedAmount = Math.min(d.amount, remainingAllowedDiscount);
        if (cappedAmount > 0) {
          result.push({
            promotionId: d.promotionId,
            amount: Math.round(cappedAmount * 100) / 100
          });
          remainingAllowedDiscount = Math.max(0, Math.round((remainingAllowedDiscount - cappedAmount) * 100) / 100);
        }
      }

      return result;
    } catch (err) {
      console.error('[WARN] Failed to calculate previous fixed amount deductions for order:', err);
      return [];
    }
  }

  /**
   * Generates and attaches Excel order file in the background without blocking the order creation transaction.
   */
  static async generateAndAttachExcel(
    orderId: string,
    orderNumber: string,
    clientName: string,
    validatedItems: any[],
    totals: { totalBlocks: number; totalCases: number; totalPrice: number }
  ) {
    try {
      const uploadResult = await this.compileAndUploadExcel(orderNumber, clientName, validatedItems, totals);
      await prisma.order.update({
        where: { id: orderId },
        data: {
          fileUrl: uploadResult.fileUrl,
          fileId: uploadResult.fileId,
          fileName: uploadResult.fileName
        }
      });
      return uploadResult;
    } catch (err: any) {
      console.error(`[Background Excel Error] Failed to generate/upload Excel for order ${orderNumber} (${orderId}):`, err);
      return null;
    }
  }

  /**
   * Ensures an Excel order document exists in storage.
   * If fileId is missing, compiles and uploads it on-demand.
   */
  static async ensureExcelGenerated(orderId: string): Promise<{ fileId: string; fileName: string; fileUrl: string; buffer?: Buffer } | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            skuAllocations: true
          }
        }
      }
    });

    if (!order || order.status === 'DRAFT') {
      return null;
    }

    if (order.fileId) {
      return {
        fileId: order.fileId,
        fileName: order.fileName || `order_${order.orderNumber}.xlsx`,
        fileUrl: order.fileUrl || `/api/orders/download?id=${order.id}`
      };
    }

    const totals = {
      totalBlocks: order.totalBlocks,
      totalCases: order.totalCases,
      totalPrice: order.totalPrice
    };

    const clientName = order.customer?.name || 'Клиент';
    const uploadResult = await this.compileAndUploadExcel(order.orderNumber, clientName, order.items, totals);

    await prisma.order.update({
      where: { id: orderId },
      data: {
        fileUrl: uploadResult.fileUrl,
        fileId: uploadResult.fileId,
        fileName: uploadResult.fileName
      }
    });

    return {
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName,
      fileUrl: uploadResult.fileUrl,
      buffer: uploadResult.buffer
    };
  }

  static invalidateTemplateCache() {
    this.templateBufferCache = null;
  }

  /**
   * Helper to verify if user has access to a specific order.
   */
  static canUserAccessOrder(
    session: JWTPayload,
    order: { customerId: string; createdByUserId?: string | null; companyId?: string | null; status: string }
  ): boolean {
    if (isSuperAdmin(session)) {
      return true;
    }

    const isOwner = order.customerId === session.userId || order.createdByUserId === session.userId;
    if (isOwner) return true;

    const isSameCompany = Boolean(session.companyId && order.companyId && session.companyId === order.companyId);

    // DRAFT orders are only accessible by the owner
    if (order.status === 'DRAFT') {
      return isOwner;
    }

    if (!hasPermission(session, 'orders:view_all')) {
      return isSameCompany;
    }

    // Seller / Manager with orders:view_all:
    if (order.status === 'NEW') {
      return hasPermission(session, 'orders:validation:view') || isSameCompany;
    }

    return true;
  }

  /**
   * GET: Retrieves order history with server-side visibility and date filtering.
   */
  static async getOrders(
    session: JWTPayload,
    options: {
      customerId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      page?: number | string;
      pageSize?: number | string;
    } = {}
  ): Promise<any> {
    const { customerId, status, startDate, endDate, page, pageSize } = options;
    const whereClause: any = {};

    const canViewAll = hasPermission(session, 'orders:view_all');
    const canViewValidation =
      hasPermission(session, 'orders:validation:view') ||
      isSuperAdmin(session);

    if (!canViewAll) {
      // Customer: can view their company's orders or own orders in any status
      if (session.companyId) {
        whereClause.companyId = session.companyId;
        // DRAFT orders: if a company customer is viewing, only their own DRAFTs are visible
        if (status === 'DRAFT') {
          whereClause.status = 'DRAFT';
          whereClause.OR = [
            { createdByUserId: session.userId },
            { customerId: session.userId }
          ];
        } else if (!status) {
          whereClause.OR = [
            { status: { not: 'DRAFT' } },
            { createdByUserId: session.userId },
            { customerId: session.userId }
          ];
        } else {
          whereClause.status = status;
        }
      } else {
        whereClause.customerId = session.userId;
        if (status) {
          whereClause.status = status;
        }
      }
    } else {
      // Manager / Seller with orders:view_all
      if (customerId) {
        whereClause.customerId = customerId;
      }

      if (canViewValidation) {
        // Validator: sees NEW, ACCEPTED, and other active statuses
        if (status) {
          whereClause.status = status;
        } else {
          whereClause.status = { not: 'DRAFT' };
        }
      } else {
        // Normal Seller WITHOUT validation permission:
        // Must NOT see other companies' NEW or DRAFT orders!
        const sameCompanyOrOwn: any[] = [
          { createdByUserId: session.userId },
          { customerId: session.userId }
        ];
        if (session.companyId) {
          sameCompanyOrOwn.push({ companyId: session.companyId });
        }

        if (status) {
          if (status === 'NEW') {
            whereClause.status = 'NEW';
            whereClause.OR = sameCompanyOrOwn;
          } else if (status === 'DRAFT') {
            whereClause.status = 'DRAFT';
            whereClause.OR = [
              { createdByUserId: session.userId },
              { customerId: session.userId }
            ];
          } else {
            whereClause.status = status;
          }
        } else {
          // General list: exclude DRAFT & other companies' NEW
          whereClause.OR = [
            { status: { notIn: ['DRAFT', 'NEW'] } },
            ...sameCompanyOrOwn
          ];
        }
      }
    }

    // Server-side date filtering with Asia/Tashkent timezone
    if (startDate || endDate) {
      const createdAtFilter: any = {};
      if (startDate) {
        const start = getTashkentStartOfDay(startDate);
        if (start) createdAtFilter.gte = start;
      }
      if (endDate) {
        const end = getTashkentStartOfNextDay(endDate);
        if (end) createdAtFilter.lt = end;
      }
      if (createdAtFilter.gte || createdAtFilter.lt) {
        whereClause.createdAt = createdAtFilter;
      }
    }

    const orderInclude = {
      customer: {
        select: { id: true, name: true, email: true }
      },
      createdBy: {
        select: { id: true, name: true, email: true }
      },
      company: {
        select: { id: true, name: true, code: true }
      },
      items: {
        include: {
          product: true,
          skuAllocations: {
            include: {
              product: {
                select: { priority: true }
              }
            },
            orderBy: { id: 'asc' as const }
          }
        }
      },
      comments: {
        orderBy: { createdAt: 'asc' as const }
      },
      documents: {
        orderBy: { createdAt: 'desc' as const }
      }
    };

    const isPaginated = page !== undefined || pageSize !== undefined;
    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const parsedSize = parseInt(String(pageSize), 10);
      const limit = (parsedSize === 25 || parsedSize === 50 || parsedSize === 100) ? parsedSize : 25;
      const skip = (pageNum - 1) * limit;

      const [total, orders] = await Promise.all([
        prisma.order.count({ where: whereClause }),
        prisma.order.findMany({
          where: whereClause,
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        })
      ]);

      return {
        orders,
        pagination: {
          page: pageNum,
          pageSize: limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        }
      };
    }

    return await prisma.order.findMany({
      where: whereClause,
      include: orderInclude,
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * POST: Creates a new order (DRAFT or NEW)
   */
  static async createOrder(session: JWTPayload, data: { items: any[]; status: string }, req?: NextRequest) {
    const totalStart = performance.now();
    const { items, status } = data;
    validateOrderItems(items);
    const orderStatus = status === 'DRAFT' ? 'DRAFT' : 'NEW';

    // Constrain product and group queries to only items in this order
    const requestedProductIds = Array.from(new Set(
      items.map(i => i.productId || i.id).filter(Boolean) as string[]
    ));
    const requestedGroupIds = Array.from(new Set(
      items.map(i => i.groupId || i.id).filter(Boolean) as string[]
    ));

    const prefetchStart = performance.now();
    const [customer, allGroups] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          name: true
        }
      }),
      prisma.productGroup.findMany({
        where: {
          isActive: true,
          OR: [
            { id: { in: requestedGroupIds } },
            { skus: { some: { id: { in: requestedProductIds } } } }
          ]
        },
        include: { skus: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
      })
    ]);
    const customerMs = Math.round(performance.now() - prefetchStart);
    const groupsMs = customerMs;
    if (!customer) throw new Error('Клиент не найден.');
    const groupMap = new Map(allGroups.map(g => [g.id, g]));

    // Collect all relevant product IDs (requested directly + child SKUs of relevant groups)
    const groupSkuIds = allGroups.flatMap(g => g.skus.map(s => s.id));
    const relevantProductIds = Array.from(new Set([...requestedProductIds, ...groupSkuIds]));

    const productsStart = performance.now();
    const dbProducts = await prisma.product.findMany({
      where: {
        id: { in: relevantProductIds },
        isActive: true
      }
    });
    const productsMs = Math.round(performance.now() - productsStart);
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    const rawItems: any[] = [];

    for (const item of items) {
      const rawPacks = parseInt(item.baseQuantityPacks || item.quantityPacks || item.packs) || 0;
      const normalizedPacks = normalizePacks(rawPacks);
      if (normalizedPacks <= 0) continue;

      const requestedId = item.productId || item.groupId || item.id;
      if (!requestedId) continue;

      // 1. Check if item has a direct Product (SKU) match
      const directProduct = item.productId ? productMap.get(item.productId) : undefined;
      if (directProduct) {
        const parentGroup = directProduct.groupId ? groupMap.get(directProduct.groupId) : undefined;
        rawItems.push({
          productId: directProduct.id,
          sku: directProduct.sku,
          name: directProduct.name,
          baseQuantityPacks: normalizedPacks,
          price: directProduct.basePrice,
          groupId: parentGroup?.id,
          groupDisplayName: parentGroup?.displayName,
          groupSkus: parentGroup?.skus || [directProduct]
        });
        continue;
      }

      // 2. Check if requestedId is a ProductGroup
      const group = groupMap.get(requestedId) || (item.groupId ? groupMap.get(item.groupId) : undefined);
      if (group && group.skus.length > 0) {
        const primarySku = group.skus[0];
        rawItems.push({
          productId: primarySku.id,
          sku: primarySku.sku,
          name: primarySku.name,
          baseQuantityPacks: normalizedPacks,
          price: primarySku.basePrice,
          groupId: group.id,
          groupDisplayName: group.displayName,
          groupSkus: group.skus
        });
        continue;
      }

      // 3. Fallback: Check if requestedId is a Product (SKU)
      const product = productMap.get(requestedId);
      if (product) {
        const parentGroup = product.groupId ? groupMap.get(product.groupId) : undefined;
        rawItems.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          baseQuantityPacks: normalizedPacks,
          price: product.basePrice,
          groupId: parentGroup?.id,
          groupDisplayName: parentGroup?.displayName,
          groupSkus: parentGroup?.skus || [product]
        });
      }
    }

    if (rawItems.length === 0) {
      throw new Error('Нет позиций с корректным количеством (минимум 1 блок).');
    }

    // Process Promotions & Cost Redistribution (Single Source of Truth)
    const promoStart = performance.now();
    const promoResult = await PromotionsService.calculateOrder(rawItems, session.companyId);
    const promotionMs = Math.round(performance.now() - promoStart);

    // Ensure all products generated by promotions (e.g. bonus products of different SKUs) are loaded in productMap & groupMap
    let promotionExtraProductsMs = 0;
    let promotionExtraGroupsMs = 0;
    const promoExtraDataStart = performance.now();

    const missingProductIds = promoResult.items
      .map(i => i.productId)
      .filter(id => id && !productMap.has(id));

    if (missingProductIds.length > 0) {
      const extraProductsStart = performance.now();
      const extraProducts = await prisma.product.findMany({
        where: { id: { in: missingProductIds } }
      });
      promotionExtraProductsMs = Math.round(performance.now() - extraProductsStart);
      extraProducts.forEach(p => productMap.set(p.id, p));

      const missingGroupIds = extraProducts
        .map(p => (p as any).groupId)
        .filter(gid => gid && !groupMap.has(gid));

      if (missingGroupIds.length > 0) {
        const extraGroupsStart = performance.now();
        const extraGroups = await prisma.productGroup.findMany({
          where: { id: { in: missingGroupIds } },
          include: { skus: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
        });
        promotionExtraGroupsMs = Math.round(performance.now() - extraGroupsStart);
        extraGroups.forEach(g => groupMap.set(g.id, g));
      }
    }
    const promotionExtraDataMs = Math.round(performance.now() - promoExtraDataStart);

    // Pre-check stock & compute SKU allocations for all items before the transaction
    const itemAllocations = new Map<string, SkuAllocation[]>(); // productId -> allocations
    const itemAllocationsByIndex = new Map<number, SkuAllocation[]>(); // item index -> allocations
    if (orderStatus === 'NEW') {
      const stockTracker = new Map<string, number>(); // physical SKU id -> packs already allocated in this order

      for (let itemIdx = 0; itemIdx < promoResult.items.length; itemIdx++) {
        const vi = promoResult.items[itemIdx];
        const qty = vi.totalQuantityPacks;
        if (typeof qty !== 'number' || isNaN(qty)) {
          throw new Error(`Invalid quantity for product ${vi.productId}`);
        }
        const rawItem = rawItems.find(r => r.productId === vi.productId);
        const product = productMap.get(vi.productId);

        if (!vi.isBonus && rawItem?.groupSkus && rawItem.groupSkus.length > 0) {
          // Multi-SKU group ordered by customer: allocate across SKUs by priority with available stock
          const availableGroupSkus = rawItem.groupSkus.map((s: any) => {
            const alreadyAllocated = stockTracker.get(s.id) || 0;
            const availableStock = Math.max(0, s.stockPacks - alreadyAllocated);
            return {
              ...s,
              stockPacks: availableStock
            };
          });

          const allocs = ProductGroupService.allocatePacks(availableGroupSkus, qty);
          itemAllocations.set(vi.productId, allocs);
          itemAllocationsByIndex.set(itemIdx, allocs);

          // Update stock tracker with allocated packs
          for (const a of allocs) {
            stockTracker.set(a.productId, (stockTracker.get(a.productId) || 0) + a.packs);
          }
        } else {
          // Single SKU or dedicated promotion bonus SKU: allocate strictly to this SKU
          const alreadyAllocated = stockTracker.get(vi.productId) || 0;
          const availableStock = product ? Math.max(0, product.stockPacks - alreadyAllocated) : 0;

          if (product && qty > availableStock) {
            const prefix = vi.isBonus ? 'Превышен доступный лимит запасов для бонусной позиции:' : 'Превышен доступный лимит запасов для позиции:';
            throw new Error(`${prefix} ${product.name}. Пожалуйста, уменьшите объем заказа или выберите другую позицию.`);
          }
          const allocs = [
            { productId: vi.productId, sku: vi.sku, name: vi.name, packs: qty }
          ];
          itemAllocations.set(vi.productId, allocs);
          itemAllocationsByIndex.set(itemIdx, allocs);
          stockTracker.set(vi.productId, alreadyAllocated + qty);
        }
      }
    }

    const validationMs = Math.round(performance.now() - totalStart);

    const preTransactionGapStart = performance.now();

    const now = new Date();

    let stockDeductionMs = 0;
    let promoDeductionMs = 0;
    let orderCreateMs = 0;
    let orderItemSkuMs = 0;

    const txStart = performance.now();
    let savedOrder: any = null;
    let winningOrderNumber = '';
    const MAX_ORDER_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt++) {
      const attemptNow = new Date();
      const attemptOrderNumber = OrdersService.generateOrderNumber(attemptNow);

      try {
        savedOrder = await prisma.$transaction(async (tx) => {
          if (orderStatus === 'NEW') {
            const stockStart = performance.now();
            // Consolidate stock decrements per unique SKU to minimize queries and prevent race conditions
            const stockDecrements = new Map<string, number>();
            for (const allocs of itemAllocationsByIndex.values()) {
              for (const alloc of allocs) {
                stockDecrements.set(alloc.productId, (stockDecrements.get(alloc.productId) || 0) + alloc.packs);
              }
            }

            // Conditional atomic batch update in a single SQL roundtrip
            await OrdersService.batchDeductStock(tx, stockDecrements, productMap);
            stockDeductionMs = Math.round(performance.now() - stockStart);

            // Atomically deduct consumable fixed-amount promotion budgets with DB-level limit enforcement
            const promoDeductStart = performance.now();
            await OrdersService.batchDeductPromotionBudget(tx, promoResult.fixedAmountDeductions);
            promoDeductionMs = Math.round(performance.now() - promoDeductStart);

          }

          // Establish concurrency lock on all applied promotions (SKU bonuses, percentage, fixed amount)
          // for both NEW and DRAFT orders to prevent concurrent promotion deletion from creating dangling references
          const allAppliedPromoIds = Array.from(new Set([
            ...promoResult.items.map(i => i.promotionId).filter((id): id is string => Boolean(id)),
            ...(promoResult.fixedAmountDeductions || []).map(d => d.promotionId).filter((id): id is string => Boolean(id))
          ])).sort();

          if (allAppliedPromoIds.length > 0) {
            const activePromos = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM "Promotion"
              WHERE id = ANY(${allAppliedPromoIds}::text[])
                AND "isActive" = true
              ORDER BY id ASC
              FOR SHARE
            `;
            if (activePromos.length !== allAppliedPromoIds.length) {
              throw new Error('Одна или несколько примененных акций были изменены или удалены. Пожалуйста, обновите заказ.');
            }
          }

          // Exact deductions committed to promotion budgets (empty for DRAFT or orders without fixed-amount promo)
          const exactAppliedPromotions: AppliedPromotionDeduction[] = (orderStatus === 'NEW' && promoResult.fixedAmountDeductions)
            ? promoResult.fixedAmountDeductions
                .filter(d => d.promotionId && typeof d.amount === 'number' && d.amount > 0)
                .map(d => ({
                  promotionId: d.promotionId,
                  amount: Math.round(d.amount * 100) / 100
                }))
            : [];

          const orderCreateStart = performance.now();
          const order = await tx.order.create({
            data: {
              orderNumber: attemptOrderNumber,
              customerId: customer.id,
              companyId: session.companyId || null,
              createdByUserId: session.userId,
              status: orderStatus,
              totalPacks: promoResult.totalPacks,
              totalBlocks: promoResult.totalBlocks,
              totalCases: promoResult.totalCases,
              totalPrice: promoResult.totalPrice,
              appliedPromotions: exactAppliedPromotions as any,
              fileUrl: null,
              fileId: null,
              fileName: null,
              createdAt: attemptNow,
              updatedAt: attemptNow,
              items: {
                create: promoResult.items.map(vi => {
                  const rawItem = rawItems.find(r => r.productId === vi.productId);
                  const product = productMap.get(vi.productId);
                  const fallbackGroupId = vi.groupId || product?.groupId || null;
                  const fallbackGroupName = vi.groupDisplayName || (fallbackGroupId ? groupMap.get(fallbackGroupId)?.displayName : null);
                  return {
                    productId: vi.productId,
                    productNameSnapshot: vi.name,
                    skuSnapshot: vi.sku,
                    groupId: rawItem?.groupId || fallbackGroupId,
                    groupDisplayName: rawItem?.groupDisplayName || fallbackGroupName,
                    baseQuantityPacks: vi.baseQuantityPacks,
                    baseQuantityBlocks: vi.baseQuantityBlocks,
                    baseQuantityCases: vi.baseQuantityCases,
                    bonusQuantityPacks: vi.bonusQuantityPacks,
                    bonusQuantityBlocks: vi.bonusQuantityBlocks,
                    bonusQuantityCases: vi.bonusQuantityCases,
                    totalQuantityPacks: vi.totalQuantityPacks,
                    totalQuantityBlocks: vi.totalQuantityBlocks,
                    totalQuantityCases: vi.totalQuantityCases,
                    quantityPacks: vi.totalQuantityPacks,
                    quantityBlocks: vi.totalQuantityBlocks,
                    quantityCases: vi.totalQuantityCases,
                    price: vi.originalPrice,
                    effectivePrice: vi.effectivePrice,
                    itemTotalPrice: vi.itemTotalPrice,
                    promotionDiscount: vi.promotionDiscount,
                    isBonus: vi.isBonus,
                    promotionId: vi.promotionId || null,
                    promotionNote: vi.promotionNote || null
                  };
                })
              }
            },
            select: {
              id: true,
              orderNumber: true,
              customerId: true,
              status: true,
              totalPacks: true,
              totalBlocks: true,
              totalCases: true,
              totalPrice: true,
              appliedPromotions: true,
              fileUrl: true,
              fileId: true,
              fileName: true,
              createdAt: true,
              updatedAt: true,
              items: {
                select: {
                  id: true,
                  productId: true
                }
              }
            }
          });
          orderCreateMs = Math.round(performance.now() - orderCreateStart);

          // Write per-SKU allocations in a single batch query (OrderItemSku)
          if (orderStatus === 'NEW') {
            const skuStart = performance.now();
            const allSkuRows: any[] = [];
            for (let i = 0; i < order.items.length; i++) {
              const item = order.items[i];
              const allocs = itemAllocationsByIndex.get(i) || itemAllocations.get(item.productId);
              if (allocs && allocs.length > 0) {
                for (const a of allocs) {
                  allSkuRows.push({
                    orderItemId: item.id,
                    productId: a.productId,
                    packs: a.packs,
                    sku: a.sku,
                    name: a.name
                  });
                }
              }
            }
            if (allSkuRows.length > 0) {
              await tx.orderItemSku.createMany({ data: allSkuRows });
            }
            orderItemSkuMs = Math.round(performance.now() - skuStart);
          }

          return order;
        }, {
          timeout: 10000,
          maxWait: 5000
        });

        winningOrderNumber = attemptOrderNumber;
        break; // Successfully committed transaction!
      } catch (err: any) {
        const isUniqueCollision =
          err?.code === 'P2002' &&
          (Array.isArray(err?.meta?.target)
            ? err.meta.target.includes('orderNumber')
            : String(err?.meta?.target || '').includes('orderNumber') || String(err?.message || '').includes('orderNumber'));

        if (isUniqueCollision && attempt < MAX_ORDER_ATTEMPTS) {
          console.warn(`[WARN] Order number collision detected for ${attemptOrderNumber} on attempt ${attempt}. Retrying with fresh order number...`);
          continue;
        }
        throw err;
      }
    }

    const transactionMs = Math.round(performance.now() - txStart);
    const transactionStageTotalMs = stockDeductionMs + promoDeductionMs + orderCreateMs + orderItemSkuMs;

    // Trigger non-blocking background Excel generation and cloud attachment for NEW orders
    if (orderStatus === 'NEW') {
      void OrdersService.generateAndAttachExcel(
        savedOrder.id,
        winningOrderNumber,
        customer.name,
        promoResult.items.map((vi, idx) => ({
          ...vi,
          skuAllocations: itemAllocationsByIndex.get(idx) || itemAllocations.get(vi.productId)
        })),
        {
          totalBlocks: promoResult.totalBlocks,
          totalCases: promoResult.totalCases,
          totalPrice: promoResult.totalPrice
        }
      );
    }

    const postTxGapStart = performance.now();
    const diff = AuditService.formatItemsDiff([], promoResult.items.map(i => ({ name: i.name, quantity: i.totalQuantityPacks })));
    const postTransactionGapMs = Math.round(performance.now() - postTxGapStart);

    const auditStart = performance.now();
    await AuditService.log({
      userId: customer.id,
      action: orderStatus === 'DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT_ORDER',
      details: `${orderStatus === 'DRAFT' ? 'Сохранен черновик' : 'Отправлен заказ'} ${winningOrderNumber}. Стоимость: ${promoResult.totalPrice} UZS`,
      newValue: diff.newValue,
      req
    });
    const auditLogMs = Math.round(performance.now() - auditStart);

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] OrdersService.createOrder customerMs: ${customerMs}, groupsMs: ${groupsMs}, productsMs: ${productsMs}, promotionMs: ${promotionMs}, validationMs: ${validationMs}, stockDeductionMs: ${stockDeductionMs}, promoDeductionMs: ${promoDeductionMs}, orderCreateMs: ${orderCreateMs}, orderItemSkuMs: ${orderItemSkuMs}, transactionStageTotalMs: ${transactionStageTotalMs}, transactionMs: ${transactionMs}, auditLogMs: ${auditLogMs}, totalMs: ${totalMs}`);

    return {
      order: savedOrder,
      message: orderStatus === 'NEW'
        ? `Заказ ${winningOrderNumber} успешно оформлен!`
        : `Черновик ${winningOrderNumber} сохранен.`
    };
  }

  /**
   * PUT: Updates an existing DRAFT or NEW order (editing items).
   */
  static async updateOrder(
    session: JWTPayload,
    data: {
      orderId: string;
      items: any[];
      status: string;
      adminResolvedDeductions?: AppliedPromotionDeduction[];
      reconciliationReason?: string;
    },
    req?: NextRequest
  ) {
    const totalStart = performance.now();
    const { orderId, items, status, adminResolvedDeductions, reconciliationReason } = data;
    validateOrderItems(items);
    const orderStatus = status === 'NEW' ? 'NEW' : 'DRAFT';

    const isSuper = isSuperAdmin(session);
    if (adminResolvedDeductions && !isSuper) {
      const err: any = new Error('Только администраторы могут выполнять ручную сверку промо-бюджетов legacy-заказов.');
      err.status = 403;
      throw err;
    }

    const orderLookupStart = performance.now();
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        createdBy: true,
        items: { include: { product: true } }
      }
    });
    const orderLookupMs = Math.round(performance.now() - orderLookupStart);

    if (!existingOrder) throw new Error('Заказ не найден.');

    // 1. Permission-based edit checks
    const isCustomerOwner = existingOrder.customerId === session.userId;
    const isDraftAuthor = existingOrder.createdByUserId === session.userId || isCustomerOwner;
    const canViewAll = hasPermission(session, 'orders:view_all');
    const canEdit = hasPermission(session, 'orders:edit');

    if (!isSuper) {
      if (!canViewAll) {
        // Customer / Client role: strictly allowed to edit only their own drafts within company boundary
        if (existingOrder.companyId && (!session.companyId || existingOrder.companyId !== session.companyId)) {
          throw new Error('Нет доступа к заказам другой компании.');
        }
        if (!existingOrder.companyId && !isCustomerOwner && !isDraftAuthor) {
          throw new Error('Нет доступа к этому заказу.');
        }
        if (!isDraftAuthor && !isCustomerOwner) {
          throw new Error('Черновик доступен для редактирования только его автору.');
        }
        if (existingOrder.status !== 'DRAFT') {
          throw new Error('Клиент может редактировать только черновики.');
        }
      } else {
        // Staff user editing an order MUST have explicit orders:edit permission.
        // createdByUserId does NOT grant bypass of orders:edit for staff members.
        if (!canEdit) {
          throw new Error('У вас нет прав для редактирования этого заказа.');
        }

        // Enforce company boundary for staff unless they have global validation authority
        if (existingOrder.companyId && session.companyId && existingOrder.companyId !== session.companyId) {
          if (!hasPermission(session, 'orders:validation:view') && !hasPermission(session, 'orders:validation:accept')) {
            throw new Error('Нет доступа к заказам другой компании.');
          }
        }

        if (existingOrder.status !== 'DRAFT' && existingOrder.status !== 'NEW') {
          throw new Error('Заказ можно редактировать только в статусе DRAFT или NEW.');
        }

        if (existingOrder.status === 'NEW') {
          const isSameCompany = Boolean(session.companyId && existingOrder.companyId && session.companyId === existingOrder.companyId);
          if (!isSameCompany && !hasPermission(session, 'orders:validation:view')) {
            throw new Error('Доступ запрещен (заказ ожидает валидации).');
          }
        }
      }
    }

    // 2. Prevent edit if order is locked in assembly, shipped, completed or cancelled
    if (['ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'].includes(existingOrder.status)) {
      throw new Error(`Редактирование заказа запрещено в статусе: ${existingOrder.status}.`);
    }

    // Load existing SKU allocations for stock restore/checks
    const oldItemSkusStart = performance.now();
    const oldItemSkus = await prisma.orderItemSku.findMany({
      where: { orderItem: { orderId } }
    });
    const oldItemSkusMs = Math.round(performance.now() - oldItemSkusStart);

    // Constrain product and group queries to only relevant IDs for this update
    const requestedProductIds = Array.from(new Set([
      ...items.map(i => i.productId || i.id).filter(Boolean),
      ...existingOrder.items.map(i => i.productId).filter(Boolean),
      ...oldItemSkus.map(s => s.productId).filter(Boolean)
    ] as string[]));

    const requestedGroupIds = Array.from(new Set([
      ...items.map(i => i.groupId || i.id).filter(Boolean),
      ...existingOrder.items.map(i => (i.product as any)?.groupId).filter(Boolean)
    ] as string[]));

    const groupsStart = performance.now();
    const allGroups = await prisma.productGroup.findMany({
      where: {
        isActive: true,
        OR: [
          { id: { in: requestedGroupIds } },
          { skus: { some: { id: { in: requestedProductIds } } } }
        ]
      },
      include: { skus: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
    });
    const groupsMs = Math.round(performance.now() - groupsStart);
    const groupMap = new Map(allGroups.map(g => [g.id, g]));

    // Collect all relevant product IDs (requested directly + child SKUs of relevant groups)
    const groupSkuIds = allGroups.flatMap(g => g.skus.map(s => s.id));
    const relevantProductIds = Array.from(new Set([...requestedProductIds, ...groupSkuIds]));

    const productsStart = performance.now();
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: relevantProductIds } }
    });
    const productsMs = Math.round(performance.now() - productsStart);
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    const rawItems: any[] = [];
    const hasSubmittedPrices = items.some((item) => item && item.price !== undefined);
    const canSetManualPrices = hasPermission(session, 'orders:edit') && hasPermission(session, 'orders:view_all');
    if (hasSubmittedPrices && !canSetManualPrices) {
      const err: any = new Error('Недостаточно прав для изменения цен заказа.');
      err.status = 403;
      throw err;
    }
    const isManualPricing = hasSubmittedPrices && canSetManualPrices;

    for (const item of items) {
      const rawPacks = parseInt(item.baseQuantityPacks || item.quantityPacks || item.packs) || 0;
      const normalizedPacks = normalizePacks(rawPacks);
      if (normalizedPacks <= 0) continue;

      const requestedId = item.productId || item.groupId || item.id;
      if (!requestedId) continue;

      // 1. Check if item has a direct Product (SKU) match
      const directProduct = item.productId ? productMap.get(item.productId) : undefined;
      if (directProduct) {
        const parentGroup = directProduct.groupId ? groupMap.get(directProduct.groupId) : undefined;
        const explicitPrice = isManualPricing && item.price !== undefined ? Number(item.price) : directProduct.basePrice;
        if (!Number.isFinite(explicitPrice) || explicitPrice < 0 || explicitPrice > 1_000_000_000) throw new Error('Некорректная цена товара.');
        rawItems.push({
          productId: directProduct.id,
          sku: directProduct.sku,
          name: directProduct.name,
          baseQuantityPacks: normalizedPacks,
          quantityPacks: normalizedPacks,
          price: explicitPrice,
          isBonus: item.isBonus === true || (item.price !== undefined && explicitPrice === 0),
          promotionNote: item.promotionNote,
          groupId: parentGroup?.id || null,
          groupDisplayName: parentGroup?.displayName || null,
          groupSkus: parentGroup?.skus || [directProduct]
        });
        continue;
      }

      // 2. Check if requestedId or item.groupId is a ProductGroup
      const group = groupMap.get(requestedId) || (item.groupId ? groupMap.get(item.groupId) : undefined);
      if (group && group.skus.length > 0) {
        const primarySku = group.skus[0];
        const explicitPrice = isManualPricing && item.price !== undefined ? Number(item.price) : primarySku.basePrice;
        if (!Number.isFinite(explicitPrice) || explicitPrice < 0 || explicitPrice > 1_000_000_000) throw new Error('Некорректная цена товара.');
        rawItems.push({
          productId: primarySku.id,
          sku: primarySku.sku,
          name: primarySku.name,
          baseQuantityPacks: normalizedPacks,
          quantityPacks: normalizedPacks,
          price: explicitPrice,
          isBonus: item.isBonus === true || (item.price !== undefined && explicitPrice === 0),
          promotionNote: item.promotionNote,
          groupId: group.id,
          groupDisplayName: group.displayName,
          groupSkus: group.skus
        });
        continue;
      }

      // 3. Fallback: Check if requestedId is a Product (SKU)
      const product = productMap.get(requestedId);
      if (product) {
        const parentGroup = product.groupId ? groupMap.get(product.groupId) : undefined;
        const explicitPrice = isManualPricing && item.price !== undefined ? Number(item.price) : product.basePrice;
        if (!Number.isFinite(explicitPrice) || explicitPrice < 0 || explicitPrice > 1_000_000_000) throw new Error('Некорректная цена товара.');
        rawItems.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          baseQuantityPacks: normalizedPacks,
          quantityPacks: normalizedPacks,
          price: explicitPrice,
          isBonus: item.isBonus === true || (item.price !== undefined && explicitPrice === 0),
          promotionNote: item.promotionNote,
          groupId: parentGroup?.id || null,
          groupDisplayName: parentGroup?.displayName || null,
          groupSkus: parentGroup?.skus || [product]
        });
      }
    }

    if (rawItems.length === 0) {
      throw new Error('Нет позиций с корректным количеством (минимум 1 блок).');
    }

    let processedItems: any[] = [];
    let fixedAmountDeductions: any[] = [];
    let promotionMs = 0;

    if (!isManualPricing) {
      // Customer catalog draft submission / conversion: apply automatic promotion rules
      const promoStart = performance.now();
      const promoResult = await PromotionsService.calculateOrder(rawItems, session.companyId || existingOrder.companyId);
      promotionMs = Math.round(performance.now() - promoStart);
      processedItems = promoResult.items;
      fixedAmountDeductions = promoResult.fixedAmountDeductions;

      // Ensure all products generated by promotions are loaded in productMap, dbProducts, and groupMap
      const missingProductIds = promoResult.items
        .map(i => i.productId)
        .filter(id => id && !productMap.has(id));

      if (missingProductIds.length > 0) {
        const extraProducts = await prisma.product.findMany({
          where: { id: { in: missingProductIds } }
        });
        extraProducts.forEach(p => {
          productMap.set(p.id, p);
          dbProducts.push(p);
        });

        const missingGroupIds = extraProducts
          .map(p => (p as any).groupId)
          .filter(gid => gid && !groupMap.has(gid));

        if (missingGroupIds.length > 0) {
          const extraGroups = await prisma.productGroup.findMany({
            where: { id: { in: missingGroupIds } },
            include: { skus: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
          });
          extraGroups.forEach(g => groupMap.set(g.id, g));
        }
      }
    } else {
      // Seller / Manager manual edit: preserve explicit custom prices and quantities
      for (const item of rawItems) {
        const isBonus = item.isBonus === true || item.price === 0;
        const effectivePrice = isBonus ? 0 : Math.round(Number(item.price) * 100) / 100;
        const itemTotalPrice = Math.round(item.quantityPacks * effectivePrice * 100) / 100;
        const blocks = Math.floor(item.quantityPacks / 10);
        const cases = Math.round((item.quantityPacks / 500) * 100) / 100;

        processedItems.push({
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          groupId: item.groupId,
          groupDisplayName: item.groupDisplayName,
          groupSkus: item.groupSkus,
          baseQuantityPacks: isBonus ? 0 : item.quantityPacks,
          baseQuantityBlocks: isBonus ? 0 : blocks,
          baseQuantityCases: isBonus ? 0 : cases,
          bonusQuantityPacks: isBonus ? item.quantityPacks : 0,
          bonusQuantityBlocks: isBonus ? blocks : 0,
          bonusQuantityCases: isBonus ? cases : 0,
          totalQuantityPacks: item.quantityPacks,
          totalQuantityBlocks: blocks,
          totalQuantityCases: cases,
          quantityPacks: item.quantityPacks,
          quantityBlocks: blocks,
          quantityCases: cases,
          originalPrice: item.price,
          price: item.price,
          effectivePrice: effectivePrice,
          itemTotalPrice: itemTotalPrice,
          promotionDiscount: isBonus ? (item.quantityPacks * item.price) : 0,
          isBonus: isBonus,
          promotionId: null,
          promotionNote: isBonus ? (item.promotionNote || 'Бонусная позиция') : null
        });
      }
    }

    const totalPacks = processedItems.reduce((sum, i) => sum + (i.totalQuantityPacks ?? i.quantityPacks), 0);
    const totalBlocks = Math.floor(totalPacks / 10);
    const totalCases = Math.round((totalPacks / 500) * 100) / 100;
    const totalPrice = Math.round(processedItems.reduce((sum, i) => sum + i.itemTotalPrice, 0) * 100) / 100;

    // Compute SKU allocations for updateOrder
    const itemAllocations = new Map<string, SkuAllocation[]>();
    const itemAllocationsByIndex = new Map<number, SkuAllocation[]>();
    if (orderStatus === 'NEW') {
      const tempStockMap = new Map<string, number>();
      for (const p of dbProducts) tempStockMap.set(p.id, p.stockPacks);
      if (existingOrder.status === 'NEW') {
        for (const sku of oldItemSkus) {
          tempStockMap.set(sku.productId, (tempStockMap.get(sku.productId) ?? 0) + sku.packs);
        }
      }

      for (let itemIdx = 0; itemIdx < processedItems.length; itemIdx++) {
        const vi = processedItems[itemIdx];
        const qty = vi.totalQuantityPacks ?? vi.quantityPacks;
        const product = productMap.get(vi.productId);
        const rawItem = rawItems.find(r => r.productId === vi.productId);
        const candidateGroupSkus = rawItem?.groupSkus || vi.groupSkus;

        if (!vi.isBonus && candidateGroupSkus && candidateGroupSkus.length > 0) {
          const adjustedSkus = candidateGroupSkus.map((s: any) => ({
            ...s,
            stockPacks: tempStockMap.get(s.id) ?? s.stockPacks
          }));
          const allocs = ProductGroupService.allocatePacks(adjustedSkus, qty);
          itemAllocations.set(vi.productId, allocs);
          itemAllocationsByIndex.set(itemIdx, allocs);
          for (const a of allocs) {
            const cur = tempStockMap.get(a.productId) ?? 0;
            tempStockMap.set(a.productId, Math.max(0, cur - a.packs));
          }
        } else {
          const available = tempStockMap.get(vi.productId) ?? 0;
          if (qty > available) {
            const name = product?.name || 'неизвестно';
            const prefix = vi.isBonus ? 'Превышен доступный лимит запасов для бонусной позиции:' : 'Превышен доступный лимит запасов для позиции:';
            throw new Error(`${prefix} ${name}. Пожалуйста, уменьшите объем заказа или выберите другую позицию.`);
          }
          const allocs = [
            { productId: vi.productId, sku: vi.sku, name: vi.name, packs: qty }
          ];
          itemAllocations.set(vi.productId, allocs);
          itemAllocationsByIndex.set(itemIdx, allocs);
          tempStockMap.set(vi.productId, Math.max(0, available - qty));
        }
      }
    }

    const validationMs = Math.round(performance.now() - totalStart);

    const now = new Date();
    let stockRestoreMs = 0;
    let stockDeductionMs = 0;
    let promoDeductionMs = 0;
    let orderDeleteItemsMs = 0;
    let orderUpdateMs = 0;
    let orderItemSkuMs = 0;

    const txStart = performance.now();
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 1. Acquire exclusive row lock on the Order record
      const lockedRows = await tx.$queryRaw<Array<{
        id: string;
        orderNumber: string;
        customerId: string;
        companyId: string | null;
        createdByUserId: string | null;
        status: string;
        totalPacks: number;
        totalBlocks: number;
        totalCases: number;
        totalPrice: number;
        appliedPromotions: any;
        createdAt: Date;
        updatedAt: Date;
      }>>`
        SELECT
          id,
          "orderNumber",
          "customerId",
          "companyId",
          "createdByUserId",
          status,
          "totalPacks",
          "totalBlocks",
          "totalCases",
          "totalPrice",
          "appliedPromotions",
          "createdAt",
          "updatedAt"
        FROM "Order"
        WHERE id = ${orderId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        const err: any = new Error('Заказ не найден.');
        err.status = 404;
        throw err;
      }

      const currentOrder = lockedRows[0];

      // Re-validate terminal states under authoritative row lock
      if (['ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'].includes(currentOrder.status)) {
        const err: any = new Error(`Редактирование заказа запрещено в статусе: ${currentOrder.status}.`);
        if (currentOrder.status === 'CANCELLED') err.status = 409;
        throw err;
      }

      if (currentOrder.status !== 'DRAFT' && currentOrder.status !== 'NEW') {
        throw new Error('Заказ можно редактировать только в статусе DRAFT или NEW.');
      }

      const oldItems = await tx.orderItem.findMany({
        where: { orderId },
        include: { product: true }
      });
      const oldItemSkus = await tx.orderItemSku.findMany({
        where: { orderItem: { orderId } }
      });

      let previousFixedDeductions: Array<{ promotionId: string; amount: number }> = [];
      let legacyReconciliationUsed = false;

      // Restore old stock and promo budget under lock from authoritative database state
      if (currentOrder.status === 'NEW') {
        const restoreStart = performance.now();
        const resolution = await OrdersService.resolveOrderPromotionDeductions(
          {
            ...currentOrder,
            items: oldItems
          },
          {
            adminResolvedDeductions,
            session
          }
        );
        previousFixedDeductions = resolution.deductions;
        if (resolution.source === 'ADMIN_RESOLVED') {
          legacyReconciliationUsed = true;
        }

        const restoreMap = new Map<string, number>();
        if (oldItemSkus.length > 0) {
          for (const sku of oldItemSkus) {
            restoreMap.set(sku.productId, (restoreMap.get(sku.productId) || 0) + sku.packs);
          }
        } else {
          for (const oldItem of oldItems) {
            const oldQty = oldItem.totalQuantityPacks ?? oldItem.quantityPacks ?? 0;
            if (typeof oldQty === 'number' && Number.isFinite(oldQty) && oldQty > 0) {
              restoreMap.set(oldItem.productId, (restoreMap.get(oldItem.productId) || 0) + oldQty);
            }
          }
        }
        await OrdersService.batchRestoreStock(tx, restoreMap);
        await OrdersService.batchRestorePromotionBudget(tx, previousFixedDeductions);
        await tx.orderItemSku.deleteMany({ where: { orderItem: { orderId } } });
        stockRestoreMs = Math.round(performance.now() - restoreStart);
      }

      if (orderStatus === 'NEW') {
        const stockStart = performance.now();
        // Consolidate new stock decrements per unique SKU
        const stockDecrements = new Map<string, number>();
        for (const allocs of itemAllocationsByIndex.values()) {
          for (const alloc of allocs) {
            stockDecrements.set(alloc.productId, (stockDecrements.get(alloc.productId) || 0) + alloc.packs);
          }
        }

        // Conditional atomic batch update in a single SQL roundtrip
        await OrdersService.batchDeductStock(tx, stockDecrements, productMap);
        stockDeductionMs = Math.round(performance.now() - stockStart);

        // Atomically deduct consumable fixed-amount promotion budgets with DB-level limit enforcement
        const promoDeductStart = performance.now();
        await OrdersService.batchDeductPromotionBudget(tx, fixedAmountDeductions);
        promoDeductionMs = Math.round(performance.now() - promoDeductStart);

      }

      // Establish concurrency lock on all applied promotions (SKU bonuses, percentage, fixed amount)
      // for both NEW and DRAFT orders to prevent concurrent promotion deletion from creating dangling references
      const allAppliedPromoIds = Array.from(new Set([
        ...processedItems.map(i => i.promotionId).filter((id): id is string => Boolean(id)),
        ...(fixedAmountDeductions || []).map(d => d.promotionId).filter((id): id is string => Boolean(id))
      ])).sort();

      if (allAppliedPromoIds.length > 0) {
        const activePromos = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "Promotion"
          WHERE id = ANY(${allAppliedPromoIds}::text[])
            AND "isActive" = true
          ORDER BY id ASC
          FOR SHARE
        `;
        if (activePromos.length !== allAppliedPromoIds.length) {
          throw new Error('Одна или несколько примененных акций были изменены или удалены. Пожалуйста, обновите заказ.');
        }
      }

      const deleteItemsStart = performance.now();
      await tx.orderItem.deleteMany({ where: { orderId } });
      orderDeleteItemsMs = Math.round(performance.now() - deleteItemsStart);

      const createdAtUpdate = (orderStatus === 'DRAFT' || (currentOrder.status === 'DRAFT' && orderStatus === 'NEW')) ? now : currentOrder.createdAt;

      // Exact deductions committed to promotion budgets for the updated order
      const newAppliedPromotionsToPersist: AppliedPromotionDeduction[] = (orderStatus === 'NEW' && fixedAmountDeductions && fixedAmountDeductions.length > 0)
        ? OrdersService.parseAppliedPromotions(fixedAmountDeductions)
        : [];

      const orderUpdateStart = performance.now();
      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: orderStatus,
          totalPacks,
          totalBlocks,
          totalCases,
          totalPrice,
          appliedPromotions: newAppliedPromotionsToPersist as any,
          fileUrl: null,
          fileId: null,
          fileName: null,
          createdAt: createdAtUpdate,
          updatedAt: now,
          items: {
            create: processedItems.map(vi => {
              const rawItem = rawItems.find(r => r.productId === vi.productId);
              const product = productMap.get(vi.productId);
              const fallbackGroupId = vi.groupId || rawItem?.groupId || product?.groupId || null;
              const fallbackGroupName = vi.groupDisplayName || rawItem?.groupDisplayName || (fallbackGroupId ? groupMap.get(fallbackGroupId)?.displayName : null);
              const totalPacks = vi.totalQuantityPacks ?? vi.quantityPacks ?? 0;
              const totalBlocks = vi.totalQuantityBlocks ?? vi.quantityBlocks ?? Math.floor(totalPacks / 10);
              const totalCases = vi.totalQuantityCases ?? vi.quantityCases ?? (Math.round((totalPacks / 500) * 100) / 100);
              const basePrice = vi.price ?? vi.originalPrice ?? 0;
              const effPrice = Math.round((vi.effectivePrice ?? (vi.isBonus ? 0 : basePrice)) * 100) / 100;
              const itemTotal = Math.round(totalPacks * effPrice * 100) / 100;

              return {
                productId: vi.productId,
                productNameSnapshot: vi.name,
                skuSnapshot: vi.sku,
                groupId: fallbackGroupId,
                groupDisplayName: fallbackGroupName,
                baseQuantityPacks: vi.baseQuantityPacks ?? (vi.isBonus ? 0 : totalPacks),
                baseQuantityBlocks: vi.baseQuantityBlocks ?? (vi.isBonus ? 0 : totalBlocks),
                baseQuantityCases: vi.baseQuantityCases ?? (vi.isBonus ? 0 : totalCases),
                bonusQuantityPacks: vi.bonusQuantityPacks ?? (vi.isBonus ? totalPacks : 0),
                bonusQuantityBlocks: vi.bonusQuantityBlocks ?? (vi.isBonus ? totalBlocks : 0),
                bonusQuantityCases: vi.bonusQuantityCases ?? (vi.isBonus ? totalCases : 0),
                totalQuantityPacks: totalPacks,
                totalQuantityBlocks: totalBlocks,
                totalQuantityCases: totalCases,
                quantityPacks: totalPacks,
                quantityBlocks: totalBlocks,
                quantityCases: totalCases,
                price: basePrice,
                effectivePrice: effPrice,
                itemTotalPrice: itemTotal,
                promotionDiscount: vi.promotionDiscount ?? (vi.isBonus ? (totalPacks * basePrice) : 0),
                isBonus: vi.isBonus ?? (effPrice === 0),
                promotionId: vi.promotionId || null,
                promotionNote: vi.promotionNote || null
              };
            })
          }
        },
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          status: true,
          totalPacks: true,
          totalBlocks: true,
          totalCases: true,
          totalPrice: true,
          appliedPromotions: true,
          fileUrl: true,
          fileId: true,
          fileName: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              productId: true
            }
          }
        }
      });
      orderUpdateMs = Math.round(performance.now() - orderUpdateStart);

      // Write new per-SKU allocations in a single batch query
      if (orderStatus === 'NEW') {
        const skuStart = performance.now();
        const allSkuRows: any[] = [];
        for (let i = 0; i < order.items.length; i++) {
          const item = order.items[i];
          const allocs = itemAllocationsByIndex.get(i) || itemAllocations.get(item.productId);
          if (allocs && allocs.length > 0) {
            for (const a of allocs) {
              allSkuRows.push({
                orderItemId: item.id,
                productId: a.productId,
                packs: a.packs,
                sku: a.sku,
                name: a.name
              });
            }
          }
        }
        if (allSkuRows.length > 0) {
          await tx.orderItemSku.createMany({ data: allSkuRows });
        }
        orderItemSkuMs = Math.round(performance.now() - skuStart);
      }

      if (legacyReconciliationUsed) {
        let auditUserId: string | null = null;
        if (session.userId) {
          const u = await tx.user.findUnique({ where: { id: session.userId }, select: { id: true } });
          if (u) auditUserId = u.id;
        }
        await tx.auditLog.create({
          data: {
            userId: auditUserId,
            action: 'RECONCILE_LEGACY_PROMOTION_BUDGET',
            details: JSON.stringify({
              orderId: currentOrder.id,
              orderNumber: currentOrder.orderNumber,
              resolvedBy: session.name || session.email || session.userId,
              resolvedByUserId: session.userId,
              reconciledDeductions: previousFixedDeductions,
              reason: reconciliationReason || 'Ручная сверка промо-бюджета legacy-заказа при редактировании'
            }),
            oldValue: 'LEGACY_UNRECORDED',
            newValue: JSON.stringify(previousFixedDeductions)
          }
        });
      }

      return order;
    }, {
      timeout: 10000,
      maxWait: 5000
    });
    const transactionMs = Math.round(performance.now() - txStart);

    // Trigger non-blocking background Excel generation and cloud attachment for NEW orders
    if (orderStatus === 'NEW') {
      void OrdersService.generateAndAttachExcel(
        existingOrder.id,
        existingOrder.orderNumber,
        existingOrder.customer.name,
        processedItems.map((vi, idx) => ({
          ...vi,
          skuAllocations: itemAllocationsByIndex.get(idx) || itemAllocations.get(vi.productId)
        })),
        {
          totalBlocks,
          totalCases,
          totalPrice
        }
      );
    }

    const oldFormat = existingOrder.items.map(i => ({ name: i.productNameSnapshot || i.product?.name || 'Неизвестно', quantity: i.totalQuantityPacks ?? i.quantityPacks }));
    const newFormat = processedItems.map(i => ({ name: i.name, quantity: i.totalQuantityPacks }));
    const diff = AuditService.formatItemsDiff(oldFormat, newFormat);

    let auditDetails = `${orderStatus === 'DRAFT' ? 'Обновлён черновик' : 'Отредактирован заказ'} ${existingOrder.orderNumber}. Стоимость: ${totalPrice} UZS`;
    if (orderStatus === 'NEW' && existingOrder.createdByUserId && existingOrder.createdByUserId !== session.userId) {
      const creatorName = existingOrder.createdBy?.name || 'коллегой';
      auditDetails = `Пользователь ${session.name || session.email} отправил черновик, созданный пользователем ${creatorName}. Номер заказа: ${existingOrder.orderNumber}. Стоимость: ${totalPrice} UZS`;
    }

    const auditStart = performance.now();
    await AuditService.log({
      userId: session.userId,
      action: orderStatus === 'DRAFT' ? 'UPDATE_DRAFT' : 'SUBMIT_DRAFT_ORDER',
      details: auditDetails,
      oldValue: diff.oldValue,
      newValue: diff.newValue,
      req
    });
    const auditLogMs = Math.round(performance.now() - auditStart);

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] OrdersService.updateOrder orderLookupMs: ${orderLookupMs}, oldItemSkusMs: ${oldItemSkusMs}, groupsMs: ${groupsMs}, productsMs: ${productsMs}, promotionMs: ${promotionMs}, validationMs: ${validationMs}, stockRestoreMs: ${stockRestoreMs}, stockDeductionMs: ${stockDeductionMs}, promoDeductionMs: ${promoDeductionMs}, orderDeleteItemsMs: ${orderDeleteItemsMs}, orderUpdateMs: ${orderUpdateMs}, orderItemSkuMs: ${orderItemSkuMs}, transactionMs: ${transactionMs}, auditLogMs: ${auditLogMs}, totalMs: ${totalMs}`);

    return {
      order: updatedOrder,
      message: orderStatus === 'NEW'
        ? `Заказ ${existingOrder.orderNumber} успешно оформлен!`
        : `Черновик ${existingOrder.orderNumber} обновлён.`
    };
  }

  /**
   * PUT: Changes the status of an existing order or cancels it.
   */
  static async updateOrderStatus(
    session: JWTPayload,
    data: {
      orderId: string;
      status: string;
      reason?: string;
      adminResolvedDeductions?: AppliedPromotionDeduction[];
      reconciliationReason?: string;
    },
    req?: NextRequest
  ) {
    const { orderId, status, reason, adminResolvedDeductions, reconciliationReason } = data;
    const VALID_STATUSES = ['NEW', 'ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'];

    if (!VALID_STATUSES.includes(status)) {
      const err: any = new Error('Недопустимый статус заказа.');
      err.status = 400;
      throw err;
    }

    const isSuper = isSuperAdmin(session);
    if (adminResolvedDeductions && !isSuper) {
      const err: any = new Error('Только администраторы могут выполнять ручную сверку промо-бюджетов legacy-заказов.');
      err.status = 403;
      throw err;
    }

    let previousStatusForAudit = '';

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 1. Acquire exclusive row lock on the Order record
      const lockedRows = await tx.$queryRaw<Array<{
        id: string;
        orderNumber: string;
        customerId: string;
        companyId: string | null;
        createdByUserId: string | null;
        status: string;
        totalPacks: number;
        totalBlocks: number;
        totalCases: number;
        totalPrice: number;
        appliedPromotions: any;
        createdAt: Date;
        updatedAt: Date;
      }>>`
        SELECT
          id,
          "orderNumber",
          "customerId",
          "companyId",
          "createdByUserId",
          status,
          "totalPacks",
          "totalBlocks",
          "totalCases",
          "totalPrice",
          "appliedPromotions",
          "createdAt",
          "updatedAt"
        FROM "Order"
        WHERE id = ${orderId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        const err: any = new Error('Заказ не найден.');
        err.status = 404;
        throw err;
      }

      const currentOrder = lockedRows[0];
      const oldStatus = currentOrder.status;
      previousStatusForAudit = oldStatus;

      // Enforce company boundary and tenant authorization under authoritative row lock
      if (!isSuper) {
        const canViewAll = hasPermission(session, 'orders:view_all');
        if (!canViewAll) {
          if (currentOrder.companyId && (!session.companyId || currentOrder.companyId !== session.companyId)) {
            const err: any = new Error('Нет доступа к заказам другой компании.');
            err.status = 403;
            throw err;
          }
          if (!currentOrder.companyId && currentOrder.customerId !== session.userId && currentOrder.createdByUserId !== session.userId) {
            const err: any = new Error('Нет доступа к этому заказу.');
            err.status = 403;
            throw err;
          }
        } else {
          // Staff user with companyId can only modify their company's orders unless they have global validation authority
          if (currentOrder.companyId && session.companyId && currentOrder.companyId !== session.companyId) {
            if (!hasPermission(session, 'orders:validation:view') && !hasPermission(session, 'orders:validation:accept')) {
              const err: any = new Error('Нет доступа к заказам другой компании.');
              err.status = 403;
              throw err;
            }
          }
        }
      }

      if (oldStatus === status) {
        if (status === 'CANCELLED') {
          const err: any = new Error('Заказ уже отменен.');
          err.status = 409;
          throw err;
        }
        return currentOrder;
      }

      // Lifecycle transitions validation
      // 1. CANCELLED is final terminal state
      if (oldStatus === 'CANCELLED') {
        const err: any = new Error('Нельзя изменить статус отмененного заказа.');
        err.status = 409;
        throw err;
      }

      // 2. Terminal state protection: SHIPPED or COMPLETED cannot be cancelled
      if (status === 'CANCELLED' && (oldStatus === 'SHIPPED' || oldStatus === 'COMPLETED')) {
        const err: any = new Error(`Нельзя отменить исполненный заказ в статусе "${oldStatus}".`);
        err.status = 409;
        throw err;
      }

      // 3. Status can only be cancelled from DRAFT, NEW, ACCEPTED, ASSEMBLY
      if (status === 'CANCELLED' && !['DRAFT', 'NEW', 'ACCEPTED', 'ASSEMBLY'].includes(oldStatus)) {
        const err: any = new Error(`Нельзя отменить заказ в статусе "${oldStatus}".`);
        err.status = 400;
        throw err;
      }

      if (status === 'CANCELLED') {
        const shouldRevertStock = ['NEW', 'ACCEPTED', 'ASSEMBLY'].includes(oldStatus);
        let cancelPromoDeductions: AppliedPromotionDeduction[] = [];
        let legacyReconciliationUsed = false;

        if (shouldRevertStock) {
          const orderItems = await tx.orderItem.findMany({
            where: { orderId },
            include: { product: true }
          });

          const resolution = await OrdersService.resolveOrderPromotionDeductions(
            {
              ...currentOrder,
              items: orderItems
            },
            {
              adminResolvedDeductions,
              session
            }
          );
          cancelPromoDeductions = resolution.deductions;
          if (resolution.source === 'ADMIN_RESOLVED') {
            legacyReconciliationUsed = true;
          }

          // Prefer restoring from granular OrderItemSku records
          const oldItemSkus = await tx.orderItemSku.findMany({
            where: { orderItem: { orderId } }
          });
          const restoreMap = new Map<string, number>();
          if (oldItemSkus.length > 0) {
            for (const sku of oldItemSkus) {
              restoreMap.set(sku.productId, (restoreMap.get(sku.productId) || 0) + sku.packs);
            }
          } else {
            // Fallback for legacy orders without OrderItemSku records
            for (const item of orderItems) {
              const qty = item.totalQuantityPacks ?? item.quantityPacks ?? 0;
              if (typeof qty !== 'number' || isNaN(qty) || qty <= 0) continue;
              restoreMap.set(item.productId, (restoreMap.get(item.productId) || 0) + qty);
            }
          }
          await OrdersService.batchRestoreStock(tx, restoreMap);
          await OrdersService.batchRestorePromotionBudget(tx, cancelPromoDeductions);
        }

        const cancelledOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'CANCELLED',
            appliedPromotions: []
          },
          include: {
            customer: { select: { name: true, email: true } },
            items: { include: { product: true } }
          }
        });

        // Record CANCEL_ORDER in AuditLog inside transaction
        let auditUserId: string | null = null;
        if (session.userId) {
          const u = await tx.user.findUnique({ where: { id: session.userId }, select: { id: true } });
          if (u) auditUserId = u.id;
        }

        await tx.auditLog.create({
          data: {
            userId: auditUserId,
            action: 'CANCEL_ORDER',
            details: JSON.stringify({
              orderId: currentOrder.id,
              orderNumber: currentOrder.orderNumber,
              cancelledBy: session.name || session.email || session.userId,
              cancelledByUserId: session.userId,
              previousStatus: oldStatus,
              totalPacks: currentOrder.totalPacks,
              totalPrice: currentOrder.totalPrice,
              restoredDeductions: cancelPromoDeductions,
              reason: reason || 'Отмена заказа пользователем',
              stockReverted: shouldRevertStock
            }),
            oldValue: oldStatus,
            newValue: 'CANCELLED'
          }
        });

        if (legacyReconciliationUsed) {
          await tx.auditLog.create({
            data: {
              userId: auditUserId,
              action: 'RECONCILE_LEGACY_PROMOTION_BUDGET',
              details: JSON.stringify({
                orderId: currentOrder.id,
                orderNumber: currentOrder.orderNumber,
                resolvedBy: session.name || session.email || session.userId,
                resolvedByUserId: session.userId,
                reconciledDeductions: cancelPromoDeductions,
                reason: reconciliationReason || 'Ручная сверка промо-бюджета legacy-заказа при отмене'
              }),
              oldValue: 'LEGACY_UNRECORDED',
              newValue: JSON.stringify(cancelPromoDeductions)
            }
          });
        }

        return cancelledOrder;
      }

      // If reverting from CANCELLED status (should be blocked by lifecycle validation anyway, but keeping stock safe)
      if (oldStatus === 'CANCELLED' && status !== 'CANCELLED' && status !== 'DRAFT') {
        const orderItems = await tx.orderItem.findMany({ where: { orderId } });
        for (const item of orderItems) {
          const qty = item.totalQuantityPacks ?? item.quantityPacks ?? 0;
          if (typeof qty !== 'number' || isNaN(qty) || qty <= 0) {
            throw new Error(`Invalid quantity for product ${item.productId}`);
          }
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product || product.stockPacks < qty) {
            throw new Error(`Недостаточно запаса на складе для восстановления заказа по позиции: ${product?.name || 'неизвестно'}`);
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stockPacks: { decrement: qty } }
          });
        }
      }

      return await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: {
          customer: { select: { name: true, email: true } },
          items: { include: { product: true } }
        }
      });
    }, {
      timeout: 10000,
      maxWait: 5000
    });

    if (status !== 'CANCELLED') {
      await AuditService.log({
        userId: session.userId,
        action: 'CHANGE_ORDER_STATUS',
        details: `Пользователь (${session.role}) изменил статус заказа ${updatedOrder.orderNumber} с ${previousStatusForAudit} на ${status}`,
        oldValue: previousStatusForAudit,
        newValue: status,
        req
      });
    }

    return {
      order: updatedOrder,
      message: status === 'CANCELLED'
        ? `Заказ ${updatedOrder.orderNumber} успешно отменен.`
        : `Статус заказа ${updatedOrder.orderNumber} изменен на "${status}"`
    };
  }

  /**
   * POST: Accepts a NEW order (NEW -> ACCEPTED) with atomic concurrency protection.
   */
  static async acceptOrder(session: JWTPayload, orderId: string, req?: NextRequest) {
    if (!hasPermission(session, 'orders:validation:accept')) {
      throw new Error('У вас недостаточно прав для принятия заказа.');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true }
    });

    if (!order) {
      throw new Error('Заказ не найден.');
    }

    if (order.status === 'ACCEPTED') {
      throw new Error('Заказ уже принят.');
    }

    if (order.status !== 'NEW') {
      throw new Error(`Невозможно принять заказ в текущем статусе: ${order.status}.`);
    }

    // Atomic race-condition safe update: exactly 1 concurrent request can succeed
    const updateResult = await prisma.order.updateMany({
      where: {
        id: orderId,
        status: 'NEW'
      },
      data: {
        status: 'ACCEPTED'
      }
    });

    if (updateResult.count === 0) {
      throw new Error('Заказ уже принят другим пользователем или его статус был изменен.');
    }

    await AuditService.log({
      userId: session.userId,
      action: 'ACCEPT_ORDER',
      details: `Заказ №${order.orderNumber} принят в обработку (NEW -> ACCEPTED)`,
      oldValue: 'NEW',
      newValue: 'ACCEPTED',
      req
    });

    const acceptedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true, code: true } }
      }
    });

    return {
      success: true,
      order: acceptedOrder,
      message: `Заказ ${order.orderNumber} успешно принят.`
    };
  }

  /**
   * DELETE: Deletes an order if and only if it is in DRAFT status.
   */
  static async deleteDraft(session: JWTPayload, orderId: string, req?: NextRequest) {
    if (!orderId || typeof orderId !== 'string' || orderId.trim() === '') {
      throw new Error('Refusing cleanup: missing orderId');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        createdByUserId: true,
        companyId: true,
      }
    });

    if (!order) {
      throw new Error('Черновик заказа не найден.');
    }

    if (order.status !== 'DRAFT') {
      throw new Error('Удалить можно только черновик заказа.');
    }

    const isSuper = isSuperAdmin(session);
    const isOwner = order.customerId === session.userId || (order as any).createdByUserId === session.userId;
    const hasDeletePermission = hasPermission(session, 'orders:delete_draft') || hasPermission(session, 'orders:delete');

    if (!isSuper) {
      if (hasDeletePermission) {
        if (session.companyId && order.companyId && session.companyId !== order.companyId && !hasPermission(session, 'orders:view_all')) {
          throw new Error('У вас нет прав для удаления черновика другой компании.');
        }
      } else {
        if (!isOwner) {
          throw new Error('У вас нет прав для удаления этого черновика.');
        }
      }
    }

    await prisma.order.delete({
      where: { id: orderId }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'DELETE_DRAFT',
      details: `Черновик заказа №${order.orderNumber} удален`,
      req
    });

    return {
      success: true,
      deletedOrderId: orderId,
      orderNumber: order.orderNumber,
      message: `Черновик №${order.orderNumber} успешно удален.`
    };
  }

  private static templateBufferCache: { fileId: string; buffer: Buffer; expiresAt: number } | null = null;

  /**
   * Helper: compile Excel template and upload to storage service
   */
  private static async compileAndUploadExcel(orderNumber: string, clientName: string, validatedItems: any[], totals: { totalBlocks: number; totalCases: number; totalPrice: number }) {
    const templateDbStart = performance.now();
    let activeTemplate = await prisma.template.findFirst({ where: { isActive: true } });
    const templateDbMs = Math.round(performance.now() - templateDbStart);
    let templateDownloadMs = 0;
    let templateBuffer: Buffer;
    let templateFileName = 'default_order_template.xlsx';

    if (activeTemplate && !activeTemplate.isLocal && activeTemplate.fileId) {
      templateFileName = activeTemplate.name.endsWith('.xlsx') ? activeTemplate.name : `${activeTemplate.name}.xlsx`;
      const now = Date.now();
      if (this.templateBufferCache && this.templateBufferCache.fileId === activeTemplate.fileId && this.templateBufferCache.expiresAt > now) {
        templateBuffer = this.templateBufferCache.buffer;
      } else {
        const templateDownloadStart = performance.now();
        templateBuffer = await storageService.downloadFile(activeTemplate.fileId, templateFileName, 'Templates');
        templateDownloadMs = Math.round(performance.now() - templateDownloadStart);
        this.templateBufferCache = {
          fileId: activeTemplate.fileId,
          buffer: templateBuffer,
          expiresAt: now + 10 * 60 * 1000 // 10 minutes cache
        };
      }
    } else {
      const localPath = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
      if (fs.existsSync(localPath)) {
        templateBuffer = fs.readFileSync(localPath);
      } else {
        throw new Error('Default spreadsheet template missing on disk.');
      }
    }

    const excelDataPrepStart = performance.now();
    const outputMode = (activeTemplate as any)?.outputMode || 'COMMERCIAL';

    // Map CalculatedOrderItem[] to the format expected by generateExcelOrder
    const excelItems: any[] = [];

    for (const vi of validatedItems) {
      if (outputMode === 'INVENTORY' && vi.skuAllocations && vi.skuAllocations.length > 0) {
        const totalP = vi.totalQuantityPacks ?? vi.totalPacks ?? vi.quantityPacks ?? 0;
        for (const alloc of vi.skuAllocations) {
          const allocPacks = alloc.packs;
          const allocBlocks = Math.floor(allocPacks / 10);
          const allocCases = allocPacks / 500;
          const share = totalP > 0 ? (allocPacks / totalP) : 0;
          const lineTotalPrice = Math.round((vi.itemTotalPrice * share) * 100) / 100;

          const unitPrice = vi.originalPrice ?? vi.price ?? 0;
          const grossVal = Math.round(allocPacks * unitPrice * 100) / 100;
          const promoDiscount = Math.max(0, Math.round((grossVal - lineTotalPrice) * 100) / 100);

          excelItems.push({
            sku: alloc.sku,
            name: alloc.name,
            packs: allocPacks,
            blocks: allocBlocks,
            cases: allocCases,
            baseQuantityPacks: Math.round((vi.baseQuantityPacks ?? 0) * share),
            bonusQuantityPacks: Math.round((vi.bonusQuantityPacks ?? 0) * share),
            totalQuantityPacks: allocPacks,
            baseQuantityBlocks: Math.round((vi.baseQuantityBlocks ?? 0) * share),
            bonusQuantityBlocks: Math.round((vi.bonusQuantityBlocks ?? 0) * share),
            totalQuantityBlocks: allocBlocks,
            price: unitPrice,
            effectivePrice: vi.effectivePrice ?? unitPrice,
            itemTotalPrice: lineTotalPrice,
            promotionDiscount: promoDiscount,
            grossValue: grossVal,
            isBonus: vi.isBonus ?? false,
            promotionNote: vi.promotionNote ?? null
          });
        }
      } else {
        const totalP = vi.totalQuantityPacks ?? vi.totalPacks ?? vi.quantityPacks ?? 0;
        const unitPrice = vi.originalPrice ?? vi.price ?? 0;
        const lineTotal = vi.itemTotalPrice ?? 0;
        const grossVal = Math.round(totalP * unitPrice * 100) / 100;
        const promoDiscount = vi.promotionDiscount ?? Math.max(0, Math.round((grossVal - lineTotal) * 100) / 100);

        excelItems.push({
          sku: vi.sku || vi.skuSnapshot || '',
          name: vi.groupDisplayName || vi.name || vi.productNameSnapshot || '',
          packs: totalP,
          blocks: vi.totalQuantityBlocks ?? vi.totalBlocks ?? vi.quantityBlocks ?? 0,
          cases: vi.totalQuantityCases ?? vi.totalCases ?? vi.quantityCases ?? 0,
          baseQuantityPacks: vi.baseQuantityPacks ?? 0,
          bonusQuantityPacks: vi.bonusQuantityPacks ?? 0,
          totalQuantityPacks: totalP,
          baseQuantityBlocks: vi.baseQuantityBlocks ?? 0,
          bonusQuantityBlocks: vi.bonusQuantityBlocks ?? 0,
          totalQuantityBlocks: vi.totalQuantityBlocks ?? vi.totalBlocks ?? vi.quantityBlocks ?? 0,
          price: unitPrice,
          effectivePrice: vi.effectivePrice ?? unitPrice,
          itemTotalPrice: lineTotal,
          promotionDiscount: promoDiscount,
          grossValue: grossVal,
          isBonus: vi.isBonus ?? false,
          promotionNote: vi.promotionNote ?? null
        });
      }
    }

    const excelOrderData = {
      clientName,
      orderDate: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }),
      orderNumber,
      totalBlocks: totals.totalBlocks,
      totalCases: Math.round(totals.totalCases * 100) / 100,
      totalPrice: totals.totalPrice,
      items: excelItems
    };
    const excelDataPreparationMs = Math.round(performance.now() - excelDataPrepStart);

    const excelStart = performance.now();
    const compiledExcelBuffer = await generateExcelOrder(templateBuffer, excelOrderData);
    const excelMs = Math.round(performance.now() - excelStart);

    const fileMetadataPrepStart = performance.now();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sanitizedClient = clientName.replace(/[^a-zA-Z0-9а-яА-Я_-]/g, '');
    const excelFileName = `${year}-${month}-${day}_${hour}-${min}_${sanitizedClient}.xlsx`;
    const fileMetadataPreparationMs = Math.round(performance.now() - fileMetadataPrepStart);

    const storageStart = performance.now();
    const uploadResult = await storageService.uploadFile(
      excelFileName,
      compiledExcelBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Orders'
    );
    const storageMs = Math.round(performance.now() - storageStart);

    return {
      fileUrl: `/api/orders/download?fileId=${uploadResult.fileId}` +
      `&fileName=${encodeURIComponent(excelFileName)}`,
      fileId: uploadResult.fileId,
      fileName: excelFileName,
      buffer: compiledExcelBuffer,
      message: uploadResult.message,
      templateDbMs,
      templateDownloadMs,
      excelDataPreparationMs,
      fileMetadataPreparationMs,
      excelMs,
      storageMs
    };
  }
}
