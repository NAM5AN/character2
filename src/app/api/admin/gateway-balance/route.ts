import { NextResponse } from 'next/server';
import { gateway } from 'ai';
import { getSupabaseServer } from '@/lib/supabase/server';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

// Owner-only: 현재 Vercel AI Gateway 크레딧 잔액을 조회한다.
// 잔액이 0이면 프로필 해석 등 모든 AI 호출이 402(insufficient_funds)로 실패하므로,
// 관리자 콘솔 상단에서 미리 확인할 수 있게 한다. (c2_admin 세션 쿠키로 게이트)
export async function GET() {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });

    // 기존 admin RPC로 토큰을 검증한다(설정 조회는 부수효과 없이 안전).
    const sb = getSupabaseServer();
    const { error: authError } = await sb.rpc('character2_admin_get_settings', { p_token: token });
    if (authError) {
      if (authError.message?.includes('ADMIN_AUTH_INVALID')) {
        return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      }
      throw authError;
    }

    // Gateway 크레딧 조회. 프로덕션은 Vercel OIDC, 로컬은 AI_GATEWAY_API_KEY로 인증된다.
    // 조회 자체가 실패해도(권한/네트워크) 콘솔 전체가 막히지 않도록 별도 상태로 반환한다.
    try {
      const credits = await gateway.getCredits();
      const balance = Number(credits.balance);
      const totalUsed = Number(credits.totalUsed);
      return NextResponse.json({
        ok: true,
        balance: Number.isFinite(balance) ? balance : null,
        totalUsed: Number.isFinite(totalUsed) ? totalUsed : null,
        fetchedAt: new Date().toISOString(),
      });
    } catch (gatewayError) {
      const message = gatewayError instanceof Error ? gatewayError.message : String(gatewayError);
      return NextResponse.json({ ok: false, error: 'GATEWAY_CREDITS_UNAVAILABLE', detail: message });
    }
  } catch (error) {
    return apiError(error);
  }
}
