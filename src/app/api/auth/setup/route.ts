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

/**
 * GET: Checks if the setup wizard is required (i.e. whether any Admin exists).
 */
export async function GET() {
  try {
    const userCount = await prisma.user.count();
    return NextResponse.json({
      setupRequired: userCount === 0
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Runs the setup wizard, creating default role templates and the first Superadmin.
 */
export async function POST(req: NextRequest) {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({ error: 'Инициализация уже была выполнена ранее.' }, { status: 400 });
    }

    const body = await req.json();
    const { name, email, password, encryptionKey } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Не все поля заполнены.' }, { status: 400 });
    }

    // 1. Seed all default role templates if not yet in database
    for (const tpl of DEFAULT_ROLE_TEMPLATES) {
      await prisma.roleTemplate.upsert({
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

    const superAdminRole = await prisma.roleTemplate.findUnique({
      where: { name: 'Суперадминистратор' }
    });

    // 2. Hash admin password strictly with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Create administrator in DB
    const admin = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        role: 'ADMIN',
        roleTemplateId: superAdminRole?.id || null
      },
      include: {
        roleTemplate: true
      }
    });

    // 4. Save custom AES Backup Encryption key if provided
    if (encryptionKey) {
      await prisma.systemSetting.upsert({
        where: { key: 'BACKUP_ENCRYPTION_KEY' },
        update: { value: encryptionKey },
        create: { key: 'BACKUP_ENCRYPTION_KEY', value: encryptionKey }
      });
    }

    // 5. Establish template on disk
    const templatePath = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
    await createDefaultExcelTemplateOnDisk(templatePath);

    // 6. Generate secure audit log
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'SETUP_COMPLETED',
        details: `Первый запуск завершен. Создан суперадминистратор: ${email}`
      }
    });

    // 7. Perform encrypted users backup sync
    const allUsers = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } });
    const backupKey = encryptionKey || 'B2BSecureSystemPassphrase2026';
    const encryptedUsers = encrypt(JSON.stringify(allUsers), backupKey);
    await uploadFile('users.enc.json', encryptedUsers, 'application/json', 'Users');

    // 8. Sign JWT and cook session cookie
    const token = signToken({
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'ADMIN',
      roleTemplateId: superAdminRole?.id || undefined,
      roleName: 'Суперадминистратор',
      permissions: ALL_PERMISSIONS,
      defaultDashboard: '/admin'
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'ADMIN',
        roleTemplateId: superAdminRole?.id,
        roleName: 'Суперадминистратор',
        permissions: ALL_PERMISSIONS,
        defaultDashboard: '/admin'
      }
    });

    const cookieOptions = getCookieOptions(7); // Keep setup session for 7 days
    response.cookies.set(cookieOptions.name, token, cookieOptions);

    return response;
  } catch (error: any) {
    console.error('[Setup Error]', error);
    return NextResponse.json({ error: `Ошибка мастера настройки: ${error.message}` }, { status: 500 });
  }
}
