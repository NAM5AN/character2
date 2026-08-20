import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

// Owner-only: recent AI generation failures (rollup + recent rows) for the admin console.
// These are the drop-offs users hit mid-flow — AI_JSON_SCHEMA_FAILED, gateway credit/402,
// gateway 403, etc — logged from withAiUsageContext. Gated by the c2_admin session cookie.
export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_gen_failures', { p_token: token, p_limit: 100 });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ failures: data ?? null });
  } catch (error) {
    return apiError(error);
  }
}

const deleteSchema = z.object({
  all: z.boolean().optional().default(false),
  ids: z.array(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(100).optional().default([]),
});

// Deletes only kind='failure' rows. Retry diagnostics and inflight state are intentionally preserved.
export async function DELETE(request: Request) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const body = deleteSchema.parse(await request.json().catch(() => ({})));
    if (!body.all && body.ids.length === 0) {
      return NextResponse.json({ error: 'FAILURE_IDS_REQUIRED' }, { status: 400 });
    }

    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_delete_gen_failures', {
      p_token: token,
      p_ids: body.all ? null : body.ids,
      p_all: body.all,
    });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, deleted: Number(data || 0) });
  } catch (error) {
    return apiError(error);
  }
}
