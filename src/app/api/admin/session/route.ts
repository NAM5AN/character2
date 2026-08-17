import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { ADMIN_COOKIE_NAME, readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

// Ends the current admin session and clears the cookie.
export async function DELETE() {
  try {
    const token = await readAdminToken();
    if (token) {
      const sb = getSupabaseServer();
      await sb.rpc('character2_admin_logout', { p_token: token });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(ADMIN_COOKIE_NAME);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
