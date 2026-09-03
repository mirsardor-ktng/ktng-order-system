import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';
import { encrypt } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET: Lists all system users with their role template & company
 */
export async function GET(req: NextRequest) {
  try {
    requirePermission(req, ['users:read', 'users:manage']);

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
 * POST: Registers a new user with role template
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = requirePermission(req, 'users:manage');
    const body = await req.json();
    const { name, email, password, roleTemplateId, role, companyId } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Не все обязательные поля заполнены.' }, { status: 400 });
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
    let legacyRole = role || 'CUSTOMER';

    if (resolvedRoleTemplateId) {
      const template = await prisma.roleTemplate.findUnique({ where: { id: resolvedRoleTemplateId } });
      if (template) {
        if (template.name === 'Суперадминистратор') legacyRole = 'ADMIN';
        else if (template.name === 'Менеджер продаж') legacyRole = 'SELLER';
        else if (template.name === 'Ограниченный менеджер') legacyRole = 'MANAGER';
        else legacyRole = 'CUSTOMER';
      }
    } else {
      // Find matching default role template if only legacy role was provided
      let targetName = 'Клиент B2B (Заказчик)';
      if (legacyRole === 'ADMIN') targetName = 'Суперадминистратор';
      else if (legacyRole === 'SELLER') targetName = 'Менеджер продаж';
      else if (legacyRole === 'MANAGER') targetName = 'Ограниченный менеджер';

      const foundTpl = await prisma.roleTemplate.findUnique({ where: { name: targetName } });
      if (foundTpl) {
        resolvedRoleTemplateId = foundTpl.id;
      }
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

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
    const adminSession = requirePermission(req, 'users:manage');
    const body = await req.json();
    const { id, name, email, password, roleTemplateId, role, companyId, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Не указан ID пользователя.' }, { status: 400 });
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
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    if (roleTemplateId !== undefined) {
      updateData.roleTemplateId = roleTemplateId || null;
      if (roleTemplateId) {
        const tpl = await prisma.roleTemplate.findUnique({ where: { id: roleTemplateId } });
        if (tpl) {
          if (tpl.name === 'Суперадминистратор') updateData.role = 'ADMIN';
          else if (tpl.name === 'Менеджер продаж') updateData.role = 'SELLER';
          else if (tpl.name === 'Ограниченный менеджер') updateData.role = 'MANAGER';
          else updateData.role = 'CUSTOMER';
        }
      }
    } else if (role) {
      updateData.role = role;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { roleTemplate: true, company: true }
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
    const adminSession = requirePermission(req, 'users:manage');
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
        role: true,
        roleTemplateId: true,
        roleTemplate: {
          select: { name: true }
        },
        createdAt: true
      }
    });

    const keySetting = await prisma.systemSetting.findUnique({ where: { key: 'BACKUP_ENCRYPTION_KEY' } });
    const key = keySetting?.value || 'B2BSecureSystemPassphrase2026';
    
    // AES encrypt user list JSON
    const encryptedData = encrypt(JSON.stringify(users), key);
    
    await uploadFile('users.enc.json', encryptedData, 'application/json', 'Users');
    console.log('[Backup] Encrypted user storage synced successfully.');
  } catch (err) {
    console.error('[Backup Error]', err);
  }
}
