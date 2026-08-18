import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

const resetSchema = z.object({ target: z.enum(['summary', 'answers']) });

// 특정 캐릭터를 이전 상태로 되돌린다 (빠른 재테스트용).
//  target 'summary'  -> 상세 리포트만 삭제 (요약까지 남김)
//  target 'answers'  -> 요약·상세 모두 삭제 (질문응답까지)
export async function POST(request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const body = resetSchema.parse(await request.json());
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_reset_report', {
      p_token: token, p_share_code: shareCode, p_target: body.target,
    });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    if (data !== true) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_delete', { p_token: token, p_share_code: shareCode });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw error;
    }
    if (data !== true) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
