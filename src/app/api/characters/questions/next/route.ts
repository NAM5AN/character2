import { NextResponse } from 'next/server';
import { readJsonWithinBudget } from '@/lib/request-budget';
import { z } from 'zod';
import { characterDraftSchema, interviewAnswerSchema } from '@/lib/schemas/character';
import { interviewQuestionSchema, type InterviewQuestion } from '@/lib/schemas/question';
import { askOpenAIJson } from '@/lib/ai/openai';
import { QUESTION_INSTRUCTIONS } from '@/lib/ai/prompts';
import {
  QUESTION_EVIDENCE_INSTRUCTIONS,
  questionEvidenceIssues,
  questionEvidenceSources,
} from '@/lib/question-evidence';
import { lenientArray } from '@/lib/ai/lenient';
import { repairGeneratedQuestions } from '@/lib/question-repair';
import { withAiUsageContext, logGenRetry } from '@/lib/ai/usage';
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
  relationship: 4,
  conflict: 5,
  inner: 6,
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
  relationship_matrix: '하나의 동일한 상황을 관계가 다른 상대에게 적용해 비교하게 하세요. options=[]이고 responseConfig.rows에는 2~4개의 관계 상대/조건을 넣으세요. responseConfig.rowOptions에는 rows의 각 문자열을 키로 사용해 각 상대/조건마다 정확히 4개의 선택지를 따로 만드세요. 네 보기는 반드시 그 행의 상대에게 실제로 할 수 있는 자연스러운 답이어야 하며, 공통 질문이 묻는 행동 종류와 문장 형태를 그대로 따라야 합니다. 질문이 “어떻게 답할까?”라면 네 보기 모두 캐릭터가 그 상대에게 직접 할 대사여야 하고, 질문이 “어떻게 행동할까?”라면 네 보기 모두 캐릭터의 행동이어야 합니다. 상대가 하는 말이나 다른 주체의 행동을 섞지 마세요. 질문 문장 + 해당 row + 각 option을 이어 읽었을 때 어색하거나 전제가 충돌하면 그 보기는 다시 쓰세요. 행마다 관계 특성 때문에 실제로 달라질 수 있는 반응을 구성하고, 모든 행에 같은 네 보기를 그대로 복사하지 마세요. 새 문항에서는 columns=[]로 두세요. 직접 입력 보기는 UI가 별도로 붙이므로 rowOptions 안에 “직접 입력”, “기타” 같은 항목을 넣지 마세요.',
  inner_outer: '속으로 가장 먼저 드는 생각과 실제로 겉으로 보이는 행동을 따로 적게 하세요. options=[]이고 responseConfig.prompt2에 두 번째 항목을 넣으세요.',
  temporal_compare: '같은 사건에 대한 서로 다른 두 시점의 반응을 비교합니다. responseConfig.leftLabel/rightLabel에 두 시점을 넣으세요. 첫 시점에 자연스러운 선택지 정확히 4개를 options에, 두 번째 시점에 자연스러운 별도 선택지 정확히 4개를 responseConfig.options2에 만드세요. 각 목록은 자기 시점의 정보·감정·관계 변화까지 반영해야 하며, 두 시점에 같은 네 보기를 그대로 복사하면 실패입니다. 시간이 지난 뒤에는 이미 알게 된 사실이나 지나간 행동을 다시 처음처럼 묻는 선택지를 넣지 마세요. 두 목록 내부 선택지는 서로 달라야 하고, 직접 입력/기타 항목은 넣지 마세요. 직접 입력은 UI가 각 시점에 별도로 제공합니다.',
  condition_followup: '기본 상황을 제시하고 options(3~5개)로 한 번 고르게 한 뒤, 조건 하나가 바뀐 상황을 responseConfig.prompt2에 두 번째 질문으로 넣고, 그 바뀐 상황에 실제로 어울리는 별도의 선택지를 responseConfig.options2(3~5개)에 넣으세요. options와 options2는 각각 자기 상황에서 자연스럽고 서로 구별되는 반응이어야 하며, 두 목록이 같을 필요는 없습니다. 바뀐 조건 때문에 기본 보기가 어색해지는 상황이라면 options2는 그 조건에 맞는 새 반응들로 다시 구성하고 기본 보기를 그대로 재사용하지 마세요. 두 목록 모두 어느 답이 더 도덕적으로 좋아 보이지 않게 만드세요. 기본 질문은 특정 행동을 미리 전제하지 말고 열린 상황으로 두세요.',
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

