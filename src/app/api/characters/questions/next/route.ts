import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { QUESTION_INSTRUCTIONS } from '@/lib/ai/prompts';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).max(19),
  accessCode: z.string().min(1),
});

const CATEGORY_TARGETS = {
  core: 3,
  relationship: 3,
  conflict: 3,
  inner: 3,
  validation: 2,
} as const;

const FORMAT_LABELS = {
  scenario: '상황형',
  comparison: '비교형',
  priority: '우선순위형',
  exception: '예외 탐색형',
  hypothesis: '해석 경쟁형',
  relationship_contrast: '관계 대조형',
  sentence_completion: '문장 완성형',
  free_response: '자유서술형',
} as const;

function contextString(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return '';
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : '';
}

function trailingCount(values: string[], target: string) {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== target) break;
    count += 1;
  }
  return count;
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('question_next', 60, 60);
    const body = requestSchema.parse(await request.json());
    if (!(await validateAccessCode(body.accessCode))) throw new Error('CODE_INVALID');

    const order = body.answers.length + 1;
    if (order > 20) return NextResponse.json({ done: true });

    const confirmedInferences = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'confirmed')
      .map(x => ({ text: x.text, evidence: x.evidence }));
    const ambiguousInferences = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'ambiguous')
      .map(x => ({ text: x.text, evidence: x.evidence, ownerFeedback: x.ownerFeedback?.trim() || '' }));
    const ownerCorrections = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'rejected' && x.ownerFeedback?.trim())
      .map(x => ({ rejectedInference: x.text, correction: x.ownerFeedback!.trim(), originalEvidence: x.evidence }));

    const compactDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      confirmedInferences,
      ambiguousInferences,
      ownerCorrections,
      analysisConfidence: body.draft.analysisConfidence,
    };

    const history = body.answers.map(answer => ({
      order: answer.order,
      question: answer.question,
      answer: answer.answer,
      reason: answer.reason || '',
      category: contextString(answer.branchContext, 'category'),
      mode: contextString(answer.branchContext, 'mode'),
      format: contextString(answer.branchContext, 'format'),
      targetHook: contextString(answer.branchContext, 'targetHook'),
      hypothesis: contextString(answer.branchContext, 'hypothesis'),
    }));

    const categoryCounts = Object.fromEntries(
      Object.keys(CATEGORY_TARGETS).map(category => [
        category,
        history.filter(item => item.category === category).length,
      ]),
    );

    const formatCounts = Object.fromEntries(
      Object.keys(FORMAT_LABELS).map(format => [
        format,
        history.filter(item => item.format === format).length,
      ]),
    );

    const unmetCategories = Object.entries(CATEGORY_TARGETS)
      .filter(([category, target]) => (categoryCounts[category] || 0) < target)
      .map(([category, target]) => `${category} ${(categoryCounts[category] || 0)}/${target}`);

    const remainingIncludingCurrent = 21 - order;
    const requiredCoverageSlots = Object.entries(CATEGORY_TARGETS)
      .reduce((sum, [category, target]) => sum + Math.max(0, target - (categoryCounts[category] || 0)), 0);

    const recentModes = history.slice(-4).map(item => item.mode).filter(Boolean);
    const recentFormats = history.slice(-4).map(item => item.format).filter(Boolean);
    const branchStreak = trailingCount(history.map(item => item.mode), 'branch');
    const scenarioCount = formatCounts.scenario || 0;
    const freeResponseCount = formatCounts.free_response || 0;
    const lastFormat = history.at(-1)?.format || '';
    const usedHooks = history.map(item => item.targetHook).filter(Boolean);

    const modeRules = order === 1
      ? '첫 문항이므로 mode는 pivot으로 시작하세요.'
      : branchStreak >= 2
        ? '직전 두 문항이 branch였으므로 이번 문항은 branch 금지입니다. pivot 또는 counter를 선택하세요.'
        : '직전 답변이나 답변 이유에서 새로운 모순·예외·조건이 나왔다면 branch를 우선 검토하세요. 그렇지 않으면 pivot/counter 중 정보가치가 높은 쪽을 선택하세요.';

    const formatRules = [
      lastFormat ? `직전 형식은 ${lastFormat}(${FORMAT_LABELS[lastFormat as keyof typeof FORMAT_LABELS] || lastFormat})이므로 이번에는 다른 형식을 우선하세요.` : '',
      scenarioCount >= 6 ? 'scenario는 이미 6회 이상 사용했으므로 더 이상 사용하지 마세요.' : 'scenario는 전체 20문항 중 최대 5~6회까지만 사용하세요.',
      freeResponseCount >= 2 ? 'free_response는 이미 2회 사용했으므로 더 이상 사용하지 마세요.' : 'free_response는 전체 1~2회만 사용하세요.',
    ].filter(Boolean).join('\n');

    const coverageRule = requiredCoverageSlots >= remainingIncludingCurrent
      ? `남은 문항 수와 필수 커버리지 슬롯이 같거나 부족합니다. 이번 category는 아직 목표치가 부족한 영역 중 하나여야 합니다: ${unmetCategories.join(', ')}`
      : `category 순서는 자유입니다. 캐릭터상 정보가치가 가장 높은 영역을 고르되 부족 영역도 고려하세요: ${unmetCategories.join(', ') || '없음'}`;

    const question = await askOpenAIJson({
      instructions: QUESTION_INSTRUCTIONS,
      schema: interviewQuestionSchema,
      maxOutputTokens: 1050,
      input: `현재 문항 번호: ${order}/20

캐릭터 데이터:
${JSON.stringify(compactDraft)}

AI 추론 검수에서 받은 오너 피드백 사용 규칙:
- ownerCorrections.correction은 오너가 직접 알려준 설정이므로 강한 직접 증거입니다.
- ownerCorrections.rejectedInference는 틀렸다고 판정된 AI 해석입니다. 절대 사실이나 가설의 근거로 재사용하지 마세요. correction만 사용하세요.
- ambiguousInferences에 ownerFeedback이 있으면 그 피드백을 AI 추론 문장보다 우선하세요. AI 추론은 일부만 맞을 수 있는 미확정 맥락일 뿐입니다.
- ambiguousInferences에 ownerFeedback이 없으면 약한 참고로만 보고, 별도 근거 없이는 질문 전제로 삼지 마세요.
- confirmedInferences만 오너가 그대로 맞다고 확인한 AI 해석입니다.
- unreviewed 추론은 아예 제공되지 않습니다.

중요한 증거 사용 규칙:
- 오너의 직접 답변, 답변 이유, AI 추론 검수의 정정/보충은 가장 높은 우선순위의 캐릭터 근거입니다.
- confirmedFacts의 어떤 항목도 종류만으로 중요하거나 중요하지 않다고 판단하지 마세요.
- 프로필/비밀 프로필이 의미를 직접 설명하거나, 서로 독립적인 여러 행동·관계·사건·답변이 같은 의미를 지지하면 강한 Hook으로 사용할 수 있습니다.
- 반복되지만 의미가 불명확한 항목은 중간 강도의 단서입니다. 중요성을 단정하지 않는 질문만 허용됩니다.
- 한 번 등장했고 의미가 설명되지 않은 항목은 약한 단서입니다. 심리적 의미를 전제로 질문하지 마세요.
- 약한 단서의 중요성을 확인할 정보가치가 높다면, 중요하다는 전제 없이 짧은 확인 질문을 1회 사용할 수 있습니다. 오너 답변이 의미를 부여하면 이후 강한 Hook으로 승격할 수 있습니다.

지금까지의 실제 문답과 내부 질문 메타데이터:
${JSON.stringify(history)}

답변 이유 활용:
- reason이 있으면 answer와 함께 다음 분기의 중요한 근거로 사용하세요.
- 선택한 보기보다 reason이 더 구체적이면 reason을 우선해 캐릭터의 행동 규칙을 이해하세요.
- reason을 다시 그대로 물어보지 말고, 새로 드러난 조건이나 예외만 한 단계 더 확인하세요.

현재 커버리지:
- category counts: ${JSON.stringify(categoryCounts)}
- format counts: ${JSON.stringify(formatCounts)}
- 최근 mode: ${JSON.stringify(recentModes)}
- 최근 format: ${JSON.stringify(recentFormats)}
- 이미 겨냥한 targetHook: ${JSON.stringify(usedHooks)}

이번 문항의 진행 제약:
${modeRules}
${formatRules}
${coverageRule}

질문 선택 절차:
1. 현재 캐릭터에서 아직 덜 확인됐거나 오너의 검수 피드백/최근 답변 때문에 새로 생긴 의문을 2~4개 내부적으로 비교하세요.
2. 그중 한 문항으로 해석이 가장 많이 달라질 지점을 targetHook으로 고르세요.
3. 최근 답변을 한 단계 더 볼 가치가 있으면 branch, 다른 확실한 고유 Hook이 더 중요하면 pivot, 강해진 해석의 예외를 볼 필요가 있으면 counter를 고르세요.
4. 최근 형식을 반복하지 않고 가장 간단하게 물을 수 있는 format을 고르세요.
5. 질문은 한 가지 판단만 묻고 짧게 작성하세요.

길이 강제:
- question은 최대 90자이며 70자 안팎을 목표로 합니다.
- 각 option은 최대 65자이며 50자 안팎을 목표로 합니다.
- 질문과 보기에 긴 배경설명이나 여러 조건을 겹치지 마세요.

분기 규칙:
- branch는 같은 사건을 이어 쓰는 것이 아니라 최근 답변의 핵심 이유나 조건을 다른 각도에서 한 번 더 확인합니다.
- pivot도 무관한 랜덤 질문이면 실패입니다. 확실한 프로필 Hook 또는 현재 해석과 연결되는 미확인 지점으로 이동하세요.
- counter는 현재까지 가장 그럴듯한 해석이 깨지는 현실적인 예외를 확인합니다.

선택지 설계:
- 예상 후보 1~2개와 다른 캐해를 열 수 있는 경쟁 후보 1~2개를 함께 넣으세요.
- 필요하면 조건부 후보 1개를 추가하세요.
- 한 보기에는 핵심 행동이나 판단 하나만 적으세요.
- free_response일 때 options=[]로 출력하세요.

출력 규칙:
- order=${order}
- 출력 키는 order, category, mode, format, targetHook, hypothesis, question, options, allowCustom, rationale만 사용하세요.`,
    });

    return NextResponse.json({ done: false, question });
  } catch (error) {
    return apiError(error);
  }
}
