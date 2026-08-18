import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';

export const dynamic = 'force-dynamic';

// 저장된 데이터로 draft + 20답변을 복원해 돌려준다. 분석 플로우가 이걸 심어
// "사용자 시점 제출 직전" 상태로 진입시킨다(제출하면 실제 유저처럼 새 캐릭터가 생성됨).
// aiInferences의 오너 정정(ownerFeedback)은 저장 시 유실되어 복원되지 않는다(플로우 테스트용).

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

export async function POST(_request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    const token = await readAdminToken();
    if (!token) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });

    const sb = getSupabaseServer();
    const { data, error } = await sb.rpc('character2_admin_get_summary_inputs', { p_token: token, p_share_code: shareCode });
    if (error) {
      if (error.message?.includes('ADMIN_AUTH_INVALID')) return NextResponse.json({ error: 'ADMIN_AUTH_INVALID' }, { status: 401 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });

    const inputs = rec(data);
    const passport = rec(inputs.passport);
    const source = rec(inputs.source);
    const bp = rec(passport.basicProfile);

    const draft = {
      basicProfile: {
        name: str(bp.name),
        age: (bp.age ?? null) as string | number | null,
        gender: (bp.gender ?? null) as string | null,
        profileText: str(bp.profileText),
        secretProfileText: str(source.secretProfileText),
        appearanceNotes: '',
      },
      traits: (passport.traits ?? {}),
      relationshipTraits: (passport.relationshipTraits ?? {}),
      confirmedFacts: (passport.confirmedFacts ?? []),
      aiInferences: (passport.aiInferences ?? []),
      analysisConfidence: Number(inputs.analysisConfidence ?? 0),
    };

    const parsedDraft = characterDraftSchema.safeParse(draft);
    if (!parsedDraft.success) {
      return NextResponse.json({ error: 'DRAFT_RECONSTRUCT_FAILED', details: parsedDraft.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 409 });
    }
    const parsedAnswers = z.array(interviewAnswerSchema).length(20).safeParse(Array.isArray(source.answers) ? source.answers : []);
    if (!parsedAnswers.success) {
      return NextResponse.json({ error: 'ANSWERS_NOT_AVAILABLE' }, { status: 409 });
    }

    return NextResponse.json({ draft: parsedDraft.data, answers: parsedAnswers.data });
  } catch (error) {
    return apiError(error);
  }
}
