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

const RESPONSE_TYPE_LABELS = {
  fill_blank: '빈칸 채우기',
  sentence_continue: '문장 이어쓰기',
  dialogue_choice: '대사 고르기',
  bipolar_scale: '두 문장 사이 강도 선택',
  ranking: '순위 매기기',
  multi_select: '복수 선택',
  least_likely: '가장 하지 않을 것 고르기',
  slider: '가능성 슬라이더',
  relationship_matrix: '관계별 반응표',
  inner_outer: '속마음과 실제 행동 분리',
  temporal_compare: '시간에 따른 반응 비교',
  condition_followup: '조건이 바뀌었을 때 비교',
  owner_meta: '오너 메타 질문',
} as const;

type ResponseType = keyof typeof RESPONSE_TYPE_LABELS;
const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];
const RECENT_FULL_HISTORY = 4;

const RESPONSE_TYPE_RULES: Record<ResponseType, string> = {
  fill_blank: '질문 안에 ________ 빈칸을 하나 넣으세요. options는 서로 다른 3~5개 후보를 만들고 allowCustom=true로 하세요. responseConfig는 빈 객체 수준으로 두세요.',
  sentence_continue: '캐릭터의 생각이나 판단을 이어 쓰게 하는 미완성 문장으로 만드세요. options=[]이고 allowCustom=true입니다. 사용자가 직접 한 문장으로 이어 쓸 수 있어야 합니다.',
  dialogue_choice: '캐릭터가 실제로 할 법한 첫마디를 고르게 하세요. options는 짧은 실제 대사 3~5개이며 allowCustom=true입니다.',
  bipolar_scale: '서로 반대되는 두 판단 중 어느 쪽에 더 가까운지 5단계로 고르게 합니다. options=[]이고 responseConfig.leftLabel/rightLabel에 짧고 대등한 두 문장을 넣으세요.',
  ranking: '서로 다른 가치·판단·행동 기준 4~5개를 options에 넣어 전부 순위 매기게 하세요. 항목끼리 겹치지 않게 하세요.',
  multi_select: '동시에 일어날 수 있는 행동이나 반응 4~6개를 options에 넣으세요. 여러 개를 고를 수 있어야 하므로 상호배타적으로 만들지 마세요. 필요하면 responseConfig.maxSelections에 2~4를 넣으세요.',
  least_likely: 'options 3~5개 중 이 캐릭터가 가장 하지 않을 것 하나를 고르게 하세요. 질문도 반드시 가장 하지 않을 것을 묻는 형태로 쓰세요.',
  slider: '0~100 가능성/강도를 고르게 하세요. options=[]이고 responseConfig.minLabel/maxLabel에 0과 100이 뜻하는 상태를 각각 넣으세요.',
  relationship_matrix: '같은 상황을 관계가 다른 상대에게 적용해 비교하게 하세요. options=[]입니다. responseConfig.rows에는 2~4개의 관계 상대, columns에는 2~4개의 짧은 반응 선택지를 넣으세요.',
  inner_outer: '속으로 가장 먼저 드는 생각과 실제로 겉으로 보이는 행동을 따로 적게 하세요. options=[]이고 question은 첫 번째 항목, responseConfig.prompt2는 두 번째 항목을 묻습니다.',
  temporal_compare: '같은 사건에 대한 서로 다른 두 시점의 반응을 비교합니다. options는 두 시점 모두에서 공통으로 선택 가능한 3~5개 반응이고 responseConfig.leftLabel/rightLabel에 두 시점을 넣으세요.',
  condition_followup: '기본 상황에서 한 번 고른 뒤 조건 하나만 바뀌었을 때 다시 고르게 합니다. options는 두 질문에서 공통으로 쓸 3~5개 반응이며 responseConfig.prompt2에 바뀐 조건을 포함한 두 번째 질문을 넣으세요.',
  owner_meta: '캐릭터를 오래 본 오너만 답하기 좋은 메타 질문을 만드세요. 예: 남들이 자주 오해하는 부분, 오너가 가장 중요하게 보는 간극. options는 3~5개 후보이며 allowCustom=true입니다.',
};

