import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session';

const querySchema = z.object({
  q: z.string().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim() || '';
    if (!token) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get('q') || '',
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || undefined,
    });

    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_admin_list_characters', {
      p_session_token: token,
      p_query: query.q,
      p_limit: query.limit,
      p_offset: query.offset,
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
