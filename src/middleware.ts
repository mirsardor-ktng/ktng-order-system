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

function hasPermission(payload: any, required: string[]): boolean {
  if (!payload) return false;
  if (payload.role === 'ADMIN' || payload.roleName === 'Суперадминистратор') return true;
  const perms: string[] = payload.permissions || [];
  if (perms.includes('*')) return true;
  return required.some(r => perms.includes(r));
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

  // 1. Roles & Users management
  if (pathname.startsWith('/admin/roles') || pathname.startsWith('/api/admin/roles')) {
    if (!hasPermission(payload, ['roles:manage', 'users:manage', 'users:read'])) {
      return isApiPath 
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на управление ролями).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  } else if (pathname.startsWith('/admin/users') || pathname.startsWith('/api/admin/users')) {
    if (!hasPermission(payload, ['users:read', 'users:manage'])) {
      return isApiPath 
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на просмотр пользователей).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 2. Companies
  if (pathname.startsWith('/admin/companies') || pathname.startsWith('/api/admin/companies')) {
    if (!hasPermission(payload, ['companies:read', 'companies:manage'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на управление компаниями).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 3. Promotions
  if (pathname.startsWith('/admin/promotions') || pathname.startsWith('/api/admin/promotions')) {
    if (!hasPermission(payload, ['promotions:read', 'promotions:manage'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на управление акциями).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 4. Products, Groups, Tags
  if (
    pathname.startsWith('/admin/products') || pathname.startsWith('/api/admin/products') ||
    pathname.startsWith('/admin/product-groups') || pathname.startsWith('/api/admin/product-groups') ||
    pathname.startsWith('/admin/tags') || pathname.startsWith('/api/admin/tags')
  ) {
    if (!hasPermission(payload, ['products:read', 'products:manage', 'products:stock_update', 'product_groups:manage', 'tags:manage'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на каталог товаров).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 5. Templates, Placeholders, Import
  if (
    pathname.startsWith('/admin/templates') || pathname.startsWith('/api/admin/templates') ||
    pathname.startsWith('/admin/placeholders') || pathname.startsWith('/api/admin/placeholders') ||
    pathname.startsWith('/admin/import-history') || pathname.startsWith('/api/admin/import-history')
  ) {
    if (!hasPermission(payload, ['templates:manage', 'placeholders:manage', 'import:execute'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на шаблоны и интеграции).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 6. Logs & Settings
  if (pathname.startsWith('/admin/logs') || pathname.startsWith('/api/admin/logs')) {
    if (!hasPermission(payload, ['logs:view'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на просмотр логов).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  if (pathname.startsWith('/admin/settings') || pathname.startsWith('/api/admin/gdrive') || pathname.startsWith('/api/admin/recover-files')) {
    if (!hasPermission(payload, ['settings:manage'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на системные настройки).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 7. General Admin access
  if (isAdminPath || pathname.startsWith('/api/admin')) {
    if (!hasPermission(payload, [
      'users:read', 'users:manage', 'roles:manage', 'companies:read', 'companies:manage',
      'products:read', 'products:manage', 'products:stock_update', 'product_groups:manage',
      'tags:manage', 'promotions:read', 'promotions:manage', 'analytics:view',
      'templates:manage', 'placeholders:manage', 'import:execute', 'logs:view', 'settings:manage'
    ])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ к консоли управления запрещен.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 8. Seller console
  if (isSellerPath) {
    if (!hasPermission(payload, ['orders:create', 'orders:view_all', 'orders:edit', 'products:stock_update', 'analytics:view'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права менеджера заказов).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 9. Customer portal
  if (isCustomerPath) {
    if (!hasPermission(payload, ['orders:view_own', 'orders:create', 'products:read', 'orders:view_all'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

  // 10. Analytics
  if (isAnalyticsPath || pathname.startsWith('/api/analytics')) {
    if (!hasPermission(payload, ['analytics:view', 'orders:view_all'])) {
      return isApiPath
        ? new NextResponse(JSON.stringify({ error: 'Доступ запрещен (требуются права на аналитику).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        : new NextResponse('Доступ запрещен', { status: 403 });
    }
  }

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