const RESPONSE_TYPE_SYSTEM = `응답 UI 형식은 질문 format과 별개의 축입니다.
이번 요청에서는 서버가 responseType을 하나 고정해서 제공합니다. 반드시 그 responseType을 그대로 출력하세요.
responseType에 따라 options와 responseConfig 구조가 달라지며, 아래 개별 규칙이 기존의 일반적인 '선택지 3~5개' 규칙보다 우선합니다.
최종 JSON 키는 order, category, mode, format, responseType, responseConfig, targetHook, hypothesis, question, options, allowCustom, rationale만 사용하세요.`;

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

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseResponseType(args: {
  name: string;
  order: number;
  history: Array<{ responseType: string; targetHook: string }>;
}) {
  const counts = Object.fromEntries(RESPONSE_TYPES.map(type => [type, 0])) as Record<ResponseType, number>;
  for (const item of args.history) {
    if (item.responseType in counts) counts[item.responseType as ResponseType] += 1;
  }

  const missing = RESPONSE_TYPES.filter(type => counts[type] === 0);
  const lastType = args.history.at(-1)?.responseType || '';
  const pool = missing.length
    ? missing
    : RESPONSE_TYPES.filter(type => type !== lastType && counts[type] < 3);
  const candidates = pool.length ? pool : RESPONSE_TYPES.filter(type => type !== lastType);
  const seed = hashString(`${args.name}:${args.order}:${args.history.map(x => x.targetHook).join('|')}`);
  return candidates[seed % candidates.length];
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

    const history = body.answers.map(answer => {
      const format = contextString(answer.branchContext, 'format');
      const storedSource = contextString(answer.branchContext, 'answerSource');
      const answerSource = storedSource === 'choice' || storedSource === 'custom' || storedSource === 'structured'
        ? storedSource
        : format === 'free_response'
          ? 'custom'
          : 'unknown';
      return {
        order: answer.order,
        question: answer.question,
        answer: answer.answer,
        reason: answer.reason || '',
        category: contextString(answer.branchContext, 'category'),
        mode: contextString(answer.branchContext, 'mode'),
        format,
        responseType: contextString(answer.branchContext, 'responseType'),
        targetHook: contextString(answer.branchContext, 'targetHook'),
        hypothesis: contextString(answer.branchContext, 'hypothesis'),
        answerSource,
      };
    });

    const recentHistory = history.slice(-RECENT_FULL_HISTORY);
    const olderHistory = history.slice(0, Math.max(0, history.length - RECENT_FULL_HISTORY));

    const settledKnowledge = olderHistory
      .filter(item => item.answerSource === 'choice' && !item.reason)
      .map(item => ({
        order: item.order,
        category: item.category,
        responseType: item.responseType,
        targetHook: item.targetHook,
        selectedAnswer: item.answer,
      }));

    const ownerVerbatim = olderHistory
      .filter(item => item.answerSource !== 'choice' || !!item.reason)
      .map(item => ({
        order: item.order,
        category: item.category,
        responseType: item.responseType,
        targetHook: item.targetHook,
        question: item.question,
        ...(item.answerSource === 'choice'
          ? { selectedAnswer: item.answer }
          : item.answerSource === 'custom'
            ? { directAnswer: item.answer }
            : { originalAnswer: item.answer }),
        ...(item.reason ? { reason: item.reason } : {}),
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

    const responseTypeCounts = Object.fromEntries(
      RESPONSE_TYPES.map(type => [type, history.filter(item => item.responseType === type).length]),
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
    const responseType = chooseResponseType({
      name: body.draft.basicProfile.name,
      order,
      history: history.map(item => ({ responseType: item.responseType, targetHook: item.targetHook })),
    });

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
      instructions: `${QUESTION_INSTRUCTIONS}\n\n${RESPONSE_TYPE_SYSTEM}`,
      schema: interviewQuestionSchema,
      maxOutputTokens: 1400,
      input: `현재 문항 번호: ${order}/20

캐릭터 데이터:
${JSON.stringify(compactDraft)}

오너 검수 피드백의 상태 규칙 — 매우 중요:
- ownerCorrections의 각 문장은 오너가 직접 확정한 캐릭터 사실입니다. 이미 답이 끝난 CLOSED KNOWLEDGE입니다.
- ownerCorrections에 적힌 행동, 이유, 조건, 예외, 우선순위, 관계 차이는 다시 질문하지 마세요.
- 같은 내용을 단어만 바꾸거나 상황만 살짝 바꿔 재확인하는 것도 금지합니다.
- ownerCorrections를 질문의 출발점으로 사용할 수는 있지만, 반드시 correction에 아직 답이 없는 인접한 새 정보만 물어야 합니다.
- ownerClarifiedAmbiguities.ownerFeedback도 오너가 직접 말한 부분은 CLOSED KNOWLEDGE입니다.
- relatedInference는 배경일 뿐이며 ownerFeedback과 충돌하면 ownerFeedback이 정답입니다.
- unresolvedAmbiguities는 아직 오너 설명이 없으므로 약한 참고만 가능합니다.
- confirmedInferences는 오너가 맞다고 확인한 해석입니다.
- unreviewed/rejected AI 추론 원문은 질문 근거로 사용하지 않습니다.

중복 방지용 인터뷰 기억:
- 오래된 객관식 확정 내용 settledKnowledge: ${JSON.stringify(settledKnowledge)}
- 오래되어도 원문 보존한 오너 직접서술/이유 ownerVerbatim: ${JSON.stringify(ownerVerbatim)}
- 최근 ${RECENT_FULL_HISTORY}문답 전체 recentHistory: ${JSON.stringify(recentHistory)}
- 지금까지 겨냥한 targetHook 전체 usedHooks: ${JSON.stringify(usedHooks)}

중복 방지 규칙:
- 질문을 만들기 전에 답이 이미 ownerCorrections, ownerClarifiedAmbiguities.ownerFeedback, 프로필 명시 사실, settledKnowledge, ownerVerbatim, recentHistory 안에 있는지 검사하세요.
- ownerVerbatim의 directAnswer/originalAnswer/reason은 오너가 직접 쓴 원문이므로 의미를 축소하지 말고 그대로 근거로 사용하세요.
- 같은 targetHook은 branch로 새로운 조건을 구분할 가치가 있을 때만 다시 사용할 수 있습니다.
- 이미 답이 있으면 후보를 폐기하고 다른 미확인 지점을 고르세요.

연계형 질문 허용 규칙:
- 매 문항마다 새 상황으로 바꿀 필요는 없습니다. 같은 상황에서 한 번 더 물어야 원래 답의 조건·예외·우선순위가 드러난다면 branch로 이어갈 수 있습니다.
- 특히 직전 답변이 직전 hypothesis, 프로필에서 예상된 패턴, 또는 지금까지 강해진 해석과 반대 방향이라면 그 차이를 구분하는 후속 질문을 우선 검토하세요.
- 후속 질문은 재확인이 아니라 서로 다른 해석을 가르는 새로운 판단 조건을 하나 추가해야 합니다.
- 같은 상황의 연계 질문이 두 문항 연속 이어졌다면 다음에는 pivot 또는 counter로 전환하세요.
- 후속 질문의 정보가치가 낮다면 억지로 branch하지 마세요.

중요한 증거 사용 규칙:
- 오너 직접 정정/보충, 인터뷰 답변과 이유는 가장 높은 우선순위의 캐릭터 근거입니다.
- 프로필/비밀 프로필이 의미를 직접 설명하거나 서로 독립적인 여러 행동·관계·사건·답변이 같은 의미를 지지하면 강한 Hook으로 사용할 수 있습니다.
- 반복되지만 의미가 불명확한 항목은 중간 강도의 단서입니다. 중요성을 단정하지 않는 질문만 허용됩니다.
- 한 번 등장했고 의미가 설명되지 않은 항목은 약한 단서입니다. 심리적 의미를 전제로 질문하지 마세요.

현재 커버리지:
- category counts: ${JSON.stringify(categoryCounts)}
- format counts: ${JSON.stringify(formatCounts)}
- responseType counts: ${JSON.stringify(responseTypeCounts)}
- 최근 mode: ${JSON.stringify(recentModes)}
- 최근 format: ${JSON.stringify(recentFormats)}

이번 문항의 진행 제약:
${modeRules}
${formatRules}
${coverageRule}

이번 문항의 답변 UI 형식은 서버가 고정했습니다.
- responseType=${responseType} (${RESPONSE_TYPE_LABELS[responseType]})
- 반드시 responseType 값을 정확히 "${responseType}"로 출력하세요.
- 세부 제작 규칙: ${RESPONSE_TYPE_RULES[responseType]}
- responseConfig에서 사용하지 않는 필드는 생략하거나 빈 배열로 두세요.
- 답변 UI 형식을 맞추기 위해 캐릭터와 무관한 질문을 만들면 안 됩니다. 같은 미확인 Hook을 이 UI에 자연스럽게 표현하세요.

질문 선택 절차:
1. 현재 캐릭터에서 아직 답이 없는 의문 후보를 2~4개 내부적으로 만드세요. 직전 답변을 한 번 더 파고들면 해석이 크게 갈리는 경우에는 같은 상황의 후속 후보도 포함하세요.
2. 각 후보가 오너 정정/보충, 프로필, 인터뷰 기억에 이미 답이 있는지 검사하고 있으면 제거하세요.
3. 남은 후보 중 한 문항으로 해석이 가장 많이 달라질 지점을 targetHook으로 고르세요.
4. 최근 답변에서 실제 미확인 정보가 이어지거나 기존 hypothesis와 충돌해 한 번 더 구분할 가치가 있으면 branch를 선택할 수 있습니다. 다른 Hook이 더 중요하면 pivot, 강해진 해석의 예외가 더 중요하면 counter를 고르세요.
5. 고른 Hook을 이번 responseType에 자연스럽게 맞춰 질문하세요.

길이 강제:
- question은 최대 120자이며 가능하면 70자 안팎을 목표로 합니다.
- 각 option은 최대 65자이며 50자 안팎을 목표로 합니다.
- 긴 배경설명이나 여러 조건을 겹치지 마세요.

선택지 품질:
- responseType에 options가 필요한 경우 예상 후보와 경쟁 후보가 함께 있어야 합니다.
- 어느 보기도 도덕적으로 더 좋은 답처럼 보이지 않게 합니다.
- 성격 라벨 대신 실제 말, 행동, 선택, 판단 기준으로 씁니다.
- responseType이 options=[]를 요구하면 반드시 빈 배열로 출력합니다.

출력 규칙:
- order=${order}
- responseType=${responseType}
- 출력 키는 order, category, mode, format, responseType, responseConfig, targetHook, hypothesis, question, options, allowCustom, rationale만 사용하세요.`,
    });

    return NextResponse.json({ done: false, question });
  } catch (error) {
    return apiError(error);
  }
}
