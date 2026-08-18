import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

// Owner-only settings for the admin console (gated by the c2_admin session cookie).
// GET returns the current 결제코드(이용코드) + Postype URL; POST updates them.

export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_get_settings', { p_token: token });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ settings: data ?? null });
  } catch (error) {
    return apiError(error);
  }
}

const schema = z.object({
  // Empty string keeps the existing code (only the Postype URL changes).
  accessCode: z.string().trim().max(64).refine(v => v === '' || v.length >= 4, {
    message: 'ACCESS_CODE_TOO_SHORT',
  }),
  postypeUrl: z.string().trim().url().or(z.literal('')),
});

export async function POST(request: Request) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const body = schema.parse(await request.json());
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_update_settings', {
      p_token: token,
      p_postype_url: body.postypeUrl,
      p_access_code: body.accessCode,
    });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ settings: data ?? null });
  } catch (error) {
    return apiError(error);
  }
}
