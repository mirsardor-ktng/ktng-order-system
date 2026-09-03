import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

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

    return NextResponse.json({ success: true, promotion: updatedPromotion });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requirePermission(req, 'promotions:manage');

    const { id } = params;
    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      return NextResponse.json({ error: 'Акция не найдена.' }, { status: 404 });
    }

    await prisma.promotion.delete({
      where: { id }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'DELETE_PROMOTION',
      details: `Пользователь ${session.email} удалил акцию "${promotion.name}"`,
      req
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
