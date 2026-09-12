import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import prisma from '../db';
import { normalizePacks } from '../conversion';
import { generateExcelOrder } from '../excel';
import { storageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ProductGroupService, SkuAllocation } from '../product-groups/product-groups.service';

import { JWTPayload, hasPermission } from '../auth';

export class OrdersService {
  /**
   * GET: Retrieves order history.
   */
  static async getOrders(session: JWTPayload, options: { customerId?: string; status?: string }) {
    const { customerId, status } = options;
    const whereClause: any = {};

    if (!hasPermission(session, 'orders:view_all')) {
      if (session.companyId) {
        whereClause.companyId = session.companyId;
      } else {
        whereClause.customerId = session.userId;
      }
    } else {
      if (customerId) {
        whereClause.customerId = customerId;
      }
      // View all managers should not see DRAFT orders unless explicitly requested
      if (!status) {
        whereClause.status = { not: 'DRAFT' };
      }
    }

    if (status) {
      whereClause.status = status;
    }

    return await prisma.order.findMany({
      where: whereClause,
      include: {
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
              orderBy: { id: 'asc' }
            }
          }
        },
        comments: {
          orderBy: { createdAt: 'asc' }
        }
      },
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

    const customerStart = performance.now();
    const customer = await prisma.user.findUnique({ where: { id: session.userId } });
    const customerMs = Math.round(performance.now() - customerStart);
    if (!customer) throw new Error('Клиент не найден.');

    // Constrain product and group queries to only items in this order
    const requestedProductIds = Array.from(new Set(
      items.map(i => i.productId || i.id).filter(Boolean) as string[]
    ));
    const requestedGroupIds = Array.from(new Set(
      items.map(i => i.groupId || i.id).filter(Boolean) as string[]
    ));

    // Load only groups matching the requested IDs or containing any requested child SKU
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

