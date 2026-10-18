import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@googleapis/drive';
import crypto from 'crypto';
import { requirePermissionAsync } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, 'settings:manage');

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json({ error: 'OAuth variables GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing in .env' }, { status: 500 });
    }

    const oauth2Client = new auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/admin/gdrive/callback'
    );

    const state = crypto.randomBytes(32).toString('base64url');
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Ensures we get a refresh token
      prompt: 'consent',      // Forces consent screen to re-issue refresh token
      state,
      scope: ['https://www.googleapis.com/auth/drive']
    });

    const response = NextResponse.redirect(url);
    response.cookies.set('gdrive_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/admin/gdrive/callback',
      maxAge: 10 * 60
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
