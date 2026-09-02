import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSession(req);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'SELLER' && session.role !== 'MANAGER')) {
      return NextResponse.json({ error: 'Доступ запрещен.' }, { status: 403 });
    }

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
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ разрешен только администраторам.' }, { status: 403 });
    }

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

    const existing = await prisma.promotion.findUnique({
      where: { id },
      include: { companies: { select: { id: true } } }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Акция не найдена.' }, { status: 404 });
    }

    if (name !== undefined && (!name || !name.trim())) {
      return NextResponse.json({ error: 'Название акции обязательно.' }, { status: 400 });
    }

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (type !== undefined) updateData.type = type;
    if (bonusMode !== undefined) updateData.bonusMode = bonusMode;
    if (minimumBlocks !== undefined) updateData.minimumBlocks = parseInt(minimumBlocks);
    if (bonusBlocks !== undefined) updateData.bonusBlocks = parseInt(bonusBlocks);
    if (sourceProductId !== undefined) updateData.sourceProductId = sourceProductId;
    if (bonusProductId !== undefined) updateData.bonusProductId = bonusMode === 'ANOTHER_SKU' ? bonusProductId : null;
    if (discountPercent !== undefined) updateData.discountPercent = discountPercent !== null ? parseFloat(discountPercent) : null;
    if (allocatedAmount !== undefined) updateData.allocatedAmount = allocatedAmount !== null ? parseFloat(allocatedAmount) : null;
    if (remainingAmount !== undefined) updateData.remainingAmount = remainingAmount !== null ? parseFloat(remainingAmount) : null;
    if (maxOrderUsagePercent !== undefined) updateData.maxOrderUsagePercent = maxOrderUsagePercent !== null ? parseFloat(maxOrderUsagePercent) : 10.0;
    if (applyToAllCompanies !== undefined) updateData.applyToAllCompanies = applyToAllCompanies;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Handle company assignments
    if (companyIds !== undefined) {
      // Disconnect all existing, then connect new ones
      updateData.companies = {
        set: [], // disconnect all
        connect: companyIds.map((cid: string) => ({ id: cid }))
      };
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: updateData,
      include: {
        sourceProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        bonusProduct: { select: { id: true, sku: true, name: true, basePrice: true, imageUrl: true } },
        companies: { select: { id: true, name: true, code: true } }
      }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'UPDATE_PROMOTION',
      details: `Администратор изменил акцию "${updated.name}"`,
      req
    });

    return NextResponse.json({ success: true, promotion: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ разрешен только администраторам.' }, { status: 403 });
    }

    const { id } = params;
    const promotion = await prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      return NextResponse.json({ error: 'Акция не найдена.' }, { status: 404 });
    }

    await prisma.promotion.delete({ where: { id } });

    await AuditService.log({
      userId: session.userId,
      action: 'DELETE_PROMOTION',
      details: `Администратор удалил акцию "${promotion.name}"`,
      req
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
