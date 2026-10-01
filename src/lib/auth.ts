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
  sessionVersion?: number;
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

  // Superadmin bypass: only Суперадминистратор or legacy ADMIN without custom template
  const isSuperAdmin = payload.roleName ? payload.roleName === 'Суперадминистратор' : payload.role === 'ADMIN';
  if (isSuperAdmin) {
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

export class SessionExpiredError extends Error {
  code = 'SESSION_EXPIRED_ANOTHER_DEVICE';
  constructor(message = 'Ваша сессия завершена, так как в этот аккаунт был выполнен вход с другого устройства.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

// In-memory cache for fast sessionVersion lookup with 5s TTL
const sessionVersionCache = new Map<string, { version: number; cachedAt: number }>();

export function updateCachedSessionVersion(userId: string, version: number) {
  sessionVersionCache.set(userId, { version, cachedAt: Date.now() });
}

export function invalidateCachedSessionVersion(userId: string) {
  sessionVersionCache.delete(userId);
}

export async function getUserSessionVersion(userId: string): Promise<number | null> {
  const now = Date.now();
  const cached = sessionVersionCache.get(userId);
  if (cached && (now - cached.cachedAt < 5000)) {
    return cached.version;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true }
  });

  if (!user) return null;
  sessionVersionCache.set(userId, { version: user.sessionVersion, cachedAt: now });
  return user.sessionVersion;
}

export async function validateSessionVersion(session: JWTPayload | null): Promise<boolean> {
  if (!session || !session.userId) return false;
  if (session.sessionVersion === undefined) return false;

  const currentVersion = await getUserSessionVersion(session.userId);
  if (currentVersion === null) return false;
  return currentVersion === session.sessionVersion;
}

export async function getSessionAsync(req: NextRequest): Promise<JWTPayload | null> {
  const session = getSession(req);
  if (!session) return null;
  const isValid = await validateSessionVersion(session);
  if (!isValid) return null;
  return session;
}

/**
 * Async helper to require authenticated session in API routes with session version validation.
 * Throws SessionExpiredError if signed in on another device.
 */
export async function requireAuthAsync(req: NextRequest): Promise<JWTPayload> {
  const session = getSession(req);
  if (!session) {
    throw new Error('Необходима авторизация.');
  }

  const isValid = await validateSessionVersion(session);
  if (!isValid) {
    throw new SessionExpiredError();
  }

  return session;
}

/**
 * Helper to require authenticated session in API routes. Throws error if not logged in.
 */
export function requireAuth(req: NextRequest): JWTPayload {
  const session = getSession(req);
  if (!session) {
    throw new Error('Необходима авторизация.');
  }
  return session;
}

/**
 * Helper to enforce permission in API routes. Throws error if unauthorized.
 */
export function requirePermission(req: NextRequest, required: string | string[]): JWTPayload {
  const session = requireAuth(req);

  if (!hasPermission(session, required)) {
    throw new Error('У вас недостаточно прав для выполнения этого действия.');
  }

  return session;
}

/**
 * Async version of requirePermission that validates against live DB permissions
 * and verifies active sessionVersion against other device logins.
 */
export async function requirePermissionAsync(req: NextRequest, required: string | string[]): Promise<JWTPayload> {
  const session = await requireAuthAsync(req);

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
