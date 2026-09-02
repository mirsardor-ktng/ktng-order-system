import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'SELLER' && session.role !== 'MANAGER')) {
      return NextResponse.json({ error: 'Доступ запрещен.' }, { status: 403 });
    }

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ разрешен только администраторам.' }, { status: 403 });
    }

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

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Название акции обязательно.' }, { status: 400 });
    }

    const promoType = type as 'SKU_BONUS' | 'ORDER_PERCENTAGE' | 'ORDER_FIXED_AMOUNT';

    if (promoType === 'SKU_BONUS') {
      if (!sourceProductId) {
        return NextResponse.json({ error: 'Товар-источник обязателен для SKU акции.' }, { status: 400 });
      }
      if (bonusMode === 'ANOTHER_SKU' && !bonusProductId) {
        return NextResponse.json({ error: 'Для режима ANOTHER_SKU необходимо указать бонусный товар.' }, { status: 400 });
      }
      if (!minimumBlocks || minimumBlocks < 1) {
        return NextResponse.json({ error: 'Минимальное количество блоков должно быть >= 1.' }, { status: 400 });
      }
      if (!bonusBlocks || bonusBlocks < 1) {
        return NextResponse.json({ error: 'Количество бонусных блоков должно быть >= 1.' }, { status: 400 });
      }

      const sourceProduct = await prisma.product.findUnique({ where: { id: sourceProductId } });
      if (!sourceProduct) {
        return NextResponse.json({ error: 'Товар-источник не найден.' }, { status: 404 });
      }

      if (bonusMode === 'ANOTHER_SKU' && bonusProductId) {
        const bonusProd = await prisma.product.findUnique({ where: { id: bonusProductId } });
        if (!bonusProd) {
          return NextResponse.json({ error: 'Бонусный товар не найден.' }, { status: 404 });
        }
      }
    } else if (promoType === 'ORDER_PERCENTAGE') {
      if (!discountPercent || parseFloat(discountPercent) <= 0 || parseFloat(discountPercent) > 100) {
        return NextResponse.json({ error: 'Укажите процент скидки от 0.1% до 100%.' }, { status: 400 });
      }
    } else if (promoType === 'ORDER_FIXED_AMOUNT') {
      if (!allocatedAmount || parseFloat(allocatedAmount) <= 0) {
        return NextResponse.json({ error: 'Укажите выделенную сумму лимита скидки.' }, { status: 400 });
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        name: name.trim(),
        type: promoType,
        bonusMode: promoType === 'SKU_BONUS' ? (bonusMode || 'SAME_SKU') : 'SAME_SKU',
        minimumBlocks: promoType === 'SKU_BONUS' && minimumBlocks ? parseInt(minimumBlocks) : 0,
        bonusBlocks: promoType === 'SKU_BONUS' && bonusBlocks ? parseInt(bonusBlocks) : 0,
        sourceProductId: promoType === 'SKU_BONUS' ? sourceProductId : null,
        bonusProductId: promoType === 'SKU_BONUS' && bonusMode === 'ANOTHER_SKU' ? bonusProductId : null,
        discountPercent: promoType === 'ORDER_PERCENTAGE' ? parseFloat(discountPercent) : null,
        allocatedAmount: promoType === 'ORDER_FIXED_AMOUNT' ? parseFloat(allocatedAmount) : null,
        remainingAmount: promoType === 'ORDER_FIXED_AMOUNT' ? parseFloat(allocatedAmount) : null,
        maxOrderUsagePercent: promoType === 'ORDER_FIXED_AMOUNT' ? (parseFloat(maxOrderUsagePercent) || 10.0) : 10.0,
        consumedAmount: 0.0,
        applyToAllCompanies: applyToAllCompanies !== false,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive !== false,
        companies: !applyToAllCompanies && companyIds?.length > 0
          ? { connect: companyIds.map((id: string) => ({ id })) }
          : undefined
      },
      include: {
        sourceProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        bonusProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        companies: { select: { id: true, name: true, code: true } }
      }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'CREATE_PROMOTION',
      details: `Администратор создал акцию "${promotion.name}" (тип: ${promotion.type})`,
      req
    });

    return NextResponse.json({ success: true, promotion });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
