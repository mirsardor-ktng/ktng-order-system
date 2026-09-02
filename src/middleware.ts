import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'b2b_auth_token';

// Edge-safe base64url decode helper
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  try {
    return atob(base64);
  } catch (e) {
    return '';
  }
}

// Edge-safe JWT verify helper using Web Crypto API
async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature using HMAC SHA-256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const data = encoder.encode(`${headerB64}.${payloadB64}`);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Convert signature from base64url to Uint8Array
    const sigStr = base64UrlDecode(signatureB64);
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      sigBytes[i] = sigStr.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      sigBytes,
      data
    );

    if (!isValid) return null;

    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr);
    
    // Expiration check
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is missing!');
    return new NextResponse(
      JSON.stringify({ error: 'Внутренняя ошибка конфигурации сервера.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { pathname } = req.nextUrl;

  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/administrator');
  const isSellerPath = pathname.startsWith('/seller');
  const isCustomerPath = pathname.startsWith('/customer');
  const isAnalyticsPath = pathname.startsWith('/analytics');
  const isApiPath = pathname.startsWith('/api');
  const isAuthApi = pathname.startsWith('/api/auth');

  // Skip auth api endpoints (login, logout, setup)
  if (isAuthApi) {
    return NextResponse.next();
  }

  const isProtected = isAdminPath || isSellerPath || isCustomerPath || isAnalyticsPath || (isApiPath && !isAuthApi);

  if (!isProtected) {
    return NextResponse.next();
  }

  // Validate token
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    if (isApiPath) {
      return new NextResponse(
        JSON.stringify({ error: 'Необходима авторизация.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const payload = await verifyJWT(token, secret);
  if (!payload) {
    if (isApiPath) {
      return new NextResponse(
        JSON.stringify({ error: 'Сессия недействительна или истекла.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // Redirect to login and clear invalid cookie
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0 });
    return response;
  }

  // Role validation (RBAC)
  const role = payload.role;

  // Protect admin endpoints / pages
  if (isAdminPath || pathname.startsWith('/api/admin')) {
    if (role !== 'ADMIN') {
      if (isApiPath) {
        return new NextResponse(
          JSON.stringify({ error: 'Доступ запрещен (требуется роль ADMIN).' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // Protect seller endpoints / pages (Seller, Manager and Admin are allowed)
  if (isSellerPath) {
    if (role !== 'SELLER' && role !== 'ADMIN' && role !== 'MANAGER') {
      if (isApiPath) {
        return new NextResponse(
          JSON.stringify({ error: 'Доступ запрещен (требуется роль SELLER или MANAGER).' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // Protect customer endpoints / pages
  if (isCustomerPath) {
    if (role !== 'CUSTOMER' && role !== 'SELLER' && role !== 'ADMIN' && role !== 'MANAGER') {
      if (isApiPath) {
        return new NextResponse(
          JSON.stringify({ error: 'Доступ запрещен (неверная роль).' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // Protect analytics endpoints / pages (any authenticated role can access, checked above)
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/administrator/:path*',
    '/seller/:path*',
    '/customer/:path*',
    '/analytics/:path*',
    '/api/:path*',
  ],
};
