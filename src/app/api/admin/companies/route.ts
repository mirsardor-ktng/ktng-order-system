import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requirePermission(req, ['companies:read', 'companies:manage', 'orders:view_all']);

    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { users: true, orders: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json(companies);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requirePermission(req, 'companies:manage');

    const { name, inn, purchasePlanCases, monthlyTargetCases } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Название компании обязательно.' }, { status: 400 });
    }

    // Auto-generate unique code (CMP-001, CMP-002, etc.)
    const count = await prisma.company.count();
    let code = `CMP-${String(count + 1).padStart(3, '0')}`;
    let exists = await prisma.company.findUnique({ where: { code } });
    let i = 1;
    while (exists) {
      code = `CMP-${String(count + 1 + i).padStart(3, '0')}`;
      exists = await prisma.company.findUnique({ where: { code } });
      i++;
    }

    const company = await prisma.company.create({
      data: {
        name: name.trim(),
        code,
        inn: inn ? inn.trim() : null,
        purchasePlanCases: purchasePlanCases ? parseFloat(purchasePlanCases) : 0,
        monthlyTargetCases: monthlyTargetCases ? parseFloat(monthlyTargetCases) : 0
      }
    });

    // Log company creation
    await AuditService.log({
      userId: session.userId,
      action: 'CREATE_COMPANY',
      details: `Пользователь ${session.email} создал компанию "${company.name}" (код: ${company.code})`,
      req
    });

    return NextResponse.json({ success: true, company });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