    // Pre-check stock & compute SKU allocations for all items before the transaction
    const itemAllocations = new Map<string, SkuAllocation[]>(); // productId -> allocations
    if (orderStatus === 'NEW') {
      for (const vi of promoResult.items) {
        const qty = vi.totalQuantityPacks;
        if (typeof qty !== 'number' || isNaN(qty)) {
          throw new Error(`Invalid quantity for product ${vi.productId}`);
        }
        const rawItem = rawItems.find(r => r.productId === vi.productId);
        if (rawItem?.groupSkus && rawItem.groupSkus.length > 0) {
          // Multi-SKU group: allocate across SKUs by priority
          const allocs = ProductGroupService.allocatePacks(rawItem.groupSkus, qty);
          itemAllocations.set(vi.productId, allocs);
        } else {
          // Single SKU
          const product = productMap.get(vi.productId);
          if (product && qty > product.stockPacks) {
            throw new Error(`Превышен доступный лимит запасов для позиции: ${product.name}.`);
          }
          itemAllocations.set(vi.productId, [
            { productId: vi.productId, sku: vi.sku, name: vi.name, packs: qty }
          ]);
        }
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const orderNumber = `ORD-${dateStr}-${timeStr}-${Math.floor(100 + Math.random() * 900)}`;

    const validationMs = Math.round(performance.now() - totalStart);

    let orderFileUrl = null;
    let fileId = null;
    let fileName = null;
    let fileUploadMsg = '';
    let excelMs = 0;
    let storageMs = 0;

    if (orderStatus === 'NEW') {
      const uploadResult = await this.compileAndUploadExcel(orderNumber, customer.name, promoResult.items, {
        totalBlocks: promoResult.totalBlocks,
        totalCases: promoResult.totalCases,
        totalPrice: promoResult.totalPrice
      });
      orderFileUrl = uploadResult.fileUrl;
      fileId = uploadResult.fileId;
      fileName = uploadResult.fileName;
      fileUploadMsg = uploadResult.message;
      excelMs = uploadResult.excelMs || 0;
      storageMs = uploadResult.storageMs || 0;
    }

    const txStart = performance.now();
    const savedOrder = await prisma.$transaction(async (tx) => {
      if (orderStatus === 'NEW') {
        // Consolidate stock decrements per unique SKU to minimize queries and prevent race conditions
        const stockDecrements = new Map<string, number>();
        for (const [, allocs] of itemAllocations) {
          for (const alloc of allocs) {
            stockDecrements.set(alloc.productId, (stockDecrements.get(alloc.productId) || 0) + alloc.packs);
          }
        }

        // Conditional atomic update: decrement only if stockPacks >= neededPacks
        for (const [productId, neededPacks] of stockDecrements) {
          const res = await tx.product.updateMany({
            where: {
              id: productId,
              stockPacks: { gte: neededPacks }
            },
            data: {
              stockPacks: { decrement: neededPacks }
            }
          });
          if (res.count === 0) {
            const pName = productMap.get(productId)?.name || 'неизвестно';
            throw new Error(`Превышен доступный лимит запасов для позиции: ${pName}. Пожалуйста, обновите страницу и проверьте остатки.`);
          }
        }

        // Deduct consumable fixed-amount promotion budgets
        for (const deduction of promoResult.fixedAmountDeductions) {
          await tx.promotion.update({
            where: { id: deduction.promotionId },
            data: {
              remainingAmount: { decrement: deduction.amount },
              consumedAmount: { increment: deduction.amount }
            }
          });
        }
      }

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
          fileUrl: orderFileUrl,
          fileId,
          fileName,
          createdAt: now,
          updatedAt: now,
          items: {
            create: promoResult.items.map(vi => {
              const rawItem = rawItems.find(r => r.productId === vi.productId);
              return {
                productId: vi.productId,
                productNameSnapshot: vi.name,
                skuSnapshot: vi.sku,
                groupId: rawItem?.groupId || null,
                groupDisplayName: rawItem?.groupDisplayName || null,
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
        include: {
          items: { include: { product: true } }
        }
      });

      // Write per-SKU allocations in a single batch query (OrderItemSku)
      if (orderStatus === 'NEW') {
        const allSkuRows: any[] = [];
        for (const item of order.items) {
          const allocs = itemAllocations.get(item.productId);
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
      }

      return order;
    }, {
      timeout: 20000,
      maxWait: 10000
    });
    const transactionMs = Math.round(performance.now() - txStart);

    const diff = AuditService.formatItemsDiff([], promoResult.items.map(i => ({ name: i.name, quantity: i.totalQuantityPacks })));
    await AuditService.log({
      userId: customer.id,
      action: orderStatus === 'DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT_ORDER',
      details: `${orderStatus === 'DRAFT' ? 'Сохранен черновик' : 'Отправлен заказ'} ${orderNumber}. Стоимость: ${promoResult.totalPrice} UZS`,
      newValue: diff.newValue,
      req
    });

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] OrdersService.createOrder customerMs: ${customerMs}, groupsMs: ${groupsMs}, productsMs: ${productsMs}, promotionMs: ${promotionMs}, validationMs: ${validationMs}, transactionMs: ${transactionMs}, excelMs: ${excelMs}, storageMs: ${storageMs}, totalMs: ${totalMs}`);

    return {
      order: savedOrder,
      message: orderStatus === 'NEW' 
        ? `Заказ ${orderNumber} успешно оформлен! ${fileUploadMsg}` 
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
    } else {
      // Seller / Manager manual edit: preserve explicit custom prices and quantities
      for (const item of rawItems) {
        const isBonus = item.isBonus === true || item.price === 0;
        const effectivePrice = isBonus ? 0 : item.price;
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
    if (orderStatus === 'NEW') {
      const tempStockMap = new Map<string, number>();
      for (const p of dbProducts) tempStockMap.set(p.id, p.stockPacks);
      if (existingOrder.status === 'NEW') {
        for (const sku of oldItemSkus) {
          tempStockMap.set(sku.productId, (tempStockMap.get(sku.productId) ?? 0) + sku.packs);
        }
      }

      for (const vi of processedItems) {
        const qty = vi.totalQuantityPacks ?? vi.quantityPacks;
        if (vi.groupSkus && vi.groupSkus.length > 0) {
          const adjustedSkus = vi.groupSkus.map((s: any) => ({
            ...s,
            stockPacks: tempStockMap.get(s.id) ?? s.stockPacks
          }));
          const allocs = ProductGroupService.allocatePacks(adjustedSkus, qty);
          itemAllocations.set(vi.productId, allocs);
        } else {
          const available = tempStockMap.get(vi.productId) ?? 0;
          if (qty > available) {
            const name = productMap.get(vi.productId)?.name || 'неизвестно';
            throw new Error(`Превышен доступный лимит запасов для позиции: ${name}.`);
          }
          itemAllocations.set(vi.productId, [
            { productId: vi.productId, sku: vi.sku, name: vi.name, packs: qty }
          ]);
        }
      }
    }

    const validationMs = Math.round(performance.now() - totalStart);

    const now = new Date();
    let orderFileUrl = existingOrder.fileUrl;
    let fileId = existingOrder.fileId;
    let fileName = existingOrder.fileName;
    let fileUploadMsg = '';
    let excelMs = 0;
    let storageMs = 0;

    if (orderStatus === 'NEW') {
      const uploadResult = await this.compileAndUploadExcel(existingOrder.orderNumber, existingOrder.customer.name, processedItems, {
        totalBlocks,
        totalCases,
        totalPrice
      });
      orderFileUrl = uploadResult.fileUrl;
      fileId = uploadResult.fileId;
      fileName = uploadResult.fileName;
      fileUploadMsg = uploadResult.message;
      excelMs = uploadResult.excelMs || 0;
      storageMs = uploadResult.storageMs || 0;
    }

    const txStart = performance.now();
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Restore old stock from per-SKU allocation records
      if (existingOrder.status === 'NEW') {
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
        for (const [pid, ppacks] of restoreMap) {
          await tx.product.update({
            where: { id: pid },
            data: { stockPacks: { increment: ppacks } }
          });
        }
        await tx.orderItemSku.deleteMany({ where: { orderItem: { orderId } } });
      }

      if (orderStatus === 'NEW') {
        // Consolidate new stock decrements per unique SKU
        const stockDecrements = new Map<string, number>();
        for (const [, allocs] of itemAllocations) {
          for (const alloc of allocs) {
            stockDecrements.set(alloc.productId, (stockDecrements.get(alloc.productId) || 0) + alloc.packs);
          }
        }

        // Conditional atomic update: decrement only if stockPacks >= neededPacks
        for (const [productId, neededPacks] of stockDecrements) {
          const res = await tx.product.updateMany({
            where: {
              id: productId,
              stockPacks: { gte: neededPacks }
            },
            data: {
              stockPacks: { decrement: neededPacks }
            }
          });
          if (res.count === 0) {
            const pName = productMap.get(productId)?.name || 'неизвестно';
            throw new Error(`Превышен доступный лимит запасов для позиции: ${pName}. Пожалуйста, обновите страницу и проверьте остатки.`);
          }
        }

        // Deduct consumable fixed-amount promotion budgets
        for (const deduction of fixedAmountDeductions) {
          await tx.promotion.update({
            where: { id: deduction.promotionId },
            data: {
              remainingAmount: { decrement: deduction.amount },
              consumedAmount: { increment: deduction.amount }
            }
          });
        }
      }

      await tx.orderItem.deleteMany({ where: { orderId } });

      const createdAtUpdate = (orderStatus === 'DRAFT' || (existingOrder.status === 'DRAFT' && orderStatus === 'NEW')) ? now : existingOrder.createdAt;

      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: orderStatus,
          totalPacks,
          totalBlocks,
          totalCases,
          totalPrice,
          fileUrl: orderFileUrl,
          fileId,
          fileName,
          createdAt: createdAtUpdate,
          updatedAt: now,
          items: {
            create: processedItems.map(vi => {
              const rawItem = rawItems.find(r => r.productId === vi.productId);
              const totalPacks = vi.totalQuantityPacks ?? vi.quantityPacks ?? 0;
              const totalBlocks = vi.totalQuantityBlocks ?? vi.quantityBlocks ?? Math.floor(totalPacks / 10);
              const totalCases = vi.totalQuantityCases ?? vi.quantityCases ?? (Math.round((totalPacks / 500) * 100) / 100);
              const basePrice = vi.price ?? vi.originalPrice ?? 0;
              const effPrice = vi.effectivePrice ?? (vi.isBonus ? 0 : basePrice);
              const itemTotal = vi.itemTotalPrice ?? (Math.round(totalPacks * effPrice * 100) / 100);

              return {
                productId: vi.productId,
                productNameSnapshot: vi.name,
                skuSnapshot: vi.sku,
                groupId: vi.groupId || rawItem?.groupId || null,
                groupDisplayName: vi.groupDisplayName || rawItem?.groupDisplayName || null,
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
        include: { items: { include: { product: true } } }
      });

      // Write new per-SKU allocations in a single batch query
      if (orderStatus === 'NEW') {
        const allSkuRows: any[] = [];
        for (const item of order.items) {
          const allocs = itemAllocations.get(item.productId);
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
      }

      return order;
    }, {
      timeout: 20000,
      maxWait: 10000
    });
    const transactionMs = Math.round(performance.now() - txStart);

    const oldFormat = existingOrder.items.map(i => ({ name: i.productNameSnapshot || i.product?.name || 'Неизвестно', quantity: i.totalQuantityPacks ?? i.quantityPacks }));
    const newFormat = processedItems.map(i => ({ name: i.name, quantity: i.totalQuantityPacks }));
    const diff = AuditService.formatItemsDiff(oldFormat, newFormat);

    let auditDetails = `${orderStatus === 'DRAFT' ? 'Обновлён черновик' : 'Отредактирован заказ'} ${existingOrder.orderNumber}. Стоимость: ${totalPrice} UZS`;
    if (orderStatus === 'NEW' && existingOrder.createdByUserId && existingOrder.createdByUserId !== session.userId) {
      const creatorName = existingOrder.createdBy?.name || 'коллегой';
      auditDetails = `Пользователь ${session.name || session.email} отправил черновик, созданный пользователем ${creatorName}. Номер заказа: ${existingOrder.orderNumber}. Стоимость: ${totalPrice} UZS`;
    }

    await AuditService.log({
      userId: session.userId,
      action: orderStatus === 'DRAFT' ? 'UPDATE_DRAFT' : 'SUBMIT_DRAFT_ORDER',
      details: auditDetails,
      oldValue: diff.oldValue,
      newValue: diff.newValue,
      req
    });

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] OrdersService.updateOrder orderLookupMs: ${orderLookupMs}, oldItemSkusMs: ${oldItemSkusMs}, groupsMs: ${groupsMs}, productsMs: ${productsMs}, promotionMs: ${promotionMs}, validationMs: ${validationMs}, transactionMs: ${transactionMs}, excelMs: ${excelMs}, storageMs: ${storageMs}, totalMs: ${totalMs}`);

    return {
      order: updatedOrder,
      message: orderStatus === 'NEW'
        ? `Заказ ${existingOrder.orderNumber} успешно оформлен! ${fileUploadMsg}`
        : `Черновик ${existingOrder.orderNumber} обновлён.`
    };
  }

  /**
   * PUT: Changes the status of an existing order.
   */
  static async updateOrderStatus(session: JWTPayload, data: { orderId: string; status: string }, req?: NextRequest) {
    const { orderId, status } = data;
    const VALID_STATUSES = ['NEW', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'];

    if (!VALID_STATUSES.includes(status)) throw new Error('Недопустимый статус заказа.');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } }
    });

