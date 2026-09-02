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
  role: 'ADMIN' | 'SELLER' | 'CUSTOMER' | 'MANAGER';
  companyId?: string;
}

/**
 * Signs a JWT with the user's profile information.
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