function makeBatchSchema(specs: Array<{order:number;responseType:ResponseType}>, evidenceSources: string[]) {
  const specMap = new Map(specs.map(spec => [spec.order, spec.responseType]));
  // 모델이 questions 를 배열이 아니라 JSON 문자열로 뱉는 실패가 관측됐다. 내용은 멀쩡하므로
  // 배열로 펴서 받는다(내용이 비면 평소대로 검증에서 걸린다).
  const validated = z.object({questions:lenientArray(z.array(interviewQuestionSchema).length(specs.length))}).superRefine((value,ctx)=>{
    const seenOrders = new Set<number>();
    const seenHooks = new Set<string>();
    value.questions.forEach((question,index)=>{
      if(seenOrders.has(question.order)) ctx.addIssue({code:'custom',path:['questions',index,'order'],message:'문항 번호가 중복되었습니다.'});
      seenOrders.add(question.order);
      const expectedType = specMap.get(question.order);
      if(!expectedType) ctx.addIssue({code:'custom',path:['questions',index,'order'],message:'요청하지 않은 문항 번호입니다.'});
      else if(question.responseType!==expectedType) ctx.addIssue({code:'custom',path:['questions',index,'responseType'],message:`responseType은 ${expectedType}여야 합니다.`});

      for (const issue of questionEvidenceIssues(question, evidenceSources)) {
        ctx.addIssue({code:'custom',path:['questions',index,...issue.path],message:issue.message});
      }

      if(question.responseType==='dialogue_choice'){
        const speaker=question.responseConfig.prompt2;
        if(speaker!=='speaker:character'&&speaker!=='speaker:counterparty'){
          ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','prompt2'],message:'dialogue_choice는 speaker:character 또는 speaker:counterparty로 화자를 명시해야 합니다.'});
        }
      }
      if(question.responseType==='relationship_matrix'){
        const rows=question.responseConfig.rows;
        const rowOptions=question.responseConfig.rowOptions||{};
        if(question.responseConfig.columns.length){
          ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','columns'],message:'새 관계별 반응형은 columns를 비우고 rowOptions만 사용하세요.'});
        }
        const normalizedSets:string[]=[];
        for(const row of rows){
          const choices=rowOptions[row]||[];
          if(choices.length!==4){
            ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','rowOptions',row],message:`"${row}"의 AI 선택지는 정확히 4개여야 합니다.`});
            continue;
          }
          if(new Set(choices.map(choice=>choice.trim())).size!==4){
            ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','rowOptions',row],message:`"${row}"의 4개 선택지는 서로 달라야 합니다.`});
          }
          if(choices.some(choice=>/직접\s*입력|기타/u.test(choice))){
            ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','rowOptions',row],message:'직접 입력/기타 보기는 UI가 따로 제공하므로 AI 선택지에 넣지 마세요.'});
          }
          normalizedSets.push(choices.map(choice=>choice.trim()).sort().join('\u0001'));
        }
        if(normalizedSets.length>1&&new Set(normalizedSets).size===1){
          ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','rowOptions'],message:'관계별 반응형에서 모든 상대에게 완전히 같은 보기 4개를 복사하지 마세요.'});
        }
      }
      if(question.responseType==='temporal_compare'){
        const first=question.options.map(choice=>choice.trim());
        const second=(question.responseConfig.options2||[]).map(choice=>choice.trim());
        if(first.length!==4) ctx.addIssue({code:'custom',path:['questions',index,'options'],message:'시간 비교형의 첫 시점 선택지는 정확히 4개여야 합니다.'});
        if(second.length!==4) ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','options2'],message:'시간 비교형의 두 번째 시점 선택지는 정확히 4개여야 합니다.'});
        if(new Set(first).size!==first.length) ctx.addIssue({code:'custom',path:['questions',index,'options'],message:'첫 시점 선택지는 서로 달라야 합니다.'});
        if(new Set(second).size!==second.length) ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','options2'],message:'두 번째 시점 선택지는 서로 달라야 합니다.'});
        if([...first,...second].some(choice=>/직접\s*입력|기타/u.test(choice))) ctx.addIssue({code:'custom',path:['questions',index],message:'직접 입력/기타 보기는 UI가 별도로 제공하므로 AI 선택지에 넣지 마세요.'});
        if(first.length===4&&second.length===4&&first.slice().sort().join('\u0001')===second.slice().sort().join('\u0001')){
          ctx.addIssue({code:'custom',path:['questions',index,'responseConfig','options2'],message:'두 시점에 완전히 같은 보기 4개를 복사하지 마세요. 각 시점에 맞게 다시 구성하세요.'});
        }
      }
      const hook=question.targetHook.trim().toLowerCase();
      if(seenHooks.has(hook)) ctx.addIssue({code:'custom',path:['questions',index,'targetHook'],message:'같은 targetHook을 한 배치에서 반복하지 마세요.'});
      seenHooks.add(hook);
    });
    for(const spec of specs) if(!seenOrders.has(spec.order)) ctx.addIssue({code:'custom',path:['questions'],message:`${spec.order}번 문항이 빠졌습니다.`});
  });

  // 검증 전에, 질문 내용을 바꾸지 않고 고칠 수 있는 위반(빈 척도 라벨, UI가 이미 주는
  // "기타" 보기 중복, 검증 못 하는 evidence)만 보정한다. 이 위반들 때문에 문항 전체를
  // 다른 모델로 다시 만드는 일이 없어져서 다음 질문이 그만큼 빨리 나온다.
  // 내용이 부실한 위반은 여기서 손대지 않으므로 기존처럼 재생성된다.
  return z.preprocess(value=>{
    try{
      const repaired=repairGeneratedQuestions(value,specs,evidenceSources);
      if(repaired)logGenRetry('REPAIR_QUESTION_FORMAT',`문항 ${repaired}개 자동 보정(재생성 없음)`);
    }catch{/* 보정 실패는 무시하고 원본 그대로 검증한다 */}
    return value;
  },validated);
}