    if (!order) throw new Error('Заказ не найден.');
    if (order.status === status) return { order, message: 'Статус уже установлен.' };

    const oldStatus = order.status;

    // Lifecycle transitions validation
    // 1. CANCELLED is final terminal state
    if (oldStatus === 'CANCELLED') {
      throw new Error('Нельзя изменить статус отмененного заказа.');
    }
    // 2. Once ASSEMBLY or later, editing/cancelling might have locks, but can move to CANCELLED/SHIPPED/COMPLETED.
    // However, if moving back to NEW/DRAFT from ASSEMBLY/SHIPPED/COMPLETED - wait, the spec says "После Сборка редактирование запрещено. После Отменен редактирование запрещено."
    // Changing status is allowed (NEW -> ASSEMBLY -> SHIPPED -> COMPLETED), but CANCELLED is a terminal state.

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // If moving to CANCELLED from an active state, return stock and fixed-amount budget
      if (status === 'CANCELLED' && oldStatus !== 'CANCELLED' && oldStatus !== 'DRAFT') {
        // Prefer restoring from granular OrderItemSku records
        const oldItemSkus = await tx.orderItemSku.findMany({
          where: { orderItem: { orderId } }
        });
        if (oldItemSkus.length > 0) {
          for (const sku of oldItemSkus) {
            await tx.product.update({
              where: { id: sku.productId },
              data: { stockPacks: { increment: sku.packs } }
            });
          }
        } else {
          // Fallback for legacy orders without OrderItemSku records
          for (const item of order.items) {
            const qty = item.totalQuantityPacks ?? item.quantityPacks ?? 0;
            if (typeof qty !== 'number' || isNaN(qty)) continue;
            await tx.product.update({
              where: { id: item.productId },
              data: { stockPacks: { increment: qty } }
            });
          }
        }

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

      // If reverting from CANCELLED status (should be blocked by lifecycle validation anyway, but keeping stock safe)
      if (oldStatus === 'CANCELLED' && status !== 'CANCELLED' && status !== 'DRAFT') {
        for (const item of order.items) {
          const qty = item.totalQuantityPacks ?? item.quantityPacks ?? 0;
          if (typeof qty !== 'number' || isNaN(qty)) {
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

    await AuditService.log({
      userId: session.userId,
      action: 'CHANGE_ORDER_STATUS',
      details: `Пользователь (${session.role}) изменил статус заказа ${order.orderNumber} с ${oldStatus} на ${status}`,
      oldValue: oldStatus,
      newValue: status,
      req
    });

    return {
      order: updatedOrder,
      message: `Статус заказа ${order.orderNumber} изменен на "${status}"`
    };
  }

  private static templateBufferCache: { fileId: string; buffer: Buffer; expiresAt: number } | null = null;

  /**
   * Helper: compile Excel template and upload to storage service
   */
  private static async compileAndUploadExcel(orderNumber: string, clientName: string, validatedItems: any[], totals: { totalBlocks: number; totalCases: number; totalPrice: number }) {
    let activeTemplate = await prisma.template.findFirst({ where: { isActive: true } });
    let templateBuffer: Buffer;
    let templateFileName = 'default_order_template.xlsx';

    if (activeTemplate && !activeTemplate.isLocal && activeTemplate.fileId) {
      templateFileName = activeTemplate.name.endsWith('.xlsx') ? activeTemplate.name : `${activeTemplate.name}.xlsx`;
      const now = Date.now();
      if (this.templateBufferCache && this.templateBufferCache.fileId === activeTemplate.fileId && this.templateBufferCache.expiresAt > now) {
        templateBuffer = this.templateBufferCache.buffer;
      } else {
        templateBuffer = await storageService.downloadFile(activeTemplate.fileId, templateFileName, 'Templates');
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

    const excelStart = performance.now();
    const compiledExcelBuffer = await generateExcelOrder(templateBuffer, excelOrderData);
    const excelMs = Math.round(performance.now() - excelStart);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sanitizedClient = clientName.replace(/[^a-zA-Z0-9а-яА-Я_-]/g, '');
    const excelFileName = `${year}-${month}-${day}_${hour}-${min}_${sanitizedClient}.xlsx`;

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
      excelMs,
      storageMs
    };
  }
}
