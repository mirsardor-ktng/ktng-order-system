import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { hasPermission, requireAuthAsync, requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { uploadFile, downloadFile, findFileInFolder } from '@/lib/gdrive';
import { encrypt, decrypt } from '@/lib/security';

/**
 * GET: Retrieves the current Google Drive connection details, sync status, and backup metrics.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthAsync(req);
    const canManageSettings = hasPermission(session, 'settings:manage');
    const canViewDashboardMetrics = hasPermission(session, ['users:read', 'users:manage']);
    if (!canManageSettings && !canViewDashboardMetrics) {
      return NextResponse.json({ error: 'У вас недостаточно прав для выполнения этого действия.' }, { status: 403 });
    }
    
    // Fetch relevant settings
    const settings = await prisma.systemSetting.findMany({});
    const syncSetting = settings.find(s => s.key === 'GDRIVE_SYNC_ENABLED');
    const syncEnabled = syncSetting
      ? syncSetting.value === 'true'
      : process.env.GDRIVE_SYNC_ENABLED === 'true';
    const isAuthorized = !!settings.find(s => s.key === 'GDRIVE_REFRESH_TOKEN')?.value;
    const folderId = settings.find(s => s.key === 'GDRIVE_FOLDER_ID')?.value || process.env.GDRIVE_FOLDER_ID || '';

    const userCount = await prisma.user.count();
    const orderCount = await prisma.order.count();
    const templateCount = await prisma.template.count();

    const response = {
      syncEnabled,
      isAuthorized,
      syncConnected: syncEnabled && isAuthorized,
      metrics: {
        totalUsers: userCount,
        totalOrders: orderCount,
        totalTemplates: templateCount
      }
    };

    // Dashboard viewers may see connection state and aggregate counts, but
    // integration configuration remains limited to settings managers.
    return NextResponse.json(canManageSettings ? {
      ...response,
      folderId,
      backupEncryptionConfigured: Boolean(process.env.BACKUP_ENCRYPTION_KEY)
    } : response);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * POST: Handles settings modifications and manual backup/restore triggers.
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requirePermissionAsync(req, 'settings:manage');
    const body = await req.json();
    const { action, syncEnabled, folderId } = body;

    // 1. UPDATE SETTINGS
    if (action === 'save_settings') {
      const updates = [
        { key: 'GDRIVE_SYNC_ENABLED', value: syncEnabled ? 'true' : 'false' },
        { key: 'GDRIVE_FOLDER_ID', value: folderId || '' },
      ];

      for (const item of updates) {
        await prisma.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value },
          create: { key: item.key, value: item.value }
        });
      }
      // Keep the legacy key until older backups have been migrated and restore-tested.
      // It is never returned by this API or used for new backups.

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
      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true, passwordHash: true, role: true, roleTemplateId: true, roleTemplate: { select: { name: true } }, createdAt: true }
      });
      const pass = process.env.BACKUP_ENCRYPTION_KEY;
      if (!pass || pass.length < 32) throw new Error('BACKUP_ENCRYPTION_KEY must be configured with at least 32 characters.');

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
      const pass = process.env.BACKUP_ENCRYPTION_KEY;
      if (!pass || pass.length < 32) throw new Error('BACKUP_ENCRYPTION_KEY must be configured with at least 32 characters.');

      const fileMeta = await findFileInFolder('users.enc.json', 'Users');
      if (!fileMeta || !fileMeta.id) {
        return NextResponse.json({ error: 'Файл резервной копии "users.enc.json" не найден в хранилище.' }, { status: 404 });
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await downloadFile(fileMeta.id, fileMeta.name, 'Users');
      } catch (err: any) {
        return NextResponse.json({ error: `Ошибка загрузки резервной копии: ${err.message}` }, { status: 500 });
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
        const roleTemplateName = typeof rUser.roleTemplate?.name === 'string' ? rUser.roleTemplate.name : (rUser.role === 'ADMIN' ? 'Администратор' : null);
        const roleTemplate = roleTemplateName
          ? await prisma.roleTemplate.findUnique({ where: { name: roleTemplateName }, select: { id: true } })
          : null;
        const restoredRole = ['ADMIN', 'SELLER', 'MANAGER', 'CUSTOMER'].includes(rUser.role) ? rUser.role : 'CUSTOMER';
        await prisma.user.create({
          data: {
            email: rUser.email,
            name: rUser.name,
            passwordHash: rUser.passwordHash,
            role: roleTemplateName === 'Суперадминистратор' ? 'ADMIN' : restoredRole,
            roleTemplateId: roleTemplate?.id ?? null,
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
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    const isPermissionError = error.message?.includes('недостаточно прав') || error.message?.includes('авторизация') || error.message?.includes('Access denied');
    console.error('[GDrive Admin Error]', error);
    return NextResponse.json({ error: `Сбой операции: ${error.message}` }, { status: isPermissionError ? 403 : 500 });
  }
}
