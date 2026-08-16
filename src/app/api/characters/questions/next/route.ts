import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { QUESTION_INSTRUCTIONS } from '@/lib/ai/prompts';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).max(19),
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

    const order = body.answers.length + 1;
    if (order > 20) return NextResponse.json({ done: true });

    const confirmedInferences = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'confirmed')
      .map(x => ({ text: x.text, evidence: x.evidence }));

    const ownerClarifiedAmbiguities = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'ambiguous' && x.ownerFeedback?.trim())
      .map(x => ({ ownerFeedback: x.ownerFeedback!.trim(), relatedInference: x.text }));

    const unresolvedAmbiguities = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'ambiguous' && !x.ownerFeedback?.trim())
      .map(x => ({ text: x.text, evidence: x.evidence }));

    const ownerCorrections = body.draft.aiInferences
      .filter(x => x.ownerVerdict === 'rejected' && x.ownerFeedback?.trim())
      .map(x => x.ownerFeedback!.trim());

    const compactDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      confirmedInferences,
      ownerClarifiedAmbiguities,
      unresolvedAmbiguities,
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
        : '직전 답변/이유에서 새 의문이 생겼거나, 직전 답변이 현재 hypothesis·누적 해석과 어긋나 그 차이를 확인하면 캐릭터 해석 폭이 커질 때 branch를 적극 검토하세요. branch에서는 같은 상황을 한 번 더 이어 물어도 됩니다. 단, 이미 답한 내용을 재확인하거나 같은 상황을 계속 꼬리물지 마세요. 오너가 이미 명시적으로 정정·보충한 내용 자체는 branch 대상이 아닙니다.';

    const formatRules = [
      lastFormat ? `직전 형식은 ${lastFormat}(${FORMAT_LABELS[lastFormat as keyof typeof FORMAT_LABELS] || lastFormat})입니다. 기본적으로 다른 형식을 우선하되, 같은 상황을 자연스럽게 이어가는 branch가 더 정보가치가 높다면 같은 형식을 1회 유지해도 됩니다.` : '',
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

오너 검수 피드백의 상태 규칙 — 매우 중요:
- ownerCorrections의 각 문장은 오너가 직접 확정한 캐릭터 사실입니다. 이미 답이 끝난 CLOSED KNOWLEDGE입니다.
- ownerCorrections에 적힌 행동, 이유, 조건, 예외, 우선순위, 관계 차이는 다시 질문하지 마세요.
- 같은 내용을 단어만 바꾸거나 상황만 살짝 바꿔 재확인하는 것도 금지합니다.
- ownerCorrections를 질문의 출발점으로 사용할 수는 있지만, 반드시 correction에 아직 답이 없는 '인접한 새 정보'만 물어야 합니다.
- 예: 오너가 '자기 일정과 겹치면 바로 거절하고 죄책감도 없다'고 정정했다면, '일정이 겹치면 무엇을 먼저 보나?', '거절할 때 죄책감이 있나?'는 금지입니다.
- 그 대신 정말 필요하다면 '누구에게는 그 기준이 달라지는가?', '본인이 먼저 도움을 청할 때도 같은 기준인가?'처럼 정정문에 답이 없는 별도 축을 볼 수 있습니다.
- 단, 그런 인접 질문도 다른 캐릭터 Hook보다 정보가치가 낮다면 굳이 이어 묻지 말고 pivot하세요.

- ownerClarifiedAmbiguities.ownerFeedback도 오너가 직접 말한 부분은 CLOSED KNOWLEDGE입니다. 그 문장에 이미 포함된 내용은 재질문하지 마세요.
- relatedInference는 왜 애매함이 생겼는지 이해하기 위한 배경일 뿐이며 ownerFeedback과 충돌하면 ownerFeedback이 정답입니다.
- unresolvedAmbiguities는 아직 오너 설명이 없으므로 약한 참고만 가능합니다.
- confirmedInferences는 오너가 맞다고 확인한 해석입니다.
- unreviewed/rejected AI 추론 원문은 질문 근거로 사용하지 않습니다.

중복 방지 규칙:
- 질문을 만들기 전에 반드시 '이 질문의 답이 이미 ownerCorrections, ownerClarifiedAmbiguities.ownerFeedback, 프로필 명시 사실, 이전 answer/reason 안에 들어 있는가?'를 검사하세요.
- 답이 이미 있으면 그 질문 후보를 폐기하고 다른 targetHook을 고르세요.
- 새 질문은 기존 확정 정보를 다시 측정하는 것이 아니라, 아직 비어 있는 정보를 추가해야 합니다.
- 이미 확정된 사실의 세부 표현을 바꾸는 것만으로는 새 정보가 아닙니다.

연계형 질문 허용 규칙:
- 매 문항마다 새 상황으로 바꿀 필요는 없습니다. 같은 상황에서 한 번 더 물어야 원래 답의 조건·예외·우선순위가 드러난다면 branch로 이어갈 수 있습니다.
- 특히 직전 답변이 직전 hypothesis, 프로필에서 예상된 패턴, 또는 지금까지 강해진 해석과 반대 방향이라면 즉시 다른 주제로 넘기지 말고 그 차이가 왜 생겼는지 구분하는 후속 질문을 우선 검토하세요.
- 후속 질문은 '아까 답 정말 맞나요?' 같은 재확인이 아니라, 서로 다른 해석을 가르는 새로운 판단 조건을 하나 추가해야 합니다.
- 예: 예상과 달리 갈등 상황에서 먼저 사과한다고 답했다면, 같은 갈등 상황 안에서 '본인 잘못이 없다고 확신할 때도 먼저 관계를 수습하는가'처럼 해석을 가르는 조건을 한 번 더 볼 수 있습니다.
- branch에서는 직전 targetHook과 동일하거나 매우 가까운 Hook을 1회 더 다뤄도 됩니다. 단, 이전 답에 이미 포함된 내용을 그대로 묻지 마세요.
- 같은 상황의 연계 질문이 두 문항 연속 이어졌다면 다음에는 pivot 또는 counter로 전환하세요.
- 직전 답이 이미 충분히 명확하거나 후속 질문으로 얻을 새 정보가 적다면 억지로 연계하지 말고 pivot하세요.

중요한 증거 사용 규칙:
- 오너의 직접 정정/보충, 인터뷰 답변과 이유는 가장 높은 우선순위의 캐릭터 근거입니다.
- confirmedFacts의 어떤 항목도 종류만으로 중요하거나 중요하지 않다고 판단하지 마세요.
- 프로필/비밀 프로필이 의미를 직접 설명하거나, 서로 독립적인 여러 행동·관계·사건·답변이 같은 의미를 지지하면 강한 Hook으로 사용할 수 있습니다.
- 반복되지만 의미가 불명확한 항목은 중간 강도의 단서입니다. 중요성을 단정하지 않는 질문만 허용됩니다.
- 한 번 등장했고 의미가 설명되지 않은 항목은 약한 단서입니다. 심리적 의미를 전제로 질문하지 마세요.

지금까지의 실제 문답과 내부 질문 메타데이터:
${JSON.stringify(history)}

답변 이유 활용:
- reason이 있으면 answer와 함께 중요한 근거로 사용하세요.
- 선택한 보기보다 reason이 더 구체적이면 reason을 우선해 캐릭터의 행동 규칙을 이해하세요.
- answer/reason에 이미 적힌 내용을 다시 확인하지 마세요.
- 직전 answer/reason이 기존 해석과 충돌하거나 예상 밖의 조건을 드러냈다면, 그 충돌을 해소하면 캐해 폭이 넓어지는지 먼저 판단하고 가치가 있으면 같은 맥락의 branch를 1회 허용하세요.
- 단순히 더 자세히 듣고 싶다는 이유만으로 branch하지 말고, 후속 답변에 따라 실제 해석이 달라질 때만 이어가세요.

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
1. 현재 캐릭터에서 아직 답이 없는 의문 후보를 2~4개 내부적으로 만드세요. 직전 답변을 한 번 더 파고들면 해석이 크게 갈리는 경우에는 같은 상황의 후속 후보도 반드시 포함하세요.
2. 각 후보가 오너 정정/보충, 프로필, 이전 answer/reason에 이미 답이 있는지 검사하고, 있으면 제거하세요.
3. 남은 후보 중 한 문항으로 해석이 가장 많이 달라질 지점을 targetHook으로 고르세요.
4. 최근 답변에서 실제 미확인 정보가 이어지거나 기존 hypothesis와 충돌해 한 번 더 구분할 가치가 있으면 branch를 선택할 수 있습니다. 이 경우 같은 상황을 1회 이어가도 됩니다. 다른 고유 Hook이 더 중요하면 pivot, 강해진 해석의 현실적 예외를 확인하는 편이 더 유용하면 counter를 고르세요.
5. 질문은 한 가지 판단만 묻고 짧게 작성하세요.

길이 강제:
- question은 최대 90자이며 70자 안팎을 목표로 합니다.
- 각 option은 최대 65자이며 50자 안팎을 목표로 합니다.
- 질문과 보기에 긴 배경설명이나 여러 조건을 겹치지 마세요.

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
