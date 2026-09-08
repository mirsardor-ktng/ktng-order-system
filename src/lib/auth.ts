import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing!');
}
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'b2b_auth_token';

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role?: string; // Legacy fallback
  roleTemplateId?: string;
  roleName?: string;
  permissions?: string[];
  defaultDashboard?: string;
  companyId?: string;
}

/**
 * Signs a JWT with the user's profile and permissions information.
 * Expires in 8 hours (standard B2B shift length).
 */
export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

/**
 * Verifies a JWT token. Returns payload or null if invalid.
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Extracts and verifies JWT from standard NextRequest cookies.
 */
export function getSession(req: NextRequest): JWTPayload | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

import prisma from './db';
import { ALL_PERMISSIONS } from './permissions';

/**
 * Checks if a session payload possesses a specific permission (or one of required permissions).
 * Superadmin (role === 'ADMIN' or possessing all/wildcard permissions) is always granted access.
 */
export function hasPermission(payload: JWTPayload | null, required: string | string[]): boolean {
  if (!payload) return false;

  // Superadmin bypass
  if (payload.role === 'ADMIN' || payload.roleName === 'Суперадминистратор') {
    return true;
  }

  const userPerms = payload.permissions || [];
  if (userPerms.includes('*')) return true;

  if (Array.isArray(required)) {
    return required.some(p => userPerms.includes(p));
  }
  return userPerms.includes(required);
}

/**
 * Resolves live effective permissions for a user from database.
 */
export async function getEffectivePermissions(userId: string): Promise<{ permissions: string[]; roleName: string; role?: string; defaultDashboard?: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { roleTemplate: true }
    });

    if (!user || !user.isActive) {
      return { permissions: [], roleName: 'Пользователь' };
    }

    const template = user.roleTemplate;
    const isSuperAdmin = template ? template.name === 'Суперадминистратор' : user.role === 'ADMIN';

    if (isSuperAdmin) {
      return {
        permissions: ALL_PERMISSIONS,
        roleName: 'Суперадминистратор',
        role: 'ADMIN',
        defaultDashboard: template?.defaultDashboard || '/admin'
      };
    }

    const roleName = template?.name || user.role || 'Пользователь';
    return {
      permissions: template?.permissions || [],
      roleName,
      role: user.role || 'CUSTOMER',
      defaultDashboard: template?.defaultDashboard || (user.role === 'SELLER' ? '/seller' : '/customer')
    };
  } catch (err) {
    console.error('Failed to get effective permissions:', err);
    return { permissions: [], roleName: 'Пользователь' };
  }
}

/**
 * Helper to enforce permission in API routes. Throws error if unauthorized.
 */
export function requirePermission(req: NextRequest, required: string | string[]): JWTPayload {
  const session = getSession(req);
  if (!session) {
    throw new Error('Необходима авторизация.');
  }

  if (!hasPermission(session, required)) {
    throw new Error('У вас недостаточно прав для выполнения этого действия.');
  }

  return session;
}

/**
 * Async version of requirePermission that validates against live DB permissions
 * if the JWT session token is stale (e.g. rights assigned without re-login).
 */
export async function requirePermissionAsync(req: NextRequest, required: string | string[]): Promise<JWTPayload> {
  const session = getSession(req);
  if (!session) {
    throw new Error('Необходима авторизация.');
  }

  if (hasPermission(session, required)) {
    return session;
  }

  // Check live DB effective permissions
  const effective = await getEffectivePermissions(session.userId);
  const updatedSession: JWTPayload = {
    ...session,
    permissions: effective.permissions,
    roleName: effective.roleName,
    role: effective.role || session.role
  };

  if (!hasPermission(updatedSession, required)) {
    throw new Error('У вас недостаточно прав для выполнения этого действия.');
  }

  return updatedSession;
}

/**
 * Returns helper to configure standard secure HTTPOnly Cookie headers.
 */
export function getCookieOptions(days: number = 1) {
  return {
    name: COOKIE_NAME,
    maxAge: 60 * 60 * 8 * days, // 8 hours * days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}
