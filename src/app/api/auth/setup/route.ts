import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';
import { encrypt } from '@/lib/security';
import { createDefaultExcelTemplateOnDisk } from '@/lib/excel';
import path from 'path';

/**
 * GET: Checks if the setup wizard is required (i.e. whether any Admin exists).
 */
export async function GET() {
  try {
    const adminCount = await prisma.user.count({
      where: { role: 'ADMIN' }
    });

    return NextResponse.json({
      setupRequired: adminCount === 0
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Runs the setup wizard, creating the very first Administrator.
 * Automatically compiles the default Excel Order sheet and uploads it.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Ensure no Admin accounts already exist
    const adminCount = await prisma.user.count({
      where: { role: 'ADMIN' }
    });

    if (adminCount > 0) {
      return NextResponse.json({ error: 'Инициализация уже была выполнена ранее.' }, { status: 400 });
    }

    const body = await req.json();
    const { name, email, password, encryptionKey } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Не все поля заполнены.' }, { status: 400 });
    }

    // 2. Hash admin password strictly with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Create administrator in DB
    const admin = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: 'ADMIN'
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
        details: `Первый запуск завершен. Создан администратор: ${email}`
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
      role: 'ADMIN'
    });

    const response = NextResponse.json({
      success: true,
      user: { id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' }
    });

    const cookieOptions = getCookieOptions(7); // Keep setup session for 7 days
    response.cookies.set(cookieOptions.name, token, cookieOptions);

    return response;
  } catch (error: any) {
    console.error('[Setup Error]', error);
    return NextResponse.json({ error: `Ошибка мастера настройки: ${error.message}` }, { status: 500 });
  }
}
