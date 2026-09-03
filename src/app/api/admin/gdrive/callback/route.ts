import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@googleapis/drive';
import { requirePermission } from '@/lib/auth';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = requirePermission(req, 'settings:manage');

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      return NextResponse.redirect(new URL('/admin/settings?gdrive_error=' + encodeURIComponent(errorParam), req.url));
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
    return NextResponse.redirect(redirectUrl);
  } catch (error: any) {
    console.error('[GDrive OAuth Error]', error);
    const redirectUrl = new URL('/admin/settings', req.url);
    redirectUrl.searchParams.set('gdrive_error', encodeURIComponent(error.message));
    return NextResponse.redirect(redirectUrl);
  }
}
