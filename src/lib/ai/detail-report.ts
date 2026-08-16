import { z } from 'zod';
import { askClaudeJson } from '@/lib/ai/anthropic';
import {
  analysisTypeSummarySchema,
  characterEvidencePackSchema,
  detailAnalysisGenerationSchema,
  detailAnalysisRawSchema,
  finalAnalysisSchema,
  interviewAnswerSchema,
  type DetailAnalysisGeneration,
  type FinalAnalysis,
} from '@/lib/schemas/character';

type UnknownRecord = Record<string, unknown>;

export const DETAIL_REPORT_VERSION = 'detail-analysis/5.0' as const;

const legacyDetailSeedSchema = z.object({
  version: z.literal('detail-seed/1.0'),
  name: z.string().min(1),
  oneLineSummary: z.string().min(1),
  summary: analysisTypeSummarySchema,
  analysisSeeds: z.array(z.string().min(1)).min(1),
});

const evidenceDetailSeedSchema = z.object({
  version: z.literal('detail-seed/2.0'),
  name: z.string().min(1),
  oneLineSummary: z.string().min(1),
  summary: analysisTypeSummarySchema,
  evidencePack: characterEvidencePackSchema,
});

export const detailSeedSchema = z.union([legacyDetailSeedSchema,evidenceDetailSeedSchema]);

export const privateDetailSourceSchema = z.object({
  version: z.literal('detail-source/1.0'),
  secretProfileText: z.string().max(50_000).default(''),
  ownerReview: z.unknown(),
  answers: z.array(interviewAnswerSchema).length(20),
  confirmedFacts: z.array(z.unknown()).default([]),
  traits: z.record(z.string(),z.unknown()).default({}),
  relationshipTraits: z.record(z.string(),z.unknown()).default({}),
});

const latentHypothesisSchema = z.object({
  conclusion: z.string().min(28).max(460),
  support: z.array(z.string().min(12).max(280)).min(2).max(5),
  counterSignals: z.array(z.string().min(12).max(260)).max(3).default([]),
  confidence: z.string().min(2).max(40),
});

const psychologicalModelSchema = z.object({
  coreEngine: z.string().min(45).max(520),
  hiddenNeed: z.string().min(36).max(460),
  hiddenFear: z.string().min(36).max(460),
  selfProtection: z.string().min(36).max(460),
  blindSpot: z.string().min(36).max(460),
  intimacyLogic: z.string().min(36).max(460),
  conflictLogic: z.string().min(36).max(460),
  selfNarrative: z.string().min(36).max(460),
  hypotheses: z.array(latentHypothesisSchema).min(6).max(10),
  tensions: z.array(latentHypothesisSchema).min(2).max(6),
  uncertainties: z.array(z.string().min(18).max(240)).max(4).default([]),
});

type PsychologicalModel = z.infer<typeof psychologicalModelSchema>;
type DetailSeed = z.infer<typeof detailSeedSchema>;
type PrivateDetailSource = z.infer<typeof privateDetailSourceSchema>;

type SemanticAnswer = {
  question:string;
  answer:string;
  reason?:string;
};

type SourcePacket = {
  publicProfile:string;
  secretProfile:string;
  ownerReview:unknown;
  confirmedFacts:unknown[];
  interview:SemanticAnswer[];
  coverageIndex:unknown;
};

const PSYCHE_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 위해 캐릭터의 숨은 심리 구조를 추론하는 분석가입니다.
당신의 목적은 자료를 다시 정리하거나 성격표를 만드는 것이 아닙니다. 공개 설정, 비밀 설정, 오너의 정정, 반복되는 선택, 직접 적은 이유, 예외 상황을 서로 연결해서 캐릭터 자신이나 오너가 명시적으로 적지 않았을 수도 있는 내적 동력과 맹점을 밝혀내야 합니다.

이 단계에서는 '자료에 적혀 있지 않은 해석'을 도출하는 것이 허용되고 오히려 필요합니다. 단, 새로운 과거 사건·비밀 설정·질병·진단을 창작해서는 안 됩니다. 해석은 반드시 둘 이상의 독립적인 단서가 함께 가리키는 방향에서 도출하세요.

