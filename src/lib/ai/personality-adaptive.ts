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
import type {
  CharacterDraft,
  InterviewAnswer,
  SummaryAnalysisGeneration,
} from '@/lib/schemas/character';

const adaptiveTagResponseSchema = z.object({
  tags: z.array(z.string()).max(PERSONALITY_TAG_MAX_SELECTIONS),
});

function normalizeTags(value: unknown): PersonalityTagKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0, PERSONALITY_TAG_MAX_SELECTIONS);
}

function tagGuide() {
  return PERSONALITY_TAG_CATALOG.map(tag => ({
    key: tag.key,
    label: tag.label,
    family: tag.family,
  }));
}

function describedTags(tags: PersonalityTagKey[]) {
  return tags.map(key => ({
    key,
    label: personalityTagLabel(key),
    family: personalityTagFamily(key),
  }));
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
${JSON.stringify(tagGuide())}

AI의 프로필 최초 판단:
${JSON.stringify(describedTags(aiInitial))}

오너가 직접 확정한 기본 성향:
${JSON.stringify(describedTags(ownerSelected))}

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

export async function inferFinalAdaptiveTags(
  draft: CharacterDraft,
  summary: SummaryAnalysisGeneration,
): Promise<PersonalityTagKey[]> {
  const interviewAdaptive = normalizeTags(draft.personalityTags.interviewAdaptive);
  const ownerSelected = normalizeTags(draft.personalityTags.ownerSelected);
  const aiInitial = normalizeTags(draft.personalityTags.aiInitial);
  const fallback = interviewAdaptive.length ? interviewAdaptive : ownerSelected.length ? ownerSelected : aiInitial;

  const result = await askOpenAIJson({
    instructions: `당신은 자캐커뮤니티 캐릭터의 요약 리포트가 완성된 뒤 최종 성격 태그를 정리하는 분류기입니다.
허용된 성격 태그 중, 프로필과 오너 검수와 20문항을 거쳐 완성된 요약 해석까지 종합했을 때 가장 대표적인 태그를 최대 ${PERSONALITY_TAG_MAX_SELECTIONS}개 고르세요.

이 단계의 목적은 finalAdaptive를 만드는 것입니다.
- ownerSelected는 오너가 직접 확정한 원본이므로 수정하거나 삭제하는 대상이 아닙니다.
- interviewAdaptive는 20문항에서 드러난 성향이며 매우 중요한 기준점입니다.
- 완성된 요약 리포트는 단순 키워드가 아니라, 여러 근거를 교차 검증해 정리한 작동 원리로 취급하세요.
- 요약문에 우연히 특정 형용사가 한 번 등장했다는 이유만으로 태그를 바꾸지 마세요.
- interviewAdaptive와 요약 해석이 서로 일치하면 그 태그의 대표성을 높게 봅니다.
- 요약에서 반복적으로 드러나는 조건·관계 방식·갈등 반응이 기존 태그와 다르면 새 태그를 선택할 수 있습니다.
- 서로 반대처럼 보이는 태그도 상황별로 모두 핵심이라면 함께 선택할 수 있습니다.
- 태그 5개를 억지로 채우지 마세요.
- 외관·성별·나이만으로 태그를 선택하지 마세요.
- 허용 목록의 key 외 문자열은 절대 출력하지 마세요.
- 출력은 tags 배열만 가진 JSON 객체입니다.`,
    schema: adaptiveTagResponseSchema,
    maxOutputTokens: 500,
    input: `캐릭터 이름: ${draft.basicProfile.name}

허용 성격 태그:
${JSON.stringify(tagGuide())}

오너가 직접 확정한 기본 성향:
${JSON.stringify(describedTags(ownerSelected))}

20문항 이후 AI 판단:
${JSON.stringify(describedTags(interviewAdaptive))}

AI의 최초 프로필 판단:
${JSON.stringify(describedTags(aiInitial))}

완성된 요약 리포트:
${JSON.stringify({
  oneLineSummary: summary.oneLineSummary,
  summary: summary.summary,
  evidencePack: {
    behaviorRules: summary.evidencePack.behaviorRules,
    relationshipPatterns: summary.evidencePack.relationshipPatterns,
    emotionalPatterns: summary.evidencePack.emotionalPatterns,
    valuesAndMotives: summary.evidencePack.valuesAndMotives,
    exceptionsAndConditions: summary.evidencePack.exceptionsAndConditions,
    tensionsAndContradictions: summary.evidencePack.tensionsAndContradictions,
  },
})}`,
  });

  const normalized = normalizeTags(result.tags);
  return normalized.length ? normalized : fallback;
}
