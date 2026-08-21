import { NextResponse } from 'next/server';
import { readJsonWithinBudget } from '@/lib/request-budget';
import { z } from 'zod';
import { characterDraftSchema } from '@/lib/schemas/character';
import { askOpenAIJson } from '@/lib/ai/openai';
import { withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import {
  PERSONALITY_TAG_CATALOG,
  PERSONALITY_TAG_MAX_SELECTIONS,
  isPersonalityTagKey,
  type PersonalityTagKey,
} from '@/lib/personality-tags';

const requestSchema = z.object({ draft: characterDraftSchema });
const responseSchema = z.object({
  tags: z.array(z.string()).min(1).max(PERSONALITY_TAG_MAX_SELECTIONS),
});

function normalizeTags(value: unknown): PersonalityTagKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0, PERSONALITY_TAG_MAX_SELECTIONS);
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('personality_initial', 20, 60);
    const { draft } = requestSchema.parse(await readJsonWithinBudget(request));
    const tagGuide = PERSONALITY_TAG_CATALOG.map(tag => ({
      key: tag.key,
      label: tag.label,
      family: tag.family,
    }));

    const result = await withAiUsageContext(
      { sessionId: draft.usageSessionId, characterName: draft.basicProfile.name, stage: 'profile_personality_repair' },
      () => askOpenAIJson({
        instructions: `당신은 자캐커뮤니티 캐릭터의 프로필을 읽고 오너에게 제안할 성격 태그를 고르는 분류기입니다.
허용 목록 안에서 현재 캐릭터와 가장 가까운 태그를 1~${PERSONALITY_TAG_MAX_SELECTIONS}개 고르세요.
- 공개/비밀 프로필의 직접 설정, 반복 행동, traits, relationshipTraits, confirmedFacts, 프로필 기반 AI 추론을 함께 보세요.
- 단어 하나가 등장했다는 이유만으로 고르지 말고 여러 근거가 같은 성향을 가리키는지 확인하세요.
- 서로 반대처럼 보이는 성향도 상황이나 관계에 따라 실제로 함께 나타난다면 같이 고를 수 있습니다.
- 외관 메모, 성별, 나이만으로 성격을 판단하지 마세요.
- 허용 목록의 key만 출력하세요. 한국어 label이나 새 태그를 만들지 마세요.
- 오너가 이후 직접 수정할 최초 제안이므로 과하게 확정적으로 판단하지 마세요.
- 출력은 tags 배열만 가진 JSON 객체입니다.`,
        schema: responseSchema,
        maxOutputTokens: 450,
        input: `캐릭터 이름: ${draft.basicProfile.name}\n\n허용 성격 태그:\n${JSON.stringify(tagGuide)}\n\n공개 프로필:\n${draft.basicProfile.profileText}\n\n비밀 프로필:\n${draft.basicProfile.secretProfileText || ''}\n\n구조화 성향과 확인된 설정:\n${JSON.stringify({ traits: draft.traits, relationshipTraits: draft.relationshipTraits, confirmedFacts: draft.confirmedFacts })}\n\n프로필 기반 AI 추론:\n${JSON.stringify(draft.aiInferences.map(item => item.text))}`,
      }),
    );

    const tags = normalizeTags(result.tags);
    if (!tags.length) throw new Error('PERSONALITY_INITIAL_EMPTY');
    return NextResponse.json({ tags });
  } catch (error) {
    return apiError(error);
  }
}