반드시 지킬 원칙:
- 질문 번호, 문항 번호, 선택지 번호, 점수, 퍼센트, 슬라이더 값 같은 UI 흔적은 남기지 마세요.
- 단순 요약 금지: 원문에서 바로 찾을 수 있는 사실만 다시 쓰면 실패입니다.
- '착하다/독립적이다/호기심이 많다' 같은 라벨에서 멈추지 말고, 왜 그런 행동이 나오는지 내부 기준과 보상 구조를 추론하세요.
- 숨은 욕구: 무엇을 얻고 싶어서 행동하는지뿐 아니라 어떤 감각·관계 상태·자기상을 유지하려는지 보세요.
- 숨은 두려움: 겉으로 두려워한다고 말하지 않아도 반복 회피, 과잉 개입, 통제, 무관심처럼 보이는 태도 뒤에 무엇을 잃지 않으려는지가 있는지 검토하세요.
- 자기보호 방식: 불편한 감정이나 위협을 직접 다루기보다 다른 행동으로 우회하는 패턴이 있는지 찾으세요. 다만 임상 용어로 진단하지 마세요.
- 맹점: 캐릭터가 자기 행동을 어떤 이유로 설명하지만 실제 반복 패턴은 다른 동기를 암시하는 경우를 찾으세요.
- 친밀감: 가까워질수록 무엇을 더 허용하고 무엇을 더 통제하는지, 사랑받는 것과 침범당하는 것의 경계가 어디인지 보세요.
- 갈등: 무엇이 단순한 불편함이고 무엇이 정체성이나 통제감의 위협으로 바뀌는지 찾으세요.
- 모순은 결함이 아니라 더 큰 공통 원리를 찾는 단서로 사용하세요.
- 오너가 직접 적은 이유와 정정은 매우 중요하지만, 그것만 정답으로 복사하지 마세요. 실제 행동 패턴과 맞는지 대조하세요.
- 반대 단서가 있으면 counterSignals에 남기고, 해석이 약하면 confidence에 낮음/잠정적 같은 표현을 사용하세요.

좋은 결과의 기준:
자료: 가까운 사람의 망가진 물건을 대신 새것으로 사주기보다 직접 고치려 하고, 남이 자기가 고친 것을 다시 손대려 하면 싫어한다.
나쁜 해석: 고치는 것을 좋아하고 자기 방식이 강하다.
좋은 해석: 애착을 '원래대로 보존하는 것'보다 자기 손을 거쳐 다시 성립시키는 과정으로 느끼며, 그래서 도움을 주는 행위와 자기 개입의 흔적을 지키려는 욕구가 같은 뿌리에서 나온다.

