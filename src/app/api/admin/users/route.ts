import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { requirePermissionAsync, isSuperAdmin } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';
import { encrypt } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET: Lists all system users with their role template & company
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, ['users:read', 'users:manage']);

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        roleTemplateId: true,
        roleTemplate: {
          select: {
            id: true,
            name: true,
            isSystem: true,
            defaultDashboard: true,
            permissions: true
          }
        },
        companyId: true,
        isActive: true,
        company: {
          select: { id: true, name: true }
        },
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(users);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * Maps RoleTemplate name to legacy User.role.
 * Permissions and defaultDashboard must NEVER determine User.role.
 */
function getLegacyRoleFromTemplateName(templateName?: string | null): 'ADMIN' | 'SELLER' | 'MANAGER' | 'CUSTOMER' {
  switch (templateName) {
    case 'Суперадминистратор':
    case 'Администратор':
      return 'ADMIN';
    case 'Менеджер продаж':
      return 'SELLER';
    case 'Ограниченный менеджер':
      return 'MANAGER';
    default:
      return 'CUSTOMER';
  }
}

/**
 * POST: Registers a new user with role template
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requirePermissionAsync(req, 'users:manage');
    const body = await req.json();
    const { name, email, password, roleTemplateId, role, companyId } = body;

    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return NextResponse.json({ error: 'Укажите имя, email и пароль длиной от 12 до 128 символов.' }, { status: 400 });
    }
    if (role !== undefined && !['ADMIN', 'SELLER', 'MANAGER', 'CUSTOMER'].includes(role)) {
      return NextResponse.json({ error: 'Недопустимая роль.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      return NextResponse.json({ error: 'Пользователь с такой электронной почтой уже зарегистрирован.' }, { status: 400 });
    }

    // Resolve role template
    let resolvedRoleTemplateId = roleTemplateId;
    let legacyRole: 'ADMIN' | 'SELLER' | 'MANAGER' | 'CUSTOMER' = role || 'CUSTOMER';

    if (resolvedRoleTemplateId) {
      const template = await prisma.roleTemplate.findUnique({ where: { id: resolvedRoleTemplateId } });
      if (!template) return NextResponse.json({ error: 'Шаблон роли не найден.' }, { status: 400 });
      if (!isSuperAdmin(adminSession) && (template.name === 'Суперадминистратор' || template.permissions.some((permission) => !adminSession.permissions?.includes(permission)))) {
        return NextResponse.json({ error: 'Нельзя назначить права, которыми вы не обладаете.' }, { status: 403 });
      }
      legacyRole = getLegacyRoleFromTemplateName(template.name);
    } else {
      // Find matching default role template if only legacy role was provided
      let targetName = 'Клиент B2B (Заказчик)';
      if (legacyRole === 'ADMIN') targetName = 'Суперадминистратор';
      else if (legacyRole === 'SELLER') targetName = 'Менеджер продаж';
      else if (legacyRole === 'MANAGER') targetName = 'Ограниченный менеджер';

      const foundTpl = await prisma.roleTemplate.findUnique({ where: { name: targetName } });
      if (foundTpl) {
        resolvedRoleTemplateId = foundTpl.id;
        legacyRole = getLegacyRoleFromTemplateName(foundTpl.name);
      }
    }

    if (!resolvedRoleTemplateId && legacyRole === 'ADMIN') {
      return NextResponse.json({ error: 'Для назначения административных прав требуется разрешённый шаблон роли.' }, { status: 403 });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: legacyRole,
        roleTemplateId: resolvedRoleTemplateId || null,
        companyId: companyId || null
      },
      include: {
        roleTemplate: true,
        company: true
      }
    });

    const roleName = newUser.roleTemplate?.name || newUser.role;
    let details = `Создан пользователь ${normalizedEmail} с ролью "${roleName}"`;
    if (companyId && newUser.company) {
      details += ` в компании ${newUser.company.name}`;
    }

    // Write to audit logs
    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'CREATE_USER',
        details
      }
    });

    // Trigger AES encrypted backup to Google Drive
    await triggerGDriveUsersBackup();

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        roleTemplateId: newUser.roleTemplateId,
        roleTemplate: newUser.roleTemplate,
        companyId: newUser.companyId
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * PUT: Updates an existing user's details
 */
