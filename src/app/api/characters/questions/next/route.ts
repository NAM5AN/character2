import { NextResponse } from 'next/server';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema, type InterviewQuestion } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { QUESTION_INSTRUCTIONS } from '@/lib/ai/prompts';
import { withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';

const requestSchema = z.object({
  draft: characterDraftSchema,
  answers: z.array(interviewAnswerSchema).max(20),
  plannedQuestions: z.array(interviewQuestionSchema).max(20).optional().default([]),
  startOrder: z.number().int().min(1).max(20).optional(),
  batchSize: z.number().int().min(1).max(5).optional().default(1),
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
  dialogue_choice: '대사·상대 반응 고르기',
  bipolar_scale: 'A/B 사이 5단계 성향 선택',
  ranking: '순위 매기기',
  multi_select: '복수 선택',
  least_likely: '가장 하지 않을 것 고르기',
  slider: '가능성 점수 슬라이더',
  relationship_matrix: '관계별 반응표',
  inner_outer: '속마음과 실제 행동 분리',
  temporal_compare: '시간에 따른 반응 비교',
  condition_followup: '조건이 바뀌었을 때 비교',
  owner_meta: '오너 메타 질문',
} as const;

type ResponseType = keyof typeof RESPONSE_TYPE_LABELS;
const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];

const RESPONSE_TYPE_RULES: Record<ResponseType, string> = {
  fill_blank: '질문 안에 ________ 빈칸을 하나 넣으세요. options는 서로 다른 3~5개 후보를 만들고 allowCustom=true로 하세요.',
  sentence_continue: '캐릭터의 생각이나 판단을 이어 쓰게 하는 미완성 문장으로 만드세요. options=[]이고 allowCustom=true입니다.',
  dialogue_choice: '두 하위형 중 정보가치가 높은 쪽을 하나 고르세요. ① responseConfig.prompt2="speaker:character": 캐릭터가 실제로 할 첫마디를 묻고 options에는 캐릭터의 대사 3~5개만 넣습니다. ② responseConfig.prompt2="speaker:counterparty": 캐릭터의 말·행동을 받은 상대나 제3자가 가장 먼저 할 말을 묻고 options에는 상대의 대사 3~5개만 넣습니다. 상대 반응형은 캐릭터가 타인에게 주는 인상, 매력, 부담, 긴장, 오해 같은 제3자 시점 정보를 얻을 가치가 있을 때 적극 사용하세요. 두 화자의 대사를 한 문항에 섞으면 실패입니다. allowCustom=true입니다.',
  bipolar_scale: '서로 반대되는 두 판단 A/B를 responseConfig.leftLabel/rightLabel에 짧고 대등한 문장으로 넣으세요. 사용자는 A에 가까움 / 약간 A / 중간 / 약간 B / B에 가까움의 5단계 중 하나를 클릭합니다. options=[]입니다. 일반 5지선다처럼 서로 다른 다섯 행동을 만들지 마세요.',
  ranking: '서로 다른 가치·판단·행동 기준 4~5개를 options에 넣어 전부 순위 매기게 하세요.',
  multi_select: '동시에 일어날 수 있는 행동이나 반응 4~6개를 options에 넣으세요. 필요하면 responseConfig.maxSelections에 2~4를 넣으세요.',
  least_likely: 'options 3~5개 중 이 캐릭터가 가장 하지 않을 것 하나를 고르게 하세요.',
  slider: '한 가지 가능성이나 강도를 0~100 점수로 고르게 하세요. options=[]이고 responseConfig.minLabel/maxLabel에 양 끝 상태를 넣으세요. A/B 비교형으로 만들지 마세요.',
  relationship_matrix: '같은 상황을 관계가 다른 상대에게 적용해 비교하게 하세요. options=[]이고 responseConfig.rows에는 2~4개의 관계 상대, columns에는 2~4개의 짧은 반응을 넣으세요.',
  inner_outer: '속으로 가장 먼저 드는 생각과 실제로 겉으로 보이는 행동을 따로 적게 하세요. options=[]이고 responseConfig.prompt2에 두 번째 항목을 넣으세요.',
  temporal_compare: '같은 사건에 대한 서로 다른 두 시점의 반응을 비교합니다. options는 두 시점 모두에서 공통으로 선택 가능한 3~5개 반응이고 responseConfig.leftLabel/rightLabel에 두 시점을 넣으세요.',
  condition_followup: '기본 상황에서 한 번 고른 뒤, 같은 상황에 조건 하나만 더해졌을 때 다시 고르게 합니다. 핵심 제약: 바뀐 조건은 전제를 뒤집지 말고 같은 판단 축을 유지하는 변주여야 합니다(예: 상대가 더 급해짐·대가를 제시함·부탁이 더 커짐·지켜보는 사람이 생김·관계가 더 가깝거나 먼 상대임 등 강도나 조건의 변화). 기본 상황에서 성립하던 선택이 바뀐 조건에서 무의미해지거나 자기모순이 되면 실패입니다. 특히 "도와주려는" 전제를 "거절당함"처럼 뒤집어서 보기 대부분이 헛돌게 만들지 마세요. options는 3~5개의 공통 반응이며 기본 상황과 바뀐 조건 둘 다에서 각각 자연스럽고 서로 구별되게 성립해야 합니다. 기본 질문은 특정 행동을 미리 전제하지 말고("~하려 할 때"처럼 이미 그 행동을 하는 것으로 못박지 말고) 열린 상황으로 두세요. responseConfig.prompt2에는 바뀐 조건을 포함한 두 번째 질문 문장을 넣으세요.',
  owner_meta: '캐릭터를 오래 본 오너만 답하기 좋은 메타 질문을 만드세요. options는 3~5개 후보이며 allowCustom=true입니다.',
};

function contextString(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return '';
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : '';
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
  const pool = missing.length ? missing : RESPONSE_TYPES.filter(type => type !== lastType && counts[type] < 3);
  const candidates = pool.length ? pool : RESPONSE_TYPES.filter(type => type !== lastType);
  const seed = hashString(`${args.name}:${args.order}:${args.history.map(x => x.targetHook).join('|')}`);
  return candidates[seed % candidates.length];
}

function buildHistory(answers: z.infer<typeof interviewAnswerSchema>[]) {
  return answers.slice().sort((a,b)=>a.order-b.order).map(answer => {
    const format = contextString(answer.branchContext, 'format');
    const storedSource = contextString(answer.branchContext, 'answerSource');
    const answerSource = storedSource === 'choice' || storedSource === 'custom' || storedSource === 'structured'
      ? storedSource
      : format === 'free_response' ? 'custom' : 'unknown';
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
}

function makeBatchSchema(specs: Array<{order:number;responseType:ResponseType}>) {
  const specMap = new Map(specs.map(spec => [spec.order, spec.responseType]));
  return z.object({questions:z.array(interviewQuestionSchema).length(specs.length)}).superRefine((value,ctx)=>{
    const seenOrders = new Set<number>();
    const seenHooks = new Set<string>();
    value.questions.forEach((question,index)=>{
      if(seenOrders.has(question.order)) ctx.addIssue({code:'custom',path:['questions',index,'order'],message:'문항 번호가 중복되었습니다.'});
      seenOrders.add(question.order);
      const expectedType = specMap.get(question.order);
      if(!expectedType) ctx.addIssue({code:'custom',path:['questions',index,'order'],message:'요청하지 않은 문항 번호입니다.'});
      else if(question.responseType!==expectedType) ctx.addIssue({code:'custom',path:['questions',index,'responseType'],message:`responseType은 ${expectedType}여야 합니다.`});
      if(question.responseType==='dialogue_choice'){
        const speaker=question.responseConfig.prompt2;
        if(speaker!=='speaker:character'&&speaker!=='speaker:counterparty'){
          ctx.addIssue({
            code:'custom',
            path:['questions',index,'responseConfig','prompt2'],
            message:'dialogue_choice는 speaker:character 또는 speaker:counterparty로 화자를 명시해야 합니다.',
          });
        }
      }
      const hook=question.targetHook.trim().toLowerCase();
      if(seenHooks.has(hook)) ctx.addIssue({code:'custom',path:['questions',index,'targetHook'],message:'같은 targetHook을 한 배치에서 반복하지 마세요.'});
      seenHooks.add(hook);
    });
    for(const spec of specs) if(!seenOrders.has(spec.order)) ctx.addIssue({code:'custom',path:['questions'],message:`${spec.order}번 문항이 빠졌습니다.`});
  });
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('question_batch', 30, 60);
    const body = requestSchema.parse(await request.json());
    const answeredOrders = new Set(body.answers.map(answer=>answer.order));
    const history = buildHistory(body.answers);
    const startOrder = body.startOrder ?? Math.min(20, body.answers.length + 1);
    if(startOrder>20) return NextResponse.json({done:true,questions:[]});
    const batchCount = Math.min(body.batchSize, 21 - startOrder);

    const unansweredPlanned = body.plannedQuestions
      .filter(question=>question.order < startOrder && !answeredOrders.has(question.order))
      .sort((a,b)=>a.order-b.order);

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

    const recentHistory = history.slice(-5);
    const olderHistory = history.slice(0, Math.max(0, history.length - 5)).map(item=>({
      order:item.order,
      category:item.category,
      responseType:item.responseType,
      targetHook:item.targetHook,
      answer:item.answer,
      ...(item.reason?{reason:item.reason}:{}),
    }));

    const coveredQuestions = [
      ...history.map(item=>({category:item.category,format:item.format,responseType:item.responseType,targetHook:item.targetHook})),
      ...unansweredPlanned.map(item=>({category:item.category,format:item.format,responseType:item.responseType,targetHook:item.targetHook})),
    ];
    const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_TARGETS).map(category=>[category,coveredQuestions.filter(item=>item.category===category).length]));
    const formatCounts = Object.fromEntries(Object.keys(FORMAT_LABELS).map(format=>[format,coveredQuestions.filter(item=>item.format===format).length]));
    const responseTypeCounts = Object.fromEntries(RESPONSE_TYPES.map(type=>[type,coveredQuestions.filter(item=>item.responseType===type).length]));

    const virtualHistory = [
      ...history.map(item=>({responseType:item.responseType,targetHook:item.targetHook})),
      ...unansweredPlanned.map(item=>({responseType:item.responseType,targetHook:item.targetHook})),
    ];
    const specs:Array<{order:number;responseType:ResponseType}> = [];
    for(let offset=0;offset<batchCount;offset+=1){
      const order=startOrder+offset;
      const responseType=chooseResponseType({name:body.draft.basicProfile.name,order,history:virtualHistory});
      specs.push({order,responseType});
      virtualHistory.push({responseType,targetHook:`planned-${order}`});
    }

    const batchSchema = makeBatchSchema(specs);
    const adaptiveTarget = history.length ? Math.min(batchCount, Math.max(1, Math.ceil(batchCount * .6))) : 0;
    const usedHooks = coveredQuestions.map(item=>item.targetHook).filter(Boolean);
    const specText = specs.map(spec=>({
      order:spec.order,
      responseType:spec.responseType,
      label:RESPONSE_TYPE_LABELS[spec.responseType],
      rule:RESPONSE_TYPE_RULES[spec.responseType],
    }));

    const generated = await withAiUsageContext({sessionId:body.draft.usageSessionId,stage:`questions_${startOrder}_${startOrder+batchCount-1}`},()=>askOpenAIJson({
      instructions: `${QUESTION_INSTRUCTIONS}\n\n이번에는 한 문항이 아니라 최대 5문항의 다음 배치를 한 번에 만듭니다. questions 배열만 가진 JSON 객체를 출력하세요. 같은 배치 안의 문항은 서로의 답을 아직 모른다는 전제로 독립적으로 성립해야 합니다.`,
      schema: batchSchema,
      maxOutputTokens: Math.max(2200, batchCount * 1250),
      input: `생성할 문항 배치: ${startOrder}~${startOrder+batchCount-1} / 20

캐릭터 데이터:
${JSON.stringify(compactDraft)}

오너 직접 확정 정보 규칙:
- ownerCorrections와 ownerClarifiedAmbiguities.ownerFeedback은 이미 답이 끝난 CLOSED KNOWLEDGE입니다. 그대로 다시 묻지 마세요.
- confirmedInferences는 오너가 맞다고 확인한 해석입니다.
- unresolvedAmbiguities는 약한 참고만 가능합니다.
- 프로필에 없는 심리 동기나 과거를 질문의 사실 전제로 새로 만들지 마세요.

지금까지의 인터뷰:
- 최근 5문답 전체: ${JSON.stringify(recentHistory)}
- 이전 문답 압축 기억: ${JSON.stringify(olderHistory)}
- 이미 생성됐지만 아직 답하지 않은 앞선 문항: ${JSON.stringify(unansweredPlanned.map(q=>({order:q.order,question:q.question,targetHook:q.targetHook,responseType:q.responseType})))}
- 이미 사용한 targetHook: ${JSON.stringify(usedHooks)}

이번 배치의 적응성 규칙 — 매우 중요:
${adaptiveTarget>0?`- ${batchCount}개 중 최소 ${adaptiveTarget}개는 최근 실제 답변이나 이유에서 새로 드러난 조건, 예외, 우선순위, 모순을 출발점으로 삼으세요.`:'- 첫 배치이므로 프로필과 오너 검수에서 정보가치가 높은 미확인 지점을 고르세요.'}
- 이전 답변의 문장을 질문에 억지로 복사하지 말고, 그 답 때문에 새로 생긴 '아직 답이 없는 다음 의문'을 물으세요.
- 이전 답변과 프로필 예상이 어긋났다면 그 차이를 가르는 질문을 우선 검토하세요.
- 이미 답한 내용을 상황만 바꿔 재확인하면 실패입니다.
- 한 배치 안에서 targetHook을 반복하지 말고 서로 다른 미확인 지점을 다루세요.
- 이 배치의 앞 문항에 사용자가 어떻게 답할지 아직 모르므로, 2번째 이후 문항이 앞 문항의 특정 답을 전제로 하면 안 됩니다.

현재 다양성 현황:
- category counts: ${JSON.stringify(categoryCounts)}
- format counts: ${JSON.stringify(formatCounts)}
- responseType counts: ${JSON.stringify(responseTypeCounts)}
- category 목표 참고: ${JSON.stringify(CATEGORY_TARGETS)}
- scenario는 전체 최대 5~6회, free_response는 전체 1~2회만 사용하세요.

서버가 고정한 문항별 UI 형식:
${JSON.stringify(specText)}
- 각 문항은 자신의 order와 responseType을 정확히 지키세요.
- dialogue_choice는 캐릭터 본인의 대사를 묻는 형식과 상대/제3자의 대사를 묻는 형식을 모두 사용할 수 있습니다. responseConfig.prompt2로 화자를 명시하고 question과 options의 화자를 반드시 일치시키세요.
- 상대 반응형을 만들 때는 캐릭터의 실제 말·행동이 타인에게 어떤 인상이나 긴장을 만드는지 확인할 수 있도록 서로 다른 반응 후보를 두세요. 전부 호의적이거나 전부 적대적인 보기만 두지 마세요.
- bipolar_scale은 서로 반대되는 A/B 두 문장 사이에서 5단계 중 하나를 클릭하는 유형입니다. 다섯 개의 서로 다른 행동 보기로 만들지 마세요.
- slider는 한 가지 가능성을 0~100 점수로 매기는 별도 유형입니다. 둘을 섞지 마세요.

질문 품질:
- 다른 캐릭터에게 이름만 바꿔도 그대로 쓸 수 있는 질문을 피하세요.
- 중학생도 한 번 읽고 이해할 쉬운 한국어를 사용하세요.
- 질문은 가능하면 70자 안팎, 최대 120자입니다.
- 한 질문에는 판단 하나만 묻고 조건을 여러 겹 쌓지 마세요.
- 선택지가 필요한 형식은 예상 후보와 경쟁 후보를 함께 두되 어느 답이 더 도덕적으로 좋아 보이지 않게 하세요.
- 성격 라벨 대신 실제 말, 행동, 선택, 판단 기준을 쓰세요.

출력 형식:
- 최상위 키는 questions 하나만 사용하세요.
- questions에는 정확히 ${batchCount}개를 넣으세요.
- 각 문항 키는 order, category, mode, format, responseType, responseConfig, targetHook, hypothesis, question, options, allowCustom, rationale만 사용하세요.`,
    }));

    const questions = generated.questions.slice().sort((a,b)=>a.order-b.order) as InterviewQuestion[];
    return NextResponse.json({done:false,questions,...(questions.length===1?{question:questions[0]}:{})});
  } catch (error) {
    return apiError(error);
  }
}