export async function POST(request: Request) {
  try {
    await assertRateLimit('question_batch', 30, 60);
    // 예산 검사를 거친 본문. 아래 보정 로직은 스키마 검증 전 원본을 손봐야 해서
    // 느슨한 레코드로 다룬다(검증은 바로 뒤 requestSchema.parse 가 담당).
    const raw = await readJsonWithinBudget(request) as Record<string, unknown>;
    if (raw && Array.isArray(raw.plannedQuestions)) {
      for (const planned of raw.plannedQuestions) {
        if (planned?.responseType !== 'condition_followup') continue;
        const rc = planned.responseConfig;
        if (rc && (!Array.isArray(rc.options2) || rc.options2.length < 3) && Array.isArray(planned.options)) {
          rc.options2 = planned.options;
        }
      }
    }
    const body = requestSchema.parse(raw);
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

    // 첫 배치는 오너 검수 결과를 쓰지 않고 프로필에 사실로 적힌 것만 근거로 삼는다.
    // 검수에 의존하지 않으므로 오너가 검수를 마치기 전에 미리 만들어 둘 수 있고,
    // 검수를 어떻게 고치든 그 질문이 낡아지지 않는다.
    const profileOnly = startOrder === 1;

    const evidenceSources = questionEvidenceSources({
      publicProfile: body.draft.basicProfile.profileText,
      secretProfile: body.draft.basicProfile.secretProfileText,
      ownerReview: profileOnly ? [] : body.draft.aiInferences.map(item => item.ownerFeedback || '').filter(Boolean),
      answers: body.answers.map(item => ({question:item.question,answer:item.answer,reason:item.reason})),
    });

    const compactDraft = {
      basicProfile: body.draft.basicProfile,
      traits: body.draft.traits,
      relationshipTraits: body.draft.relationshipTraits,
      confirmedFacts: body.draft.confirmedFacts,
      confirmedInferences: profileOnly ? [] : confirmedInferences,
      ownerClarifiedAmbiguities: profileOnly ? [] : ownerClarifiedAmbiguities,
      unresolvedAmbiguities: profileOnly ? [] : unresolvedAmbiguities,
      ownerCorrections: profileOnly ? [] : ownerCorrections,
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
    const priorityCategories = Object.entries(CATEGORY_TARGETS)
      .filter(([category,target])=>(categoryCounts[category] ?? 0) < target)
      .sort(([categoryA,targetA],[categoryB,targetB])=>{
        const coverageA=(categoryCounts[categoryA] ?? 0) / targetA;
        const coverageB=(categoryCounts[categoryB] ?? 0) / targetB;
        if(coverageA!==coverageB) return coverageA-coverageB;
        return targetB-targetA;
      })
      .slice(0,2)
      .map(([category])=>category);
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

    const batchSchema = makeBatchSchema(specs, evidenceSources);
    const phase = startOrder <= 6 ? 'explore' : startOrder <= 14 ? 'mixed' : 'deep';
    const lastMode = history.at(-1)?.mode || '';
    const justDugDeeper = lastMode === 'branch' || lastMode === 'counter';
    const interviewStrategy = phase === 'explore'
      ? 'explore'
      : justDugDeeper
        ? 'pivot'
        : phase === 'mixed'
          ? 'followup'
          : 'revisit';
    const strategyInstruction = interviewStrategy === 'explore'
      ? `- 지금은 탐색 단계입니다. 아직 충분히 다루지 않은 캐릭터 고유 Hook을 우선하세요.
- 직전 답변의 후속 질문을 반드시 만들 필요는 없습니다.
- 단, 직전 답변에서 캐릭터 해석을 크게 바꿀 새로운 모순·예외·조건이 나타났다면 1회 파고들 수 있습니다.
- 배치가 여러 문항이면 서로 다른 Hook을 다루세요.`
      : interviewStrategy === 'followup'
        ? `- 이전 실제 답변에서 새롭게 드러난 조건·예외·모순·우선순위 중 정보가치가 높은 것 하나를 한 단계 더 확인하는 질문을 우선 검토하세요.
- 이미 확인한 답을 상황만 바꿔 반복해서 묻지는 마세요.
- 파고들 가치가 충분하지 않다면 새 Hook으로 pivot해도 됩니다.
- 배치가 여러 문항이면 파고들기는 최대 1개만 사용하고 나머지는 다른 Hook으로 이동하세요.`
        : interviewStrategy === 'pivot'
          ? `- 직전 문항에서 이미 한 단계 파고들었습니다. 이번에는 같은 핵심 주제를 계속 추적하지 말고 아직 덜 본 캐릭터 고유 Hook으로 이동하세요.
- 이전 답변은 새 질문의 맥락으로 활용할 수 있지만 직전 질문의 단순 후속편을 만들지는 마세요.
- 배치가 여러 문항이면 각 문항은 서로 다른 Hook을 다루세요.`
          : `- 지금은 심화 단계입니다. 지금까지의 문답 전체에서 정보가치가 높았던 Hook을 다시 검토하세요.
- 직전 답변만 따라가지 말고 3~10문항 전에 나온 중요한 답도 필요하면 다시 연결할 수 있습니다.
- 앞서 얻은 해석의 예외·임계점·모순·숨은 우선순위를 확인하세요.
- 같은 Hook을 계속 연속 추적하기보다 여러 핵심 Hook을 번갈아 깊게 검증하세요.
- 배치가 여러 문항이면 각 문항은 서로 다른 핵심 Hook을 다루세요.`;
    const usedHooks = coveredQuestions.map(item=>item.targetHook).filter(Boolean);
    const specText = specs.map(spec=>({
      order:spec.order,
      responseType:spec.responseType,
      label:RESPONSE_TYPE_LABELS[spec.responseType],
      rule:RESPONSE_TYPE_RULES[spec.responseType],
    }));

    const generated = await withAiUsageContext({sessionId:body.draft.usageSessionId,characterName:body.draft.basicProfile.name,stage:`questions_${startOrder}_${startOrder+batchCount-1}`},()=>askOpenAIJson({
      instructions: `${QUESTION_INSTRUCTIONS}\
\
${QUESTION_EVIDENCE_INSTRUCTIONS}\
\
이번에는 한 문항이 아니라 최대 5문항의 다음 배치를 한 번에 만듭니다. questions 배열만 가진 JSON 객체를 출력하세요. 같은 배치 안의 문항은 서로의 답을 아직 모른다는 전제로 독립적으로 성립해야 합니다.`,
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

이번 문항의 인터뷰 전략:
${strategyInstruction}

공통 진행 규칙:
- 이전 답변의 문장을 질문에 억지로 복사하지 말고, 파고들 때도 그 답 때문에 새로 생긴 '아직 답이 없는 다음 의문'을 물으세요.
- 이전 답변과 프로필 예상이 어긋났다면 그 차이를 가르는 질문은 정보가치가 높은 후보입니다.
- 이미 답한 내용을 상황만 바꿔 재확인하면 실패입니다.
- 파고들기는 이전 질문을 반복하는 것이 아니라 아직 밝혀지지 않은 새로운 정보를 얻어야 합니다.
- 한 배치 안에서 targetHook을 반복하지 말고 서로 다른 미확인 지점을 다루세요.
- 이 배치의 앞 문항에 사용자가 어떻게 답할지 아직 모르므로, 2번째 이후 문항이 앞 문항의 특정 답을 전제로 하면 안 됩니다.

현재 다양성 현황:
- category counts: ${JSON.stringify(categoryCounts)}
- category 목표: ${JSON.stringify(CATEGORY_TARGETS)}
- 우선 검토 category: ${JSON.stringify(priorityCategories)}
- format counts: ${JSON.stringify(formatCounts)}
- responseType counts: ${JSON.stringify(responseTypeCounts)}
- 캐릭터 근거와 정보가치가 비슷한 질문 후보가 여러 개라면 우선 검토 category에 속하는 질문을 먼저 선택하세요.
- 이미 충분히 다룬 category를 습관적으로 반복하지 마세요.
- category가 달라도 사실상 같은 심리나 같은 사건을 반복해서 묻는다면 다양성이 확보된 것이 아닙니다.
- 단, 목표 숫자만 맞추려고 캐릭터와 무관하거나 근거가 약한 질문을 만들지는 마세요.
- scenario는 전체 최대 5~6회, free_response는 전체 1~2회만 사용하세요.

서버가 고정한 문항별 UI 형식:
${JSON.stringify(specText)}
- 각 문항은 자신의 order와 responseType을 정확히 지키세요.
- relationship_matrix는 공통 질문 하나와 각 row를 함께 읽었을 때 그 row의 네 보기가 모두 직접적인 답이 되어야 합니다. 질문의 주체·시점·행동 종류를 행마다 바꾸지 말고, 각 row의 관계 특성 때문에 달라지는 부분만 보기 내용에 반영하세요.
- temporal_compare는 첫 시점 options 4개와 두 번째 시점 responseConfig.options2 4개를 각각 따로 만드세요. 두 번째 시점에서 이미 지나간 정보나 행동을 첫 시점처럼 반복하는 보기는 금지하며, 시간 경과로 달라진 맥락에 맞춰 선택지를 새로 구성하세요. 두 목록을 완전히 같게 만들지 마세요.
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
- 각 문항 키는 order, category, mode, format, responseType, responseConfig, targetHook, hypothesis, question, options, allowCustom, evidence, rationale만 사용하세요.
- evidence는 반드시 1~2개의 실제 연속 원문 발췌를 넣으세요.`,
    }));

    const questions = generated.questions.slice().sort((a,b)=>a.order-b.order) as InterviewQuestion[];
    return NextResponse.json({done:false,questions,...(questions.length===1?{question:questions[0]}:{})});
  } catch (error) {
    return apiError(error);
  }
}