export async function PUT(req: NextRequest) {
  try {
    const adminSession = await requirePermissionAsync(req, 'users:manage');
    const body = await req.json();
    const { id, name, email, password, roleTemplateId, role, companyId, isActive } = body;

    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'Не указан ID пользователя.' }, { status: 400 });
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim()) ||
        email !== undefined && (typeof email !== 'string' || !email.trim()) ||
        password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 128) ||
        isActive !== undefined && typeof isActive !== 'boolean' ||
        role !== undefined && !['ADMIN', 'SELLER', 'MANAGER', 'CUSTOMER'].includes(role)) {
      return NextResponse.json({ error: 'Некорректные данные пользователя.' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: { roleTemplate: true }
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    const updateData: any = {};
    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (companyId !== undefined) updateData.companyId = companyId || null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

    if (roleTemplateId !== undefined) {
      updateData.roleTemplateId = roleTemplateId || null;
      if (roleTemplateId) {
        const tpl = await prisma.roleTemplate.findUnique({ where: { id: roleTemplateId } });
        if (!tpl) return NextResponse.json({ error: 'Шаблон роли не найден.' }, { status: 400 });
        if (!isSuperAdmin(adminSession) && (tpl.name === 'Суперадминистратор' || tpl.permissions.some((permission) => !adminSession.permissions?.includes(permission)))) {
          return NextResponse.json({ error: 'Нельзя назначить права, которыми вы не обладаете.' }, { status: 403 });
        }
        updateData.role = getLegacyRoleFromTemplateName(tpl.name);
      } else {
        updateData.role = 'CUSTOMER';
      }
    } else if (role) {
      if (role === 'ADMIN' && !isSuperAdmin(adminSession)) {
        return NextResponse.json({ error: 'Недостаточно прав для назначения административной роли.' }, { status: 403 });
      }
      updateData.role = role;
    }

    if (password !== undefined || roleTemplateId !== undefined || role !== undefined || companyId !== undefined || isActive !== undefined) {
      updateData.sessionVersion = { increment: 1 };
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true, roleTemplateId: true, companyId: true,
        isActive: true, createdAt: true, updatedAt: true,
        roleTemplate: { select: { id: true, name: true, isSystem: true, defaultDashboard: true, permissions: true } },
        company: { select: { id: true, name: true } }
      }
    });

    // Audit logs
    let details = `Обновлены данные пользователя: ${updatedUser.email}`;
    if (isActive !== undefined && existingUser.isActive !== isActive) {
      details = `${isActive ? 'Активирован' : 'Деактивирован'} пользователь ${updatedUser.email}`;
    } else if (roleTemplateId && existingUser.roleTemplateId !== roleTemplateId) {
      details = `Изменен шаблон роли пользователя ${updatedUser.email} на "${updatedUser.roleTemplate?.name || 'Без роли'}"`;
    }

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPDATE_USER',
        details
      }
    });

    await triggerGDriveUsersBackup();

    return NextResponse.json({ success: true, message: 'Профиль пользователя обновлен', user: updatedUser });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Deletes a user
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = await requirePermissionAsync(req, 'users:manage');
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ error: 'ID не указан.' }, { status: 400 });
    }

    // Prevent Admin from deleting themselves
    if (userId === adminSession.userId) {
      return NextResponse.json({ error: 'Вы не можете удалить свою собственную учетную запись.' }, { status: 400 });
    }

    // Block deletion of users who have orders (historical immutability)
    const orderCount = await prisma.order.count({
      where: { customerId: userId }
    });
    const createdOrdersCount = await prisma.order.count({
      where: { createdByUserId: userId }
    });

    if (orderCount > 0 || createdOrdersCount > 0) {
      return NextResponse.json({ 
        error: 'Невозможно удалить пользователя, так как он создавал или получал заказы. Разрешается только деактивировать.' 
      }, { status: 400 });
    }

    const deletedUser = await prisma.user.delete({
      where: { id: userId }
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_USER',
        details: `Удален пользователь: ${deletedUser.email}`
      }
    });

    await triggerGDriveUsersBackup();

    return NextResponse.json({ success: true, message: 'Пользователь успешно удален.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * Helper: serializes all users, encrypts with AES, and pushes to Google Drive Users backup folder.
 */
async function triggerGDriveUsersBackup() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        role: true,
        roleTemplateId: true,
        roleTemplate: {
          select: { name: true }
        },
        createdAt: true
      }
    });

    const key = process.env.BACKUP_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
      console.warn('[Backup] User backup skipped: BACKUP_ENCRYPTION_KEY is not configured.');
      return;
    }

    // AES encrypt user list JSON
    const encryptedData = encrypt(JSON.stringify(users), key);
    
    await uploadFile('users.enc.json', encryptedData, 'application/json', 'Users');
    console.log('[Backup] Encrypted user storage synced successfully.');
  } catch (err) {
    console.error('[Backup Error]', err);
  }
}
