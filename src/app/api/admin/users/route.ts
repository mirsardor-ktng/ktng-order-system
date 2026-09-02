import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';
import { encrypt } from '@/lib/security';

// Helper to check for Admin role (RBAC)
async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Lists all system users (Admin only)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
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
 * POST: Registers a new user (Customer or Seller)
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { name, email, password, role, companyId } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'Не все обязательные поля заполнены.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      return NextResponse.json({ error: 'Пользователь с такой электронной почтой уже зарегистрирован.' }, { status: 400 });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        role,
        companyId: companyId || null
      }
    });

    let details = `Администратор создал пользователя: ${normalizedEmail} с ролью ${role}`;
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (company) {
        details = `Администратор добавил пользователя ${normalizedEmail} в компанию ${company.name}`;
      }
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
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { id, name, email, password, role, companyId, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Не указан ID пользователя.' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase();
    if (role) updateData.role = role;
    if (companyId !== undefined) updateData.companyId = companyId || null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    });

    // Audit logs
    let details = `Администратор обновил данные пользователя: ${updatedUser.email}`;
    if (isActive !== undefined && existingUser.isActive !== isActive) {
      details = `Администратор ${isActive ? 'активировал' : 'деактивировал'} пользователя ${updatedUser.email}`;
    } else if (role && existingUser.role !== role) {
      details = `Администратор изменил роль пользователя ${updatedUser.email} с ${existingUser.role} на ${role}`;
    }

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPDATE_USER',
        details
      }
    });

    await triggerGDriveUsersBackup();

    return NextResponse.json({ success: true, message: 'Профиль пользователя обновлен' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Deletes a user
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ error: 'ID не указан' }, { status: 400 });
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
        details: `Администратор удалил пользователя: ${deletedUser.email}`
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
