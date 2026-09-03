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
