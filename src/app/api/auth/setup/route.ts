import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';
import { encrypt } from '@/lib/security';
import { createDefaultExcelTemplateOnDisk } from '@/lib/excel';
import { DEFAULT_ROLE_TEMPLATES, ALL_PERMISSIONS } from '@/lib/permissions';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    return NextResponse.json({ setupRequired: userCount === 0 });
  } catch {
    return NextResponse.json({ error: 'Не удалось проверить состояние настройки.' }, { status: 500 });
  }
}

/** Creates the initial administrator exactly once. The unique setup marker is
 * created in the same transaction as the user, so concurrent requests race
 * on the database constraint rather than on a count-then-create check. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password } = body;
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return NextResponse.json({ error: 'Укажите имя, email и пароль длиной от 12 до 128 символов.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const setupResult = await prisma.$transaction(async (tx) => {
      if (await tx.user.count() > 0) throw new Error('SETUP_ALREADY_COMPLETED');

      // Unique key makes this claim atomic across concurrent server instances.
      await tx.systemSetting.create({ data: { key: 'INITIAL_SETUP_COMPLETED', value: 'true' } });

      for (const tpl of DEFAULT_ROLE_TEMPLATES) {
        await tx.roleTemplate.upsert({
          where: { name: tpl.name },
          update: {
            description: tpl.description,
            isSystem: tpl.isSystem,
            defaultDashboard: tpl.defaultDashboard,
            permissions: tpl.permissions
          },
          create: {
            name: tpl.name,
            description: tpl.description,
            isSystem: tpl.isSystem,
            defaultDashboard: tpl.defaultDashboard,
            permissions: tpl.permissions
          }
        });
      }

      const superAdminRole = await tx.roleTemplate.findUnique({ where: { name: 'Суперадминистратор' } });
      if (!superAdminRole) throw new Error('SUPERADMIN_ROLE_MISSING');

      const admin = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'ADMIN',
          roleTemplateId: superAdminRole.id
        },
        select: { id: true, email: true, name: true, roleTemplateId: true, sessionVersion: true }
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'SETUP_COMPLETED',
          details: `Первый запуск завершен. Создан суперадминистратор: ${normalizedEmail}`
        }
      });
      return { admin, superAdminRole };
    }, { isolationLevel: 'Serializable' });

    // External side effects happen after the atomic database setup.
    const templatePath = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
    try {
      await createDefaultExcelTemplateOnDisk(templatePath);
    } catch (error) {
      console.error('[Setup] Default template creation failed after setup commit.', error);
    }

    const backupKey = process.env.BACKUP_ENCRYPTION_KEY;
    if (backupKey && backupKey.length >= 32) {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true, passwordHash: true, role: true, createdAt: true }
      });
      try {
        await uploadFile('users.enc.json', encrypt(JSON.stringify(users), backupKey), 'application/json', 'Users');
      } catch (error) {
        console.error('[Setup] Initial user backup failed after setup commit.', error);
      }
    } else {
      console.warn('[Setup] Initial user backup skipped: BACKUP_ENCRYPTION_KEY is not configured.');
    }

    const { admin, superAdminRole } = setupResult;
    const token = signToken({
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'ADMIN',
      roleTemplateId: superAdminRole.id,
      roleTemplateIsSystem: true,
      roleName: 'Суперадминистратор',
      permissions: ALL_PERMISSIONS,
      defaultDashboard: '/admin',
      sessionVersion: admin.sessionVersion
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'ADMIN',
        roleTemplateId: superAdminRole.id,
        roleName: 'Суперадминистратор',
        permissions: ALL_PERMISSIONS,
        defaultDashboard: '/admin'
      }
    });
    const cookieOptions = getCookieOptions(1);
    response.cookies.set(cookieOptions.name, token, cookieOptions);
    return response;
  } catch (error: any) {
    if (error.message === 'SETUP_ALREADY_COMPLETED' || error.code === 'P2002' || error.code === 'P2034') {
      return NextResponse.json({ error: 'Инициализация уже была выполнена ранее.' }, { status: 400 });
    }
    console.error('[Setup Error]', error);
    return NextResponse.json({ error: 'Ошибка мастера настройки.' }, { status: 500 });
  }
}