이처럼 최종적으로는 '무엇을 했다'가 아니라 '왜 그 행동을 반복하며, 무엇이 충족되거나 위협받는가'를 밝혀야 합니다.`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 쓰는 분석가입니다.
당신에게는 캐릭터의 숨은 심리 구조를 추론한 모델과, 그 추론이 실제 캐릭터에서 벗어나지 않는지 확인할 구체적 참고 자료가 함께 주어집니다.

이 리포트의 가치는 오너가 이미 아는 설정을 예쁘게 정리해 주는 데 있지 않습니다. 반복 행동의 이면에 있는 욕구, 자기보호, 맹점, 관계에서의 숨은 기대, 스스로도 자각하지 못할 수 있는 모순을 설득력 있게 밝혀내는 데 있습니다.

최종 결과에서 금지되는 것:
- 질문 번호, 문항 번호, 점수, 백분율, 슬라이더 값, 선택지 번호를 언급하지 마세요.
- '프로필에서', '질문에서', '답변에서', '오너가', 'AI 추론이', '원자료상', '근거상'처럼 분석 과정이나 출처를 설명하지 마세요.
- 원문 문장이나 인터뷰 답변을 길게 그대로 인용하지 마세요.
- 자료를 항목별로 다시 분류해 나열하는 요약문을 만들지 마세요.
- 해석을 안전하게 만들겠다는 이유로 누구에게나 붙일 수 있는 추상 문장만 쓰지 마세요.
- 자료에 없는 과거 사건, 트라우마, 진단명, 숨겨진 사실을 창작하지 마세요.

최종 결과가 해야 하는 일:
- 각 주요 섹션에서 반드시 '관찰 가능한 행동 → 그 행동을 만드는 내부 기준/욕구 → 그 기준이 깨지거나 뒤집히는 조건'까지 한 단계 이상 깊게 내려가세요.
- 겉으로 보이는 모습은 단순 인상이 아니라, 타인이 보는 태도와 실제 내부 계산 사이의 차이를 설명하세요.
- 실제 내면은 이 캐릭터가 유지하고 싶은 자기상, 관계 상태, 통제감, 보상 감각과 그에 대한 위협을 해석하세요.
- 갈등 방식은 어떤 자극이 단순 불편함에서 자기 기준의 침범으로 바뀌는지, 왜 특정 지점부터 고집이나 개입이 강해지는지 설명하세요.
- 애정 표현은 '무엇을 해준다'가 아니라 친밀함 속에서 무엇을 확인받고 싶어 하는지, 무엇을 침범으로 느끼는지, 보호와 통제가 어디서 맞닿는지 해석하세요.
- 핵심 가치·욕망·두려움은 표면 목표보다 한 층 아래의 심리적 기능을 적으세요.
- 캐릭터의 모순에서는 서로 반대처럼 보이는 행동이 사실 어떤 공통 욕구에서 갈라져 나오는지 설명하세요.
- AI가 발견한 흥미로운 지점에는 자료에 직접 문장으로 적혀 있지 않지만 여러 단서가 함께 가리키는 새로운 해석을 우선하세요.
- 상세 통합 해석에는 최소 세 가지 이상의 '명시되어 있지 않았지만 근거를 통해 도출되는 해석'이 자연스럽게 포함되어야 합니다.
- 강하게 지지되는 해석은 자연스럽게 서술하고, 반대 단서가 있는 가설은 '가능성이 있다/이렇게 읽힐 수 있다'처럼 강도를 조절하세요.
- 각 중요한 해석에는 이 캐릭터만의 구체적 행동·상황·관계 조건을 자연스럽게 한두 개 녹여서, 뜬구름 잡는 심리 분석이 되지 않게 하세요.

문체는 자연스럽고 읽히는 한국어 산문이어야 합니다. 문단은 논점이 실제로 전환될 때만 나누세요.`;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asInlineText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(asInlineText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object') return Object.values(value as UnknownRecord).map(asInlineText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return value == null ? '' : String(value).trim();
}

