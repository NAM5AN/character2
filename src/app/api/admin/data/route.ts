import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

type R = Record<string, unknown>;
function rec(value: unknown): R { return value && typeof value === 'object' && !Array.isArray(value) ? value as R : {}; }

export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const sb = getSupabaseServer();
    const [listResult, costResult] = await Promise.all([
      sb.rpc('character2_admin_list', { p_token: token }),
      sb.rpc('character2_admin_cost_rollups', { p_token: token }),
    ]);
    if (listResult.error) {
      if (listResult.error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw listResult.error;
    }

    const characters = Array.isArray(listResult.data) ? listResult.data : [];
    // Cost rollups are intentionally a separate RPC so report resets/regenerations can
    // keep accumulating usage without coupling that logic to the much larger admin-list RPC.
    // If the rollup RPC is temporarily unavailable, preserve the legacy cost fields.
    if (costResult.error || !Array.isArray(costResult.data)) {
      return NextResponse.json({ characters });
    }

    const costs = new Map<string, R>();
    for (const raw of costResult.data) {
      const row = rec(raw);
      const shareCode = typeof row.shareCode === 'string' ? row.shareCode : '';
      if (shareCode) costs.set(shareCode, row);
    }
    const merged = characters.map(raw => {
      const row = rec(raw);
      const shareCode = typeof row.shareCode === 'string' ? row.shareCode : '';
      const cost = costs.get(shareCode);
      return cost ? { ...row, ...cost } : row;
    });
    return NextResponse.json({ characters: merged });
  } catch (error) {
    return apiError(error);
  }
}
