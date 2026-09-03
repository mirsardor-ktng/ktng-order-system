import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requirePermission(req, ['companies:read', 'companies:manage', 'orders:view_all']);

    const { id } = params;
    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        users: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true, 
            roleTemplateId: true,
            roleTemplate: { select: { name: true } },
            isActive: true 
          }
        },
        orders: {
          include: {
            createdBy: {
              select: { name: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!company) {
      return NextResponse.json({ error: 'Компания не найдена.' }, { status: 404 });
    }

    return NextResponse.json(company);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requirePermission(req, 'companies:manage');

    const { id } = params;
    const { name, inn, purchasePlanCases, monthlyTargetCases } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Название компании обязательно.' }, { status: 400 });
    }

    const company = await prisma.company.findUnique({
      where: { id }
    });

    if (!company) {
      return NextResponse.json({ error: 'Компания не найдена.' }, { status: 404 });
    }

    const updatedCompany = await prisma.company.update({
      where: { id },
      data: {
        name: name.trim(),
        inn: inn ? inn.trim() : null,
        purchasePlanCases: purchasePlanCases ? parseFloat(purchasePlanCases) : 0,
        monthlyTargetCases: monthlyTargetCases !== undefined ? parseFloat(monthlyTargetCases) || 0 : undefined
      }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'UPDATE_COMPANY',
      details: `Пользователь ${session.email} изменил настройки компании "${company.name}"`,
      req
    });

    return NextResponse.json({ success: true, company: updatedCompany });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requirePermission(req, 'companies:manage');

    const { id } = params;
    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, orders: true }
        }
      }
    });

    if (!company) {
      return NextResponse.json({ error: 'Компания не найдена.' }, { status: 404 });
    }

    if (company._count.users > 0 || company._count.orders > 0) {
      return NextResponse.json({
        error: 'Запрещено удалять компанию, у которой есть привязанные пользователи или заказы.'
      }, { status: 400 });
    }

    await prisma.company.delete({
      where: { id }
    });

    await AuditService.log({
      userId: session.userId,
      action: 'DELETE_COMPANY',
      details: `Пользователь ${session.email} удалил компанию "${company.name}"`,
      req
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
