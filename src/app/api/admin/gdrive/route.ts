import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { uploadFile, downloadFile } from '@/lib/gdrive';
import { encrypt, decrypt } from '@/lib/security';

async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Retrieves the current Google Drive connection details, sync status, and backup metrics.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    
    // Fetch relevant settings
    const settings = await prisma.systemSetting.findMany({});
    const syncEnabled = settings.find(s => s.key === 'GDRIVE_SYNC_ENABLED')?.value === 'true';
    const isAuthorized = !!settings.find(s => s.key === 'GDRIVE_REFRESH_TOKEN')?.value;
    const folderId = settings.find(s => s.key === 'GDRIVE_FOLDER_ID')?.value || '';
    const encryptionKey = settings.find(s => s.key === 'BACKUP_ENCRYPTION_KEY')?.value || 'B2BSecureSystemPassphrase2026';

    const userCount = await prisma.user.count();
    const orderCount = await prisma.order.count();
    const templateCount = await prisma.template.count();

    return NextResponse.json({
      syncEnabled,
      isAuthorized,
      folderId,
      encryptionKey,
      metrics: {
        totalUsers: userCount,
        totalOrders: orderCount,
        totalTemplates: templateCount
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * POST: Handles settings modifications and manual backup/restore triggers.
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { action, syncEnabled, folderId, encryptionKey } = body;

    // 1. UPDATE SETTINGS
    if (action === 'save_settings') {
      const updates = [
        { key: 'GDRIVE_SYNC_ENABLED', value: syncEnabled ? 'true' : 'false' },
        { key: 'GDRIVE_FOLDER_ID', value: folderId || '' },
        { key: 'BACKUP_ENCRYPTION_KEY', value: encryptionKey || 'B2BSecureSystemPassphrase2026' }
      ];

      for (const item of updates) {
        await prisma.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value },
          create: { key: item.key, value: item.value }
        });
      }

      // Sync Node process env with DB settings
      process.env.GDRIVE_SYNC_ENABLED = syncEnabled ? 'true' : 'false';
      process.env.GDRIVE_FOLDER_ID = folderId || '';

      await prisma.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: 'UPDATE_GDRIVE_SETTINGS',
          details: `Администратор обновил параметры синхронизации Google Drive. Активна=${syncEnabled}`
        }
      });

      return NextResponse.json({ success: true, message: 'Параметры интеграции успешно сохранены!' });
    }

    // 2. TRIGGER MANUAL ENCRYPTED USER DATABASE BACKUP
    if (action === 'backup_users') {
      const users = await prisma.user.findMany({});
      const keySetting = await prisma.systemSetting.findUnique({ where: { key: 'BACKUP_ENCRYPTION_KEY' } });
      const pass = keySetting?.value || 'B2BSecureSystemPassphrase2026';

      // Encrypt user list with AES
      const encryptedJSON = encrypt(JSON.stringify(users), pass);
      const res = await uploadFile('users.enc.json', encryptedJSON, 'application/json', 'Users');

      await prisma.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: 'BACKUP_USERS_MANUAL',
          details: `Администратор запустил резервное копирование пользователей. ${res.message}`
        }
      });

      return NextResponse.json({
        success: true,
        message: `Резервная копия (${users.length} пользователей) зашифрована по стандарту AES-256 и выгружена. ${res.message}`
      });
    }

    // 3. TRIGGER RESTORE USERS FROM CLOUD BACKUP
    if (action === 'restore_users') {
      const keySetting = await prisma.systemSetting.findUnique({ where: { key: 'BACKUP_ENCRYPTION_KEY' } });
      const pass = keySetting?.value || 'B2BSecureSystemPassphrase2026';

      let fileBuffer: Buffer;
      try {
        fileBuffer = await downloadFile('users.enc.json', 'users.enc.json', 'Users');
      } catch (err) {
        return NextResponse.json({ error: 'Файл резервной копии "users.enc.json" не найден в хранилище.' }, { status: 404 });
      }

      const encryptedText = fileBuffer.toString('utf8');
      
      // Decrypt AES users package
      const decryptedJSON = decrypt(encryptedText, pass);
      const restoredUsers = JSON.parse(decryptedJSON);

      if (!Array.isArray(restoredUsers)) {
        throw new Error('Некорректный формат файла резервной копии.');
      }

      let restoredCount = 0;
      let skippedCount = 0;

      for (const rUser of restoredUsers) {
        const exists = await prisma.user.findUnique({ where: { email: rUser.email } });
        if (exists) {
          skippedCount++;
          continue;
        }

        // Restore user safely
        await prisma.user.create({
          data: {
            id: rUser.id,
            email: rUser.email,
            name: rUser.name,
            passwordHash: rUser.passwordHash,
            role: rUser.role,
            createdAt: new Date(rUser.createdAt)
          }
        });
        restoredCount++;
      }

      await prisma.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: 'RESTORE_USERS_MANUAL',
          details: `Администратор выполнил восстановление пользователей из бэкапа. Восстановлено: ${restoredCount}, пропущено существующих: ${skippedCount}`
        }
      });

      return NextResponse.json({
        success: true,
        message: `Процесс восстановления завершен. Успешно импортировано: ${restoredCount} новых записей, сохранено без изменений: ${skippedCount}.`
      });
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  } catch (error: any) {
    console.error('[GDrive Admin Error]', error);
    return NextResponse.json({ error: `Сбой операции: ${error.message}` }, { status: 500 });
  }
}