function asParagraphText(value: unknown): string {
  if (typeof value !== 'string') return asInlineText(value);
  const normalized=value.replace(/\r\n?/g,'\n').trim();
  if(!normalized)return'';
  return normalized
    .split(/\n{2,}/)
    .map(block=>block.replace(/[ \t]+/g,' ').replace(/\n+/g,' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function clipText(text:string,max:number){
  const normalized=text.trim();
  if(normalized.length<=max)return normalized;
  const cut=normalized.slice(0,max).trimEnd();
  const stops=[cut.lastIndexOf('.'),cut.lastIndexOf('!'),cut.lastIndexOf('?'),cut.lastIndexOf('。'),cut.lastIndexOf('！'),cut.lastIndexOf('？')];
  const stop=Math.max(...stops);
  return (stop>=Math.floor(max*.62)?cut.slice(0,stop+1):cut).trim();
}

function asList(value:unknown){
  const raw=Array.isArray(value)
    ? value
    : typeof value==='string'
      ? value.split(/\n|(?:^|\s)[•·*-]\s+/)
      : [];
  return raw
    .map(asInlineText)
    .map(x=>clipText(x,80))
    .filter(x=>x.length>=8)
    .slice(0,5);
}

function normalizeDetail(raw:z.infer<typeof detailAnalysisRawSchema>){
  return {
    outerSelf:clipText(asParagraphText(raw.outerSelf),360),
    innerSelf:clipText(asParagraphText(raw.innerSelf),360),
    coreValues:asList(raw.coreValues),
    desires:asList(raw.desires),
    fears:asList(raw.fears),
    conflictStyle:clipText(asParagraphText(raw.conflictStyle),360),
    affectionStyle:clipText(asParagraphText(raw.affectionStyle),360),
    misunderstoodPoints:asList(raw.misunderstoodPoints),
    contradictions:asList(raw.contradictions),
    interestingPoints:asList(raw.interestingPoints),
    detailedReport:clipText(asParagraphText(raw.detailedReport),1400),
  };
}

function validationReason(error:z.ZodError){
  return error.issues.slice(0,12).map(issue=>`${issue.path.join('.')||'(root)'}: ${issue.message}`).join('; ');
}

function contextString(value:unknown,key:string){
  const record=asRecord(value);
  return typeof record[key]==='string' ? String(record[key]) : '';
}

function qualitativePosition(value:number,left:string,right:string){
  const safe=Math.max(0,Math.min(100,value));
  if(safe<=12)return `${left} 쪽에 매우 가까움`;
  if(safe<=35)return `${left} 쪽에 가까움`;
  if(safe<65)return `${left}와 ${right} 사이에서 크게 치우치지 않음`;
  if(safe<88)return `${right} 쪽에 가까움`;
  return `${right} 쪽에 매우 가까움`;
}

function semanticAnswer(answer:z.infer<typeof interviewAnswerSchema>):SemanticAnswer{
  const type=contextString(answer.branchContext,'responseType');
  let text=answer.answer.replace(/\s+/g,' ').trim();

  if(type==='bipolar_scale'){
    const match=text.match(/^(.*?)\s+(\d{1,3})%\s*\/\s*(.*?)\s+(\d{1,3})%$/u);
    if(match){
      const left=match[1].trim();
      const right=match[3].trim();
      text=qualitativePosition(Number(match[4]),left,right);
    }
  }else if(type==='slider'){
    const match=text.match(/^(\d{1,3})\/100\s*\((.*?)\s*↔\s*(.*?)\)$/u);
    if(match)text=qualitativePosition(Number(match[1]),match[2].trim(),match[3].trim());
  }else if(type==='ranking'){
    text=text.replace(/\b\d+\s*위\s*/gu,'').replace(/\s*>\s*/g,' → ').trim();
  }

  text=text
    .replace(/\b\d{1,3}\s*\/\s*(?:5|100)\b/gu,'정도의 차이')
    .replace(/\b\d{1,3}\s*[%％]/gu,'강한 정도')
    .replace(/\b\d{1,2}\s*번\s*(?:문항|질문|답변)?/gu,'해당 상황')
    .replace(/\s+/g,' ')
    .trim();

  const question=answer.question
    .replace(/^\s*\d+\s*[.)]\s*/u,'')
    .replace(/\b\d{1,2}\s*번\s*(?:문항|질문|답변)?/gu,'해당 상황')
    .trim();

  return {
    question,
    answer:text,
    ...(answer.reason?.trim()?{reason:answer.reason.trim()}:{}),
  };
}

function ownerReviewReference(value:unknown){
  if(!Array.isArray(value))return value;
  return value.map(item=>{
    const record=asRecord(item);
    const verdict=asInlineText(record.ownerVerdict);
    const text=asInlineText(record.text);
    const feedback=asInlineText(record.ownerFeedback);
    if(verdict==='confirmed'&&text)return {status:'confirmed',interpretation:text};
    if(verdict==='rejected'&&feedback)return {status:'corrected',correction:feedback};
    if(verdict==='ambiguous'&&feedback)return {status:'clarified',candidate:text,clarification:feedback};
    return null;
  }).filter(Boolean);
}

function confirmedFactsReference(value:unknown[]){
  return value.map(item=>{
    const record=asRecord(item);
    if(Object.keys(record).length===0)return item;
    return {key:record.key,value:record.value};
  });
}

function evidencePackReference(pack:z.infer<typeof characterEvidencePackSchema>){
  return {
    publicProfileEvidence:pack.publicProfileEvidence,
    secretProfileEvidence:pack.secretProfileEvidence,
    ownerReviewEvidence:pack.ownerReviewEvidence,
    interviewEvidence:pack.interviewEvidence.map(item=>item.finding),
    behaviorRules:pack.behaviorRules,
    relationshipPatterns:pack.relationshipPatterns,
    emotionalPatterns:pack.emotionalPatterns,
    valuesAndMotives:pack.valuesAndMotives,
    exceptionsAndConditions:pack.exceptionsAndConditions,
    tensionsAndContradictions:pack.tensionsAndContradictions,
    distinctiveDetails:pack.distinctiveDetails,
    uncertainties:pack.uncertainties,
  };
}

function rawSourceStrings(publicProfileText:string,source:PrivateDetailSource){
  const owner=JSON.stringify(source.ownerReview);
  const answers=source.answers.flatMap(answer=>[answer.question,answer.answer,answer.reason||'']);
  return [publicProfileText,source.secretProfileText,owner,...answers].filter(Boolean);
}

function buildSourcePacket(seed:DetailSeed,publicProfileText:string,privateSourceInput?:unknown):{
  packet:SourcePacket|UnknownRecord;
  sources:string[];
}{
  if(seed.version==='detail-seed/2.0'){
    const source=privateDetailSourceSchema.parse(privateSourceInput);
    const packet:SourcePacket={
      publicProfile:publicProfileText,
      secretProfile:source.secretProfileText,
      ownerReview:ownerReviewReference(source.ownerReview),
      confirmedFacts:confirmedFactsReference(source.confirmedFacts),
      interview:source.answers.map(semanticAnswer),
      coverageIndex:evidencePackReference(seed.evidencePack),
    };
    return {packet,sources:rawSourceStrings(publicProfileText,source)};
  }

  return {
    packet:{
      summary:seed.summary,
      analysisSeeds:seed.analysisSeeds,
      note:'구버전 캐릭터라 저장된 해석 씨앗만 사용할 수 있음',
    },
    sources:[...seed.analysisSeeds,seed.oneLineSummary,...Object.values(seed.summary)],
  };
}

function allPsychText(model:PsychologicalModel){
  return [
    model.coreEngine,model.hiddenNeed,model.hiddenFear,model.selfProtection,model.blindSpot,
    model.intimacyLogic,model.conflictLogic,model.selfNarrative,
    ...model.hypotheses.flatMap(x=>[x.conclusion,...x.support,...x.counterSignals]),
    ...model.tensions.flatMap(x=>[x.conclusion,...x.support,...x.counterSignals]),
    ...model.uncertainties,
  ].join(' ');
}

function allReportText(detail:DetailAnalysisGeneration){
  return [
    detail.outerSelf,detail.innerSelf,detail.conflictStyle,detail.affectionStyle,detail.detailedReport,
    ...detail.coreValues,...detail.desires,...detail.fears,...detail.misunderstoodPoints,...detail.contradictions,...detail.interestingPoints,
  ].join(' ');
}

function uiArtifactReason(text:string){
  const checks:Array<[RegExp,string]> = [
    [/\b\d{1,2}\s*번\s*(?:문항|질문|답변)?/u,'문항 번호 노출'],
    [/\b\d{1,3}\s*\/\s*(?:5|100)\b/u,'점수 노출'],
    [/\b\d{1,3}\s*[%％]/u,'백분율 노출'],
    [/(?:슬라이더|백분율|선택지\s*\d+|점수\s*\d+)/u,'인터뷰 UI 표현 노출'],
  ];
  for(const [pattern,label] of checks)if(pattern.test(text))return label;
  return '';
}

function reportMetaReason(text:string){
  const checks:Array<[RegExp,string]> = [
    [/(?:프로필에서|공개\s*프로필|비밀\s*프로필|질문에서|답변에서|오너\s*(?:검수|답변|피드백)|AI\s*추론|원자료상|근거상|Evidence\s*Pack)/iu,'분석 과정 또는 입력 출처 노출'],
  ];
  for(const [pattern,label] of checks)if(pattern.test(text))return label;
  return '';
}

function normalizeOverlap(text:string){
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
}

function hasLongVerbatimOverlap(output:string,sources:string[]){
  const target=normalizeOverlap(output);
  if(!target)return false;
  for(const source of sources){
    const fragments=source.replace(/\r\n?/g,'\n').split(/\n+|(?<=[.!?。！？])\s+/u);
    for(const fragment of fragments){
      const normalized=normalizeOverlap(fragment);
      if(normalized.length<90)continue;
      const windowLength=Math.min(100,normalized.length);
      for(let start=0;start+windowLength<=normalized.length;start+=28){
        if(target.includes(normalized.slice(start,start+windowLength)))return true;
      }
    }
  }
  return false;
}

async function buildPsychologicalModel(seed:DetailSeed,packet:SourcePacket|UnknownRecord):Promise<PsychologicalModel>{
  let lastReason='';
  for(let attempt=0;attempt<2;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 자료 요약에 머물렀거나 숨은 심리 추론이 충분하지 않았습니다. 원문에 직접 적힌 사실을 다시 분류하지 말고, 서로 다른 단서 두 개 이상을 연결해 내적 욕구·자기보호·맹점·관계의 숨은 기대를 새로 도출하세요. 실패 이유: ${lastReason}`;
    const model=await askClaudeJson({
      system:PSYCHE_SYSTEM,
      schema:psychologicalModelSchema,
      maxTokens:7000,
      input:`캐릭터 이름: ${seed.name}\n\n[분석 자료]\n${JSON.stringify(packet)}\n\n작성 규칙:\n- coreEngine: 여러 영역을 관통하는 가장 핵심적인 심리적 작동 원리를 설명하세요.\n- hiddenNeed / hiddenFear: 표면적으로 말한 목표나 공포보다 한 층 아래의 관계 상태·자기상·통제감·보상 감각을 추론하세요.\n- selfProtection: 불편함이나 위협에 대응해 반복적으로 사용하는 우회·거리두기·과잉개입·재구성 등의 방식을 해석하세요. 임상 진단은 금지합니다.\n- blindSpot: 캐릭터가 스스로 설명하는 이유와 반복 행동이 어긋나는 지점, 혹은 자신은 선의라고 느끼지만 타인에게 다른 효과를 낼 수 있는 지점을 찾으세요.\n- intimacyLogic / conflictLogic: 친밀함과 갈등에서 실제로 지키려는 것과 침범으로 느끼는 것을 설명하세요.\n- selfNarrative: 스스로를 어떤 사람이라고 규정하며, 그 자기규정이 실제 행동과 어디서 맞고 어디서 어긋나는지 해석하세요.\n- hypotheses는 6~10개. 자료에 직접 문장으로 적혀 있지 않지만 두 개 이상의 독립적 단서가 함께 가리키는 새로운 해석을 만드세요. 각 가설의 support에는 구체적 행동·상황·관계 조건을 남기세요.\n- tensions는 서로 반대처럼 보이는 행동이 사실 같은 욕구에서 갈라져 나온 경우를 우선하세요.\n- confidence는 높음/중간/낮음/잠정적 등 자유로운 짧은 표현을 사용하세요.\n- 질문 번호나 점수는 절대 적지 마세요.${retry}`,
      allowFallback:false,
    });
    const artifact=uiArtifactReason(allPsychText(model));
    if(artifact){lastReason=artifact;continue}
    return model;
  }
  throw new Error(`DETAIL_PSYCHOLOGY_FAILED: ${lastReason||'PSYCHOLOGICAL_MODEL_INVALID'}`);
}

async function generateDetailFields(
  seed:DetailSeed,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<DetailAnalysisGeneration>{
  const {packet,sources}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  const psyche=await buildPsychologicalModel(seed,packet);

  const baseInput=`캐릭터 이름: ${seed.name}\n\n[심층 심리 모델]\n${JSON.stringify(psyche)}\n\n[구체성 확인용 참고 자료]\n${JSON.stringify(packet)}\n\n사용 원칙:\n1. 심층 심리 모델을 최종 해석의 중심으로 사용하세요.\n2. 참고 자료는 각 해석이 실제 캐릭터의 행동과 맞는지 검증하고, 추상적인 문장을 구체화하는 데 사용하세요.\n3. 심층 모델과 구체적 자료가 충돌하면 구체적 자료와 오너 정정을 우선하고, 해당 해석의 강도를 낮추세요.\n4. 결과에는 분석 과정과 출처를 쓰지 마세요. 독자가 처음부터 하나의 캐릭터 해석문을 읽는 것처럼 작성하세요.\n\n출력 규칙:\n- outerSelf: 타인이 체감하는 표면 태도와 그 뒤에서 실제로 작동하는 판단을 함께 설명하세요. 단순 외형이나 행동 목록이 아니라, 왜 그런 인상으로 보이는지를 해석하세요. 180~320자.\n- innerSelf: 숨은 욕구, 유지하고 싶은 자기상, 통제감, 불안과 자기보호를 중심으로 쓰세요. 자료에 직접 적히지 않은 심리도 근거가 충분하면 도출하세요. 180~320자.\n- conflictStyle: 갈등을 일으키는 표면 사건보다 무엇을 침범당했다고 느낄 때 반응이 커지는지, 왜 그 지점에서 고집·개입·회피가 나타나는지 설명하세요. 180~320자.\n- affectionStyle: 친밀함 속에서 무엇을 확인받고 싶어 하는지, 보호와 통제·배려와 소유감·거리와 안전이 어떻게 엮이는지 해석하세요. 180~320자.\n- coreValues / desires / fears: 각각 2~5개. 표면 목표가 아니라 반복 행동을 움직이는 심리적 기능과 내적 지향을 쓰세요.\n- misunderstoodPoints: 겉으로 보이는 행동과 실제 내부 동기가 달라 오해가 생기는 구조를 쓰세요.\n- contradictions: 반대되는 행동이 어떤 공통 욕구나 두려움에서 함께 나오는지 설명하세요.\n- interestingPoints: 오너가 이미 적어둔 설정의 재진술보다, 여러 단서를 연결해 새로 도출한 속내·맹점·관계의 숨은 기대를 우선하세요.\n- detailedReport: 850~1400자. 중심 심리 원리에서 출발해 숨은 욕구와 두려움, 자기보호, 친밀감, 갈등, 맹점이 어떻게 한 인물 안에서 연결되는지 서술하세요. 최소 세 가지 이상의 새롭게 도출된 해석이 포함되어야 하며, 각 해석은 구체적 행동·상황·관계 조건과 연결되어야 합니다.\n- 문단은 논점이 실제로 바뀔 때만 \\n\\n으로 나누세요. 소제목, 번호, 불릿은 detailedReport 안에 넣지 마세요.\n- 질문 번호, 점수, 퍼센트, 슬라이더 값, 선택지 번호, 분석 출처 표현은 절대 사용하지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  let lastReason='';
  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 자료를 다시 분류한 요약에 가깝거나 심리적 해석이 충분히 깊지 않았습니다. 이번에는 '왜 이런 행동을 하는가', '무엇을 유지하거나 잃지 않으려 하는가', '스스로도 자각하지 못할 수 있는 맹점은 무엇인가'에 답하도록 다시 쓰세요. 단, 없는 과거·사건·진단을 창작하지 마세요. 실패 이유: ${lastReason}`;
    const raw=await askClaudeJson({
      system:REPORT_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:8200,
      input:`${baseInput}${retry}`,
      allowFallback:false,
    });
    const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
    if(!parsed.success){lastReason=validationReason(parsed.error);continue}
    const reportText=allReportText(parsed.data);
    const artifact=uiArtifactReason(reportText);
    if(artifact){lastReason=artifact;continue}
    const meta=reportMetaReason(reportText);
    if(meta){lastReason=meta;continue}
    if(hasLongVerbatimOverlap(reportText,sources)){lastReason='원자료의 긴 문장이 그대로 복사됨';continue}
    return parsed.data;
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'DETAIL_INTERPRETATION_FAILED'}`);
}

export type VersionedFinalAnalysis = FinalAnalysis & {detailVersion:typeof DETAIL_REPORT_VERSION};

export async function generatePaidDetail(
  seedInput:unknown,
  publicProfileText='',
  privateSourceInput?:unknown,
):Promise<VersionedFinalAnalysis>{
  const seed=detailSeedSchema.parse(seedInput);
  const detail=await generateDetailFields(seed,publicProfileText,privateSourceInput);
  const analysis=finalAnalysisSchema.parse({
    oneLineSummary:seed.oneLineSummary,
    summary:seed.summary,
    ...detail,
  });
  return {...analysis,detailVersion:DETAIL_REPORT_VERSION};
}
