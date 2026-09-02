import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Lists all placeholders and system fields mappings
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const mappings = await prisma.placeholderMapping.findMany({
      orderBy: { placeholder: 'asc' }
    });
    return NextResponse.json(mappings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * PUT: Updates a placeholder's mapping details
 */
export async function PUT(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { id, placeholder, systemField, description } = body;

    if (!id) {
      return NextResponse.json({ error: 'Не указан ID маппинга' }, { status: 400 });
    }

    const updateData: any = {};
    if (placeholder) updateData.placeholder = placeholder;
    if (systemField) updateData.systemField = systemField;
    if (description !== undefined) updateData.description = description;

    const mapping = await prisma.placeholderMapping.update({
      where: { id },
      data: updateData
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPDATE_PLACEHOLDER_MAPPING',
        details: `Администратор обновил маппинг плейсхолдера ${mapping.placeholder} -> ${mapping.systemField}`
      }
    });

    return NextResponse.json({ success: true, mapping });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * POST: Creates a new custom placeholder mapping
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { placeholder, systemField, description } = body;

    if (!placeholder || !systemField) {
      return NextResponse.json({ error: 'Не указаны плейсхолдер или системное поле.' }, { status: 400 });
    }

    // Check unique placeholder name
    const exists = await prisma.placeholderMapping.findUnique({
      where: { placeholder }
    });
    if (exists) {
      return NextResponse.json({ error: 'Такой плейсхолдер уже существует.' }, { status: 400 });
    }

    const mapping = await prisma.placeholderMapping.create({
      data: {
        placeholder,
        systemField,
        description: description || ''
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'CREATE_PLACEHOLDER_MAPPING',
        details: `Администратор создал маппинг плейсхолдера ${placeholder} -> ${systemField}`
      }
    });

    return NextResponse.json({ success: true, mapping });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Deletes an existing placeholder mapping rule
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const mappingId = searchParams.get('id');

    if (!mappingId) {
      return NextResponse.json({ error: 'Не указан ID маппинга' }, { status: 400 });
    }

    const mapping = await prisma.placeholderMapping.delete({
      where: { id: mappingId }
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_PLACEHOLDER_MAPPING',
        details: `Администратор удалил маппинг плейсхолдера ${mapping.placeholder}`
      }
    });

    return NextResponse.json({ success: true, message: 'Правило маппинга успешно удалено.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
