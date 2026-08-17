import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
} from '@/lib/admin-session';

const loginSchema = z.object({
  adminSecret: z.string().min(1).max(240),
});

async function readSettings(sessionToken: string) {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase.rpc('character2_admin_get_settings', {
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return data;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim() || '';
    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const settings = await readSettings(token);
    if (!settings) {
      const response = NextResponse.json({ authenticated: false }, { status: 401 });
      response.cookies.delete(ADMIN_SESSION_COOKIE);
      return response;
    }

    return NextResponse.json(
      { authenticated: true, settings },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_admin_login', 8, 60);
    const body = loginSchema.parse(await request.json());
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_admin_create_session', {
      p_admin_secret: body.adminSecret,
      p_session_token: sessionToken,
    });
    if (error) throw error;
    if (data !== true) {
      return NextResponse.json({ error: 'ADMIN_SECRET_INVALID' }, { status: 401 });
    }

    const settings = await readSettings(sessionToken);
    const response = NextResponse.json({ authenticated: true, settings });
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      sessionToken,
      adminSessionCookieOptions(),
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim() || '';
    if (token) {
      const supabase = getSupabaseServer();
      await supabase.rpc('character2_admin_end_session', {
        p_session_token: token,
      });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(ADMIN_SESSION_COOKIE);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
