import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { apiError } from '@/lib/http';
import { readAdminToken } from '@/lib/admin-session';
import { characterEvidencePackSchema, type InterviewAnswer } from '@/lib/schemas/character';
import { generateSummaryReport, type SummarySource, type SummaryReview } from '@/app/api/characters/finalize/route';

export const dynamic = 'force-dynamic';

// 저장된 데이터(passport + private source)로 현재 프롬프트를 써서 요약만 다시 생성한다 (테스트용).
// 상세 리포트는 seed가 바뀌므로 함께 초기화되어, 이후 오너가 다시 열면 상세도 새로 생성된다.

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
    const name = str(bp.name);
    const answers = Array.isArray(source.answers) ? source.answers as InterviewAnswer[] : [];
    if (answers.length < 1) return NextResponse.json({ error: 'SOURCE_NOT_AVAILABLE' }, { status: 409 });
    const review = (rec(source.ownerReview) as unknown) as SummaryReview;
    const secretProfileText = str(source.secretProfileText);

    const src: SummarySource = {
      name,
      basicProfile: { profileText: str(bp.profileText), secretProfileText, appearanceNotes: '' },
      answers,
      review,
      analysisDraft: {
        basicProfile: { name, age: bp.age ?? null, gender: bp.gender ?? null, profileText: str(bp.profileText), secretProfileText },
        traits: source.traits ?? passport.traits ?? {},
        relationshipTraits: source.relationshipTraits ?? passport.relationshipTraits ?? {},
        confirmedFacts: source.confirmedFacts ?? passport.confirmedFacts ?? [],
        analysisConfidence: inputs.analysisConfidence ?? null,
      },
    };

    const startedAt = Date.now();
    const summaryResult = await generateSummaryReport(src, { shareCode });
    characterEvidencePackSchema.parse(summaryResult.evidencePack);
    const summaryMs = Date.now() - startedAt;

    // 패스포트 analysis는 생성 시(finalize)와 동일한 형태로 저장한다.
    const analysis = {
      oneLineSummary: summaryResult.oneLineSummary,
      summary: summaryResult.summary,
      outerSelf: '', innerSelf: '', coreValues: [], desires: [], fears: [],
      conflictStyle: '', affectionStyle: '', misunderstoodPoints: [], contradictions: [], interestingPoints: [],
    };
    const detailSeed = {
      version: 'detail-seed/2.0',
      name,
      oneLineSummary: summaryResult.oneLineSummary,
      summary: summaryResult.summary,
      evidencePack: summaryResult.evidencePack,
    };

    const { data: saved, error: saveError } = await sb.rpc('character2_admin_save_summary', {
      p_token: token, p_share_code: shareCode, p_analysis: analysis, p_detail_seed: detailSeed, p_summary_ms: summaryMs,
    });
    if (saveError) throw saveError;
    if (saved !== true) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });

    return NextResponse.json({ ok: true, oneLineSummary: summaryResult.oneLineSummary });
  } catch (error) {
    return apiError(error);
  }
}
