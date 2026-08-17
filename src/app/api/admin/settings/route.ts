import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session';

const schema = z.object({
  postypeUrl: z.string().url().or(z.literal('')),
  accessCode: z.string().min(4).max(32),
});

async function sessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim() || '';
}

export async function GET() {
  try {
    const token = await sessionToken();
    if (!token) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_admin_get_settings', {
      p_session_token: token,
    });
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    return NextResponse.json(data, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const token = await sessionToken();
    if (!token) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    const body = schema.parse(await request.json());
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_admin_update_settings', {
      p_session_token: token,
      p_postype_url: body.postypeUrl,
      p_access_code: body.accessCode,
    });
    if (error) throw error;
    if (data === null || data === undefined) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    return NextResponse.json({ ok: true, codeVersion: data });
  } catch (error) {
    return apiError(error);
  }
}
