import { NextRequest } from 'next/server';
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

import { JWTPayload, hasPermission } from '../auth';
import { getTashkentStartOfDay, getTashkentStartOfNextDay } from '../date-utils';

export class OrdersService {
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

    const valueClauses = entries.map(([id, needed]) => Prisma.sql`(${id}::text, ${needed}::integer)`);
    const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" - v.needed
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, needed)
      WHERE p.id = v.id AND p."stockPacks" >= v.needed
      RETURNING p.id
    `;

    if (updatedRows.length !== entries.length) {
      const updatedSet = new Set(updatedRows.map(r => r.id));
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

    const valueClauses = entries.map(([id, packs]) => Prisma.sql`(${id}::text, ${packs}::integer)`);
    await tx.$executeRaw`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" + v.packs
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, packs)
      WHERE p.id = v.id
    `;
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
  static async ensureExcelGenerated(orderId: string): Promise<{ fileId: string; fileName: string; fileUrl: string } | null> {
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
      fileUrl: uploadResult.fileUrl
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
    if (session.role === 'ADMIN' || session.roleName === 'Суперадминистратор' || session.permissions?.includes('*')) {
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
      session.role === 'ADMIN' ||
      session.roleName === 'Суперадминистратор' ||
      session.permissions?.includes('*');

    if (!canViewAll) {
      // Customer: can view their company's orders or own orders in any status
      if (session.companyId) {
        whereClause.companyId = session.companyId;
        // DRAFT orders: if a company customer is viewing, only their own DRAFTs are visible
        if (status === 'DRAFT') {
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
        }
      } else {
        whereClause.customerId = session.userId;
      }
      if (status && status !== 'DRAFT') {
        whereClause.status = status;
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
          const availableGroupSkus = rawItem.groupSkus.map(s => {
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
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const orderNumber = `ORD-${dateStr}-${timeStr}-${Math.floor(100 + Math.random() * 900)}`;

    let stockDeductionMs = 0;
    let promoDeductionMs = 0;
    let orderCreateMs = 0;
    let orderItemSkuMs = 0;

    const txStart = performance.now();
    const savedOrder = await prisma.$transaction(async (tx) => {
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

        // Deduct consumable fixed-amount promotion budgets
        const promoDeductStart = performance.now();
        for (const deduction of promoResult.fixedAmountDeductions) {
          await tx.promotion.update({
            where: { id: deduction.promotionId },
            data: {
              remainingAmount: { decrement: deduction.amount },
              consumedAmount: { increment: deduction.amount }
            }
          });
        }
        promoDeductionMs = Math.round(performance.now() - promoDeductStart);
      }

      const orderCreateStart = performance.now();
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          companyId: session.companyId || null,
          createdByUserId: session.userId,
          status: orderStatus,
          totalPacks: promoResult.totalPacks,
          totalBlocks: promoResult.totalBlocks,
          totalCases: promoResult.totalCases,
          totalPrice: promoResult.totalPrice,
          fileUrl: null,
          fileId: null,
          fileName: null,
          createdAt: now,
          updatedAt: now,
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
    const transactionMs = Math.round(performance.now() - txStart);
    const transactionStageTotalMs = stockDeductionMs + promoDeductionMs + orderCreateMs + orderItemSkuMs;

    // Trigger non-blocking background Excel generation and cloud attachment for NEW orders
    if (orderStatus === 'NEW') {
      void OrdersService.generateAndAttachExcel(
        savedOrder.id,
        orderNumber,
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
      details: `${orderStatus === 'DRAFT' ? 'Сохранен черновик' : 'Отправлен заказ'} ${orderNumber}. Стоимость: ${promoResult.totalPrice} UZS`,
      newValue: diff.newValue,
      req
    });
    const auditLogMs = Math.round(performance.now() - auditStart);

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] OrdersService.createOrder customerMs: ${customerMs}, groupsMs: ${groupsMs}, productsMs: ${productsMs}, promotionMs: ${promotionMs}, validationMs: ${validationMs}, stockDeductionMs: ${stockDeductionMs}, promoDeductionMs: ${promoDeductionMs}, orderCreateMs: ${orderCreateMs}, orderItemSkuMs: ${orderItemSkuMs}, transactionStageTotalMs: ${transactionStageTotalMs}, transactionMs: ${transactionMs}, auditLogMs: ${auditLogMs}, totalMs: ${totalMs}`);

    return {
      order: savedOrder,
      message: orderStatus === 'NEW' 
        ? `Заказ ${orderNumber} успешно оформлен!` 
        : `Черновик ${orderNumber} сохранен.`
    };
  }

  /**
   * PUT: Updates an existing DRAFT or NEW order (editing items).
   */
  static async updateOrder(session: JWTPayload, data: { orderId: string; items: any[]; status: string }, req?: NextRequest) {
    const totalStart = performance.now();
    const { orderId, items, status } = data;
    const orderStatus = status === 'NEW' ? 'NEW' : 'DRAFT';

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
    const canViewAll = hasPermission(session, 'orders:view_all');
    if (!canViewAll) {
      if (existingOrder.companyId && session.companyId && existingOrder.companyId !== session.companyId) {
        throw new Error('Нет доступа к заказам другой компании.');
      }
      if (!existingOrder.companyId && existingOrder.customerId !== session.userId) {
        throw new Error('Нет доступа к этому заказу.');
      }
      if (existingOrder.status !== 'DRAFT') {
        throw new Error('Клиент может редактировать только черновики.');
      }
    } else {
      if (existingOrder.status !== 'DRAFT' && existingOrder.status !== 'NEW') {
        throw new Error('Заказ можно редактировать только в статусе DRAFT или NEW.');
      }
      if (existingOrder.status === 'NEW') {
        const isOwner = existingOrder.customerId === session.userId || existingOrder.createdByUserId === session.userId;
        const isSameCompany = Boolean(session.companyId && existingOrder.companyId && session.companyId === existingOrder.companyId);
        const isSuper = session.role === 'ADMIN' || session.roleName === 'Суперадминистратор' || session.permissions?.includes('*');
        if (!isSuper && !isOwner && !isSameCompany && !hasPermission(session, 'orders:validation:view')) {
          throw new Error('Доступ запрещен (заказ ожидает валидации).');
        }
      }
    }

    // 2. Prevent edit if order is locked in assembly, shipped, completed or cancelled
    if (['ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'].includes(existingOrder.status)) {
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
    const isManualPricing = items.some(i => i.price !== undefined);

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
        const explicitPrice = item.price !== undefined ? Math.max(0, parseFloat(item.price)) : directProduct.basePrice;
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
        const explicitPrice = item.price !== undefined ? Math.max(0, parseFloat(item.price)) : primarySku.basePrice;
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
        const explicitPrice = item.price !== undefined ? Math.max(0, parseFloat(item.price)) : product.basePrice;
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
      // Restore old stock from per-SKU allocation records
      if (existingOrder.status === 'NEW') {
        const restoreStart = performance.now();
        const oldItemSkus = await tx.orderItemSku.findMany({
          where: { orderItem: { orderId } }
        });
        const restoreMap = new Map<string, number>();
        if (oldItemSkus.length > 0) {
          for (const sku of oldItemSkus) {
            restoreMap.set(sku.productId, (restoreMap.get(sku.productId) || 0) + sku.packs);
          }
        } else {
          for (const oldItem of existingOrder.items) {
            const oldQty = oldItem.totalQuantityPacks ?? oldItem.quantityPacks ?? 0;
            if (typeof oldQty === 'number' && !isNaN(oldQty) && oldQty > 0) {
              restoreMap.set(oldItem.productId, (restoreMap.get(oldItem.productId) || 0) + oldQty);
            }
          }
        }
        await OrdersService.batchRestoreStock(tx, restoreMap);
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

        // Deduct consumable fixed-amount promotion budgets
        const promoDeductStart = performance.now();
        for (const deduction of fixedAmountDeductions) {
          await tx.promotion.update({
            where: { id: deduction.promotionId },
            data: {
              remainingAmount: { decrement: deduction.amount },
              consumedAmount: { increment: deduction.amount }
            }
          });
        }
        promoDeductionMs = Math.round(performance.now() - promoDeductStart);
      }

      const deleteItemsStart = performance.now();
      await tx.orderItem.deleteMany({ where: { orderId } });
      orderDeleteItemsMs = Math.round(performance.now() - deleteItemsStart);

      const createdAtUpdate = (orderStatus === 'DRAFT' || (existingOrder.status === 'DRAFT' && orderStatus === 'NEW')) ? now : existingOrder.createdAt;

      const orderUpdateStart = performance.now();
      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: orderStatus,
          totalPacks,
          totalBlocks,
          totalCases,
          totalPrice,
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
    data: { orderId: string; status: string; reason?: string },
    req?: NextRequest
  ) {
    const { orderId, status, reason } = data;
    const VALID_STATUSES = ['NEW', 'ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'];

    if (!VALID_STATUSES.includes(status)) {
      const err: any = new Error('Недопустимый статус заказа.');
      err.status = 400;
      throw err;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } }
    });

    if (!order) {
      const err: any = new Error('Заказ не найден.');
      err.status = 404;
      throw err;
    }

    if (order.status === status) {
      if (status === 'CANCELLED') {
        const err: any = new Error('Заказ уже отменен.');
        err.status = 409;
        throw err;
      }
      return { order, message: 'Статус уже установлен.' };
    }

    const oldStatus = order.status;

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

    const shouldRevertStock = status === 'CANCELLED' && ['NEW', 'ACCEPTED', 'ASSEMBLY'].includes(oldStatus);

    const updatedOrder = await prisma.$transaction(async (tx) => {
      if (status === 'CANCELLED') {
        const allowedSourceStatuses = oldStatus === 'DRAFT' ? ['DRAFT'] : ['NEW', 'ACCEPTED', 'ASSEMBLY'];
        const updateResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: { in: allowedSourceStatuses }
          },
          data: {
            status: 'CANCELLED'
          }
        });

        if (updateResult.count === 0) {
          const freshOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { id: true, status: true }
          });
          if (!freshOrder) {
            const err: any = new Error('Заказ не найден.');
            err.status = 404;
            throw err;
          }
          if (freshOrder.status === 'CANCELLED') {
            const err: any = new Error('Заказ уже отменен.');
            err.status = 409;
            throw err;
          }
          if (freshOrder.status === 'SHIPPED' || freshOrder.status === 'COMPLETED') {
            const err: any = new Error(`Нельзя отменить исполненный заказ в статусе "${freshOrder.status}".`);
            err.status = 409;
            throw err;
          }
          const err: any = new Error(`Нельзя отменить заказ в статусе "${freshOrder.status}".`);
          err.status = 400;
          throw err;
        }

        // Only the atomic winner executes stock & promotion reversal
        if (shouldRevertStock) {
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
            for (const item of order.items) {
              const qty = item.totalQuantityPacks ?? item.quantityPacks ?? 0;
              if (typeof qty !== 'number' || isNaN(qty) || qty <= 0) continue;
              restoreMap.set(item.productId, (restoreMap.get(item.productId) || 0) + qty);
            }
          }
          await OrdersService.batchRestoreStock(tx, restoreMap);

          // Restore consumable fixed amount budgets if any fixed-amount promotions were applied
          const promoIds = Array.from(new Set(order.items.map(i => i.promotionId).filter(Boolean)));
          if (promoIds.length > 0) {
            const fixedPromos = await tx.promotion.findMany({
              where: { id: { in: promoIds as string[] }, type: 'ORDER_FIXED_AMOUNT' }
            });
            for (const promo of fixedPromos) {
              const promoDiscount = order.items
                .filter(i => i.promotionId === promo.id)
                .reduce((sum, i) => sum + (i.promotionDiscount || 0), 0);
              if (promoDiscount > 0) {
                await tx.promotion.update({
                  where: { id: promo.id },
                  data: {
                    remainingAmount: { increment: promoDiscount },
                    consumedAmount: { decrement: promoDiscount }
                  }
                });
              }
            }
          }
        }

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
              orderId: order.id,
              orderNumber: order.orderNumber,
              cancelledBy: session.name || session.email || session.userId,
              cancelledByUserId: session.userId,
              previousStatus: oldStatus,
              totalPacks: order.totalPacks,
              totalPrice: order.totalPrice,
              itemCount: order.items.length,
              reason: reason || 'Отмена заказа пользователем',
              stockReverted: shouldRevertStock
            }),
            oldValue: oldStatus,
            newValue: 'CANCELLED'
          }
        });

        return await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: {
            customer: { select: { name: true, email: true } },
            items: { include: { product: true } }
          }
        });
      }

      // If reverting from CANCELLED status (should be blocked by lifecycle validation anyway, but keeping stock safe)
      if (oldStatus === 'CANCELLED' && status !== 'CANCELLED' && status !== 'DRAFT') {
        for (const item of order.items) {
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
    });

    if (status !== 'CANCELLED') {
      await AuditService.log({
        userId: session.userId,
        action: 'CHANGE_ORDER_STATUS',
        details: `Пользователь (${session.role}) изменил статус заказа ${order.orderNumber} с ${oldStatus} на ${status}`,
        oldValue: oldStatus,
        newValue: status,
        req
      });
    }

    return {
      order: updatedOrder,
      message: status === 'CANCELLED'
        ? `Заказ ${order.orderNumber} успешно отменен.`
        : `Статус заказа ${order.orderNumber} изменен на "${status}"`
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
            price: vi.originalPrice ?? vi.price ?? 0,
            effectivePrice: vi.effectivePrice ?? vi.originalPrice ?? vi.price ?? 0,
            itemTotalPrice: lineTotalPrice,
            isBonus: vi.isBonus ?? false,
            promotionNote: vi.promotionNote ?? null
          });
        }
      } else {
        excelItems.push({
          sku: vi.sku || vi.skuSnapshot || '',
          name: vi.groupDisplayName || vi.name || vi.productNameSnapshot || '',
          packs: vi.totalQuantityPacks ?? vi.totalPacks ?? vi.quantityPacks ?? 0,
          blocks: vi.totalQuantityBlocks ?? vi.totalBlocks ?? vi.quantityBlocks ?? 0,
          cases: vi.totalQuantityCases ?? vi.totalCases ?? vi.quantityCases ?? 0,
          baseQuantityPacks: vi.baseQuantityPacks ?? 0,
          bonusQuantityPacks: vi.bonusQuantityPacks ?? 0,
          totalQuantityPacks: vi.totalQuantityPacks ?? vi.totalPacks ?? vi.quantityPacks ?? 0,
          baseQuantityBlocks: vi.baseQuantityBlocks ?? 0,
          bonusQuantityBlocks: vi.bonusQuantityBlocks ?? 0,
          totalQuantityBlocks: vi.totalQuantityBlocks ?? vi.totalBlocks ?? vi.quantityBlocks ?? 0,
          price: vi.originalPrice ?? vi.price ?? 0,
          effectivePrice: vi.effectivePrice ?? vi.originalPrice ?? vi.price ?? 0,
          itemTotalPrice: vi.itemTotalPrice ?? 0,
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
