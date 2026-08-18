import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import { DETAIL_REPORT_VERSION, buildDetailDossier } from '@/lib/ai/detail-report';
import { CHARACTER_DEEP_ANALYSIS_SKILL_VERSION } from '@/lib/ai/character-deep-analysis-skill';
import { withAiUsageContext } from '@/lib/ai/usage';

// 결제 전에 심리모델→dossier를 미리 계산해 stash한다. 오너(editToken)만 호출 가능.
// 클라이언트는 이용코드 모달을 열 때 fire-and-forget으로 호출하고 결과를 기다리지 않는다.
// 결제 직후 stage 1은 이 dossier를 재사용해 무거운 심리모델 호출을 건너뛴다.

export const dynamic = 'force-dynamic';

const PRECOMPUTE_FRESH_MS = 24 * 60 * 60 * 1000; // 하루 안에 계산된 게 있으면 다시 안 돌린다.
const versionTag = () => `${DETAIL_REPORT_VERSION}|${CHARACTER_DEEP_ANALYSIS_SKILL_VERSION}`;

const bodySchema = z.object({ editToken: z.string().min(16) });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    await assertRateLimit('character_detail_precompute', 12, 60);
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const body = bodySchema.parse(await request.json());

    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_get_owner_detail_inputs', {
      p_share_code: shareCode,
      p_edit_token: body.editToken,
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'DETAIL_ACCESS_DENIED' }, { status: 403 });

    const inputs = record(data);
    if (!inputs.seed) return NextResponse.json({ error: 'DETAIL_SOURCE_NOT_AVAILABLE' }, { status: 409 });

    // 이미 최근에(그리고 같은 버전으로는 stage 1에서 판정) 계산돼 있으면 다시 돌리지 않는다.
    const precomputedAt = typeof inputs.precomputedAt === 'string' ? Date.parse(inputs.precomputedAt) : NaN;
    if (Number.isFinite(precomputedAt) && Date.now() - precomputedAt < PRECOMPUTE_FRESH_MS) {
      return NextResponse.json({ ok: true, cached: true });
    }

    const dossier = await withAiUsageContext(
      { shareCode, stage: 'detail_precompute' },
      () => buildDetailDossier(inputs.seed, typeof inputs.publicProfileText === 'string' ? inputs.publicProfileText : '', inputs.source),
    );

    const stored = { ...dossier, _v: versionTag() };
    const { error: saveError } = await sb.rpc('character2_save_precomputed_dossier', {
      p_share_code: shareCode,
      p_edit_token: body.editToken,
      p_dossier: stored,
    });
    if (saveError) throw saveError;

    return NextResponse.json({ ok: true, cached: false });
  } catch (error) {
    return apiError(error);
  }
}
