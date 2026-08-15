import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, initialCharacterDraftSchema } from '@/lib/schemas/character';
import { askOpenAIJson } from '@/lib/ai/openai';
import { PARSER_INSTRUCTIONS } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  profileText: z.string().min(20).max(50_000),
  secretProfileText: z.string().max(50_000).optional().default(''),
  accessCode: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_parse', 10, 30);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const secretSection = body.secretProfileText.trim()
      ? `\n\n비밀 프로필:\n${body.secretProfileText}`
      : '\n\n비밀 프로필: 없음';

    const aiDraft = await askOpenAIJson({
      instructions: PARSER_INSTRUCTIONS,
      schema: initialCharacterDraftSchema,
      maxOutputTokens: 3200,
      input: `캐릭터 이름: ${body.name}\n\n공개 프로필:\n${body.profileText}${secretSection}\n\n공개 프로필과 비밀 프로필을 서로 다른 정보층으로 인식해 함께 분석하세요. 둘 사이에 차이·숨겨진 동기·겉과 속의 간극이 있더라도 한쪽을 지워 합치지 마세요. 서로 충돌하는 설정은 추론에서 모순이나 조건부 패턴으로 남기세요.\n\n출력 JSON 키는 basicProfile, traits, relationshipTraits, confirmedFacts, aiInferences, analysisConfidence를 정확히 사용하세요.\n중요: basicProfile에는 name, age, gender만 넣고 profileText나 secretProfileText는 절대 출력하지 마세요. 원문은 서버가 별도로 보존합니다.\nconfirmedFacts 각 항목은 {key, value}만 사용하세요.\naiInferences 각 항목에는 id, text, confidence, ownerVerdict="unreviewed"를 넣으세요.\ntraits와 relationshipTraits는 JSON 객체여야 하며 각 값은 0~100 숫자, 문자열, boolean, null 중 하나만 사용하세요.`,
    });

    const draft = characterDraftSchema.parse({
      ...aiDraft,
      basicProfile: {
        ...aiDraft.basicProfile,
        name: body.name,
        profileText: body.profileText,
        ...(body.secretProfileText.trim() ? { secretProfileText: body.secretProfileText } : {}),
      },
      confirmedFacts: aiDraft.confirmedFacts.map(fact => ({
        ...fact,
        source: 'profile' as const,
      })),
    });

    return NextResponse.json({ draft });
  } catch (error) {
    return apiError(error);
  }
}
