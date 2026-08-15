import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema } from '@/lib/schemas/character';
import { askOpenAIJson } from '@/lib/ai/openai';
import { PARSER_INSTRUCTIONS } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  profileText: z.string().min(20).max(50_000),
  accessCode: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await assertRateLimit('character_parse', 10, 30);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const draft = await askOpenAIJson({
      instructions: PARSER_INSTRUCTIONS,
      schema: characterDraftSchema,
      maxOutputTokens: 4000,
      input: `캐릭터 이름: ${body.name}\n\n원본 프로필:\n${body.profileText}\n\n출력 JSON 키는 basicProfile, traits, relationshipTraits, confirmedFacts, aiInferences, analysisConfidence를 정확히 사용하세요. basicProfile.profileText에는 원본 프로필 전체를 그대로 보존하세요. aiInferences 각 항목에는 id, text, confidence, ownerVerdict="unreviewed"를 넣으세요. confirmedFacts 각 항목은 {key, value, source}이며 source는 "profile" 또는 "owner_answer"만 사용하세요. traits와 relationshipTraits는 JSON 객체여야 합니다.`,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return apiError(error);
  }
}
