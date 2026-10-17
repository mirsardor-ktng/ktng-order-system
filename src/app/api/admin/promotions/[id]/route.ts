import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';
import { invalidateOrderCalculationConfig } from '@/lib/calculation/config-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requirePermission(req, ['promotions:read', 'promotions:manage']);

    const { id } = params;
    const promotion = await prisma.promotion.findUnique({
      where: { id },
      include: {
        sourceProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        bonusProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        companies: { select: { id: true, name: true, code: true } }
      }
    });

    if (!promotion) {
      return NextResponse.json({ error: 'Акция не найдена.' }, { status: 404 });
    }

    return NextResponse.json(promotion);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requirePermission(req, 'promotions:manage');

    const { id } = params;
    const body = await req.json();
    const {
      name,
      type,
      bonusMode,
      minimumBlocks,
      bonusBlocks,
      sourceProductId,
      bonusProductId,
      discountPercent,
      allocatedAmount,
      remainingAmount,
      maxOrderUsagePercent,
      applyToAllCompanies,
      companyIds,
      startDate,
      endDate,
      isActive
    } = body;

    const existingPromotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!existingPromotion) {
      return NextResponse.json({ error: 'Акция не найдена.' }, { status: 404 });
    }

    const data: any = {};
    if (name !== undefined) data.name = name.trim();
    if (type !== undefined) data.type = type;
    if (isActive !== undefined) data.isActive = !!isActive;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (applyToAllCompanies !== undefined) data.applyToAllCompanies = !!applyToAllCompanies;

    if (type === 'SKU_BONUS' || (!type && existingPromotion.type === 'SKU_BONUS')) {
      if (bonusMode !== undefined) data.bonusMode = bonusMode;
      if (minimumBlocks !== undefined) data.minimumBlocks = parseInt(minimumBlocks);
      if (bonusBlocks !== undefined) data.bonusBlocks = parseInt(bonusBlocks);
      if (sourceProductId !== undefined) data.sourceProductId = sourceProductId;
      if (bonusProductId !== undefined) data.bonusProductId = bonusProductId || null;
    } else if (type === 'ORDER_PERCENTAGE' || (!type && existingPromotion.type === 'ORDER_PERCENTAGE')) {
      if (discountPercent !== undefined) data.discountPercent = parseFloat(discountPercent);
    } else if (type === 'ORDER_FIXED_AMOUNT' || (!type && existingPromotion.type === 'ORDER_FIXED_AMOUNT')) {
      if (allocatedAmount !== undefined) data.allocatedAmount = parseFloat(allocatedAmount);
      if (remainingAmount !== undefined) data.remainingAmount = parseFloat(remainingAmount);
      if (maxOrderUsagePercent !== undefined) data.maxOrderUsagePercent = parseFloat(maxOrderUsagePercent);
    }

    if (companyIds !== undefined && Array.isArray(companyIds)) {
      data.companies = {
        set: companyIds.map((cid: string) => ({ id: cid }))
      };
    }

    const updatedPromotion = await prisma.promotion.update({
      where: { id },
      data,
      include: {
        sourceProduct: true,
        bonusProduct: true,
        companies: true
      }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'UPDATE_PROMOTION',
      details: `Пользователь ${session.email} обновил акцию "${updatedPromotion.name}"`,
      req
    });

    invalidateOrderCalculationConfig();

    return NextResponse.json({ success: true, promotion: updatedPromotion });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requirePermission(req, 'promotions:manage');

    const { id } = params;

    const deletedPromotion = await prisma.$transaction(async (tx) => {
      // 1. Exclusively lock the Promotion row to serialize against concurrent order creation
      const lockedRows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name
        FROM "Promotion"
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        const err: any = new Error('Акция не найдена.');
        err.status = 404;
        throw err;
      }

      const promotion = lockedRows[0];

      // 2. Perform reference checks inside the SAME transaction (fail-closed, no .catch(() => 0))
      // Check OrderItem references
      const linkedItemCount = await tx.orderItem.count({
        where: { promotionId: id }
      });

      // Check Order.appliedPromotions references across all supported JSON structures
      const appliedRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "Order"
        WHERE "appliedPromotions" IS NOT NULL
          AND (
            (jsonb_typeof("appliedPromotions"::jsonb) = 'array'
             AND "appliedPromotions"::jsonb @> ${JSON.stringify([{ promotionId: id }])}::jsonb)
            OR
            (jsonb_typeof("appliedPromotions"::jsonb) = 'object'
             AND "appliedPromotions"::jsonb @> ${JSON.stringify({ promotionId: id })}::jsonb)
            OR
            ("appliedPromotions"::text LIKE ${'%"promotionId":"' + id + '"%'}
             OR "appliedPromotions"::text LIKE ${'%"promotionId": "' + id + '"%'})
          )
      `;

      const linkedAppliedRows = Number(appliedRows[0]?.count || 0);
      const totalLinkedOrders = linkedItemCount + linkedAppliedRows;

      if (totalLinkedOrders > 0) {
        const err: any = new Error(
          `Невозможно удалить промо-акцию "${promotion.name}": она использована в оформленных заказах (${totalLinkedOrders} связей). Для сохранения финансовой истории и корректной сверки деактивируйте акцию (isActive: false).`
        );
        err.status = 400;
        throw err;
      }

      // 3. Physical deletion executed inside the transaction
      await tx.promotion.delete({
        where: { id }
      });

      return promotion;
    }, {
      timeout: 10000,
      maxWait: 5000
    });

    // 4. Audit log
    await AuditService.log({
      userId: session.userId,
      action: 'DELETE_PROMOTION',
      details: `Пользователь ${session.email} удалил акцию "${deletedPromotion.name}"`,
      req
    });

    // 5. Invalidate calculation cache ONLY after the transaction successfully commits
    invalidateOrderCalculationConfig();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const statusCode = error.status || (
      error.message?.includes('не найдена') ? 404 :
      error.message?.includes('Невозможно удалить') ? 400 :
      error.message?.includes('прав') ? 403 : 500
    );
    console.error('[Admin Promotion DELETE Error]', error);
    const message = statusCode === 500
      ? 'Не удалось удалить промо-акцию из-за внутренней ошибки сервера.'
      : error.message;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
