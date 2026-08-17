import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session';
import { isShareCode, normalizeShareCode } from '@/lib/share-code';

export async function GET(
  _request: Request,
  context: { params: Promise<{ shareCode: string }> },
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim() || '';
    if (!token) {
      return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
    }

    const { shareCode: rawShareCode } = await context.params;
    const shareCode = normalizeShareCode(rawShareCode);
    if (!isShareCode(shareCode)) {
      return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_admin_get_character', {
      p_session_token: token,
      p_share_code: shareCode,
    });
    if (error) throw error;
    if (!data) {
      const { data: settings } = await supabase.rpc('character2_admin_get_settings', {
        p_session_token: token,
      });
      if (!settings) {
        return NextResponse.json({ error: 'ADMIN_SESSION_INVALID' }, { status: 401 });
      }
      return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
