import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requirePermission(req, ['promotions:read', 'promotions:manage']);

    const promotions = await prisma.promotion.findMany({
      include: {
        sourceProduct: {
          select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true }
        },
        bonusProduct: {
          select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true }
        },
        companies: {
          select: { id: true, name: true, code: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(promotions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requirePermission(req, 'promotions:manage');

    const body = await req.json();
    const {
      name,
      type = 'SKU_BONUS',
      bonusMode = 'SAME_SKU',
      minimumBlocks,
      bonusBlocks,
      sourceProductId,
      bonusProductId,
      discountPercent,
      allocatedAmount,
      maxOrderUsagePercent = 10.0,
      applyToAllCompanies,
      companyIds,
      startDate,
      endDate,
      isActive
    } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Название акции обязательно.' }, { status: 400 });
    }

    // Prepare data based on type
    const data: any = {
      name: name.trim(),
      type,
      applyToAllCompanies: applyToAllCompanies !== undefined ? !!applyToAllCompanies : true,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isActive: isActive !== undefined ? !!isActive : true
    };

    if (type === 'SKU_BONUS') {
      if (!sourceProductId) {
        return NextResponse.json({ error: 'Необходимо выбрать исходный товар для акции "Бонус за объем SKU".' }, { status: 400 });
      }
      data.bonusMode = bonusMode || 'SAME_SKU';
      data.minimumBlocks = minimumBlocks ? parseInt(minimumBlocks) : 50;
      data.bonusBlocks = bonusBlocks ? parseInt(bonusBlocks) : 5;
      data.sourceProductId = sourceProductId;
      data.bonusProductId = bonusMode === 'ANOTHER_SKU' ? (bonusProductId || null) : null;
    } else if (type === 'ORDER_PERCENTAGE') {
      if (!discountPercent || parseFloat(discountPercent) <= 0) {
        return NextResponse.json({ error: 'Укажите процент скидки (больше 0%).' }, { status: 400 });
      }
      data.discountPercent = parseFloat(discountPercent);
    } else if (type === 'ORDER_FIXED_AMOUNT') {
      if (!allocatedAmount || parseFloat(allocatedAmount) <= 0) {
        return NextResponse.json({ error: 'Укажите сумму выделенного бюджета.' }, { status: 400 });
      }
      data.allocatedAmount = parseFloat(allocatedAmount);
      data.remainingAmount = parseFloat(allocatedAmount);
      data.maxOrderUsagePercent = maxOrderUsagePercent ? parseFloat(maxOrderUsagePercent) : 10.0;
      data.consumedAmount = 0.0;
    }

    // Connect companies if targeted
    if (!applyToAllCompanies && companyIds && Array.isArray(companyIds) && companyIds.length > 0) {
      data.companies = {
        connect: companyIds.map((id: string) => ({ id }))
      };
    }

    const promotion = await prisma.promotion.create({
      data,
      include: {
        sourceProduct: true,
        bonusProduct: true,
        companies: true
      }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'CREATE_PROMOTION',
      details: `Пользователь ${session.email} создал акцию "${promotion.name}" (тип: ${promotion.type})`,
      req
    });

    return NextResponse.json({ success: true, promotion });
  } catch (error: any) {
    console.error('Error creating promotion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
