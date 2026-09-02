import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@googleapis/drive';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json({ error: 'OAuth variables GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing in .env' }, { status: 500 });
    }

    const oauth2Client = new auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/admin/gdrive/callback'
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Ensures we get a refresh token
      prompt: 'consent',      // Forces consent screen to re-issue refresh token
      scope: ['https://www.googleapis.com/auth/drive']
    });

    return NextResponse.redirect(url);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
