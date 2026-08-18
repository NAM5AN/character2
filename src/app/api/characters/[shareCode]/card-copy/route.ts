import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import { askOpenAIJson } from '@/lib/ai/openai';
import { withAiUsageContext } from '@/lib/ai/usage';

export const dynamic = 'force-dynamic';

// 공유 카드용 짧고 장난스러운 문구를 만든다(저렴한 gpt, 캐릭터+모드별 1회 캐시).
// 근거는 이미 공개된 리포트 데이터. 톤만 밈 테스트 결과 카드처럼 바꾼다.

const bodySchema = z.object({
  mode: z.enum(['summary', 'detail']),
  refresh: z.boolean().optional().default(false),
});

const sectionSchema = z.object({ label: z.string().min(1), text: z.string().min(1).max(60) });
const cardCopySchema = z.object({
  nickname: z.string().min(2).max(24),
  tagline: z.string().min(3).max(60),
  sections: z.array(sectionSchema).min(3).max(8),
});

const INSTRUCTIONS = `당신은 자캐 심리 리포트를 '공유용 밈 테스트 결과 카드'에 들어갈 짧고 장난스러운 문구로 바꾸는 카피라이터입니다.
규칙:
- 반드시 주어진 분석 내용에 근거하세요. 없는 사실·설정·과거를 지어내지 말고, 말투와 압축만 재미있게 바꿉니다.
- 각 sections.text는 카드 한 칸에 들어갈 만큼 짧고 완결되게 쓰세요. 12~26자 권장, 최대 60자. 말줄임표(…, ...)를 절대 쓰지 마세요.
- 밈 테스트 말투를 쓰세요: "~함", "~음", "~중", 가벼운 구어체 허용. 예) "말만 하면 친구들 빵 터지게 함", "심심하면 갑자기 약속 잡음", "정 주면 끝까지 챙김".
- label 배열은 입력에서 준 순서와 글자를 그대로 유지하고, 각 label에 맞는 text만 새로 채우세요. 개수도 그대로.
- nickname: 이 캐릭터를 한 방에 표현하는 재치있는 유형 별명 (예: "관찰석의 조용한 해결사", "겉바속촉 상담사"). 8~16자 권장.
- tagline: 캐릭터를 소개하는 짧고 웃긴 한 줄.
- 캐릭터가 진지하거나 어두운 성격이면 억지 개그 대신 위트있게, 톤은 유지하되 지나치게 무겁지 않게.`;

type Field = { label: string; source: string };

function s(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\*\*(.+?)\*\*/g, '').replace(/\s+/g, ' ').trim() : '';
}

export async function POST(request: Request, context: { params: Promise<{ shareCode: string }> }) {
  try {
    await assertRateLimit('character_card_copy', 20, 60);
    const { shareCode: raw } = await context.params;
    const shareCode = normalizeShareCode(raw);
    if (!isShareCode(shareCode)) return NextResponse.json({ error: 'INVALID_SHARE_CODE' }, { status: 400 });
    const body = bodySchema.parse(await request.json());
    const sb = getSupabaseServer();

    if (!body.refresh) {
      const { data: cached } = await sb.rpc('character2_get_card_copy', { p_share_code: shareCode, p_mode: body.mode });
      if (cached) return NextResponse.json({ copy: cached, cached: true });
    }

    let name = '';
    let tagline = '';
    let fields: Field[] = [];

    if (body.mode === 'summary') {
      const { data, error } = await sb.rpc('character2_get_public_preview', { p_share_code: shareCode });
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'CHARACTER_NOT_FOUND' }, { status: 404 });
      const p = data as Record<string, unknown>;
      const sum = (p.summary || {}) as Record<string, unknown>;
      name = s(p.name);
      tagline = s(p.oneLineSummary);
      fields = [
        { label: '겉모습', source: s(sum.outerSelf) },
        { label: '속마음', source: s(sum.innerSelf) },
        { label: '관계·애정', source: s(sum.affectionStyle) },
        { label: '감정 스위치', source: s(sum.conflictStyle) },
        { label: '오해 포인트', source: s(sum.misunderstoodPoint) },
        { label: '숨은 반전', source: s(sum.hiddenPattern) },
      ].filter(f => f.source);
    } else {
      const { data: preview } = await sb.rpc('character2_get_public_preview', { p_share_code: shareCode });
      const { data, error } = await sb.rpc('character2_get_saved_detail_public', { p_share_code: shareCode });
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'DETAIL_NOT_AVAILABLE' }, { status: 404 });
      const a = ((data as Record<string, unknown>).analysis || {}) as Record<string, unknown>;
      name = s((preview as Record<string, unknown>)?.name) || s(a.name);
      tagline = s((preview as Record<string, unknown>)?.oneLineSummary);
      fields = [
        { label: '본질', source: s(a.characterOverview) },
        { label: '작동 방식', source: s(a.innerMechanics) },
        { label: '관계', source: s(a.relationshipStyle) },
        { label: '애착', source: s(a.attachmentStyle) },
        { label: '갈등', source: s(a.conflictStyleDetailed) },
        { label: '매력·반전', source: s(a.charmAndContradictions) },
      ].filter(f => f.source);
    }

    if (fields.length < 3) return NextResponse.json({ error: 'NOT_ENOUGH_SOURCE' }, { status: 409 });

    const input = `캐릭터 이름: ${name}\n한 줄 요약(참고): ${tagline}\n\n아래 각 항목의 분석을 그 label에 맞는 짧고 장난스러운 카드 문구로 바꿔주세요. label은 그대로 두고 text만 채웁니다.\n\n${fields.map((f, i) => `${i + 1}. [${f.label}] ${f.source}`).join('\n')}`;

    const copy = await withAiUsageContext(
      { shareCode, stage: `card_${body.mode}` },
      () => askOpenAIJson({ instructions: INSTRUCTIONS, input, schema: cardCopySchema, maxOutputTokens: 700 }),
    );

    try { await sb.rpc('character2_set_card_copy', { p_share_code: shareCode, p_mode: body.mode, p_copy: copy }); } catch { /* 캐시 실패는 무시 */ }
    return NextResponse.json({ copy, cached: false });
  } catch (error) {
    return apiError(error);
  }
}
