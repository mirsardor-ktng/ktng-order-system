import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@googleapis/drive';
import { requirePermissionAsync } from '@/lib/auth';
import prisma from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermissionAsync(req, 'settings:manage');

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const returnedState = searchParams.get('state') || '';
    const expectedState = req.cookies.get('gdrive_oauth_state')?.value || '';
    const errorParam = searchParams.get('error');

    const returnedStateBuffer = Buffer.from(returnedState);
    const expectedStateBuffer = Buffer.from(expectedState);
    const validState = returnedStateBuffer.length > 0 && returnedStateBuffer.length === expectedStateBuffer.length &&
      crypto.timingSafeEqual(returnedStateBuffer, expectedStateBuffer);
    if (!validState) {
      const response = NextResponse.json({ error: 'Недействительный OAuth state.' }, { status: 400 });
      response.cookies.set('gdrive_oauth_state', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/admin/gdrive/callback', maxAge: 0 });
      return response;
    }

    if (errorParam) {
      const response = NextResponse.redirect(new URL('/admin/settings?gdrive_error=authorization_denied', req.url));
      response.cookies.set('gdrive_oauth_state', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/admin/gdrive/callback', maxAge: 0 });
      return response;
    }

    if (!code) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    const oauth2Client = new auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/admin/gdrive/callback'
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    if (tokens.refresh_token) {
      await prisma.systemSetting.upsert({
        where: { key: 'GDRIVE_REFRESH_TOKEN' },
        update: { value: tokens.refresh_token },
        create: { key: 'GDRIVE_REFRESH_TOKEN', value: tokens.refresh_token }
      });
      
      await prisma.auditLog.create({
        data: {
          userId: session.userId,
          action: 'GDRIVE_OAUTH_AUTHORIZED',
          details: `Администратор успешно авторизовал Google Drive (получен refresh_token)`
        }
      });
    }

    // Redirect back to settings page with success parameter
    const redirectUrl = new URL('/admin/settings', req.url);
    redirectUrl.searchParams.set('gdrive_success', 'true');
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('gdrive_oauth_state', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/admin/gdrive/callback', maxAge: 0 });
    return response;
  } catch (error: any) {
    console.error('[GDrive OAuth Error]', error);
    const redirectUrl = new URL('/admin/settings', req.url);
    redirectUrl.searchParams.set('gdrive_error', 'authorization_failed');
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('gdrive_oauth_state', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/admin/gdrive/callback', maxAge: 0 });
    return response;
  }
}
