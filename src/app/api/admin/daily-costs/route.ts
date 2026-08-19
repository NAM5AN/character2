import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

// Owner-only: daily AI spend for the last 30 days (KST buckets), for the cost-trend
// graph in the admin console. Gated by the c2_admin session cookie.
export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_daily_costs', { p_token: token, p_days: 30 });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ costs: data ?? null });
  } catch (error) {
    return apiError(error);
  }
}
