import { z } from 'zod';
import { askOpenAIJson } from '@/lib/ai/openai';
import {
  PERSONALITY_TAG_CATALOG,
  PERSONALITY_TAG_MAX_SELECTIONS,
  isPersonalityTagKey,
  personalityTagFamily,
  personalityTagLabel,
  type PersonalityTagKey,
} from '@/lib/personality-tags';
import type { CharacterDraft, InterviewAnswer } from '@/lib/schemas/character';

const adaptiveTagResponseSchema = z.object({
  tags: z.array(z.string()).max(PERSONALITY_TAG_MAX_SELECTIONS),
});

function normalizeTags(value: unknown): PersonalityTagKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0, PERSONALITY_TAG_MAX_SELECTIONS);
}

export async function inferInterviewAdaptiveTags(
  draft: CharacterDraft,
  answers: InterviewAnswer[],
): Promise<PersonalityTagKey[]> {
  // 요약 로딩 직전에 브라우저가 이미 같은 20문항으로 판별해 보냈다면 재호출하지 않는다.
  const precomputed = normalizeTags(draft.personalityTags.interviewAdaptive);
  if (precomputed.length) return precomputed;

  const ownerSelected = normalizeTags(draft.personalityTags.ownerSelected);
  const aiInitial = normalizeTags(draft.personalityTags.aiInitial);
  const tagGuide = PERSONALITY_TAG_CATALOG.map(tag => ({
    key: tag.key,
    label: tag.label,
    family: tag.family,
  }));

  const result = await askOpenAIJson({
    instructions: `당신은 자캐커뮤니티 캐릭터의 20문항 인터뷰가 끝난 뒤 성격 경향을 다시 판별하는 분류기입니다.
허용된 성격 태그 중 현재 자료로 가장 잘 설명되는 태그를 최대 ${PERSONALITY_TAG_MAX_SELECTIONS}개만 고르세요.

중요 규칙:
- 20문항의 실제 답변과 이유를 가장 중요한 새 근거로 봅니다.
- 오너가 직접 선택한 기존 태그는 중요한 기준점이지만 반드시 그대로 복사할 필요는 없습니다. 이 단계는 인터뷰에서 실제로 드러난 현재 경향을 별도로 기록합니다.
- 오너가 고른 태그 자체를 삭제하거나 수정하는 작업이 아닙니다. 반환값은 interviewAdaptive 전용입니다.
- 프로필의 직접 설정, 오너가 맞다고 확인한 추론과 정정도 함께 참고합니다.
- 한 단어나 한 질문만으로 태그를 붙이지 말고 여러 답변에서 반복되는 말·행동·선택·판단 기준을 우선하세요.
- 서로 반대처럼 보이는 성향도 관계나 상황에 따라 둘 다 반복해서 나타난다면 함께 선택할 수 있습니다.
- 근거가 약하면 5개를 억지로 채우지 마세요.
- 외관, 성별, 나이만으로 성격을 추론하지 마세요.
- 허용 목록의 key 외 문자열은 절대 출력하지 마세요.
- 출력은 tags 배열만 가진 JSON 객체입니다.`,
    schema: adaptiveTagResponseSchema,
    maxOutputTokens: 500,
    input: `캐릭터 이름: ${draft.basicProfile.name}

허용 성격 태그:
${JSON.stringify(tagGuide)}

AI의 프로필 최초 판단:
${JSON.stringify(aiInitial.map(key => ({ key, label: personalityTagLabel(key), family: personalityTagFamily(key) })))}

오너가 직접 확정한 기본 성향:
${JSON.stringify(ownerSelected.map(key => ({ key, label: personalityTagLabel(key), family: personalityTagFamily(key) })))}

프로필 구조화 성향:
${JSON.stringify({ traits: draft.traits, relationshipTraits: draft.relationshipTraits, confirmedFacts: draft.confirmedFacts })}

오너 검수된 AI 추론:
${JSON.stringify(draft.aiInferences.map(item => ({ text: item.text, verdict: item.ownerVerdict, ownerFeedback: item.ownerFeedback || '' })))}

20문항 답변:
${JSON.stringify(answers.slice().sort((a, b) => a.order - b.order).map(answer => ({ order: answer.order, question: answer.question, answer: answer.answer, reason: answer.reason || '' })))}`,
  });

  const normalized = normalizeTags(result.tags);
  if (normalized.length) return normalized;
  return ownerSelected.length ? ownerSelected : aiInitial;
}
