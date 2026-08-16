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

export const DETAIL_REPORT_VERSION = 'detail-analysis/4.0' as const;

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

const evidenceCardSchema = z.object({
  thesis: z.string().min(24).max(280),
  evidence: z.array(z.string().min(12).max(260)).min(2).max(5),
  exceptions: z.array(z.string().min(12).max(240)).max(3).default([]),
  domains: z.array(z.enum(['self','relationship','conflict','affection','emotion','value','habit','expression'])).min(1).max(4),
  confidence: z.enum(['strong','moderate','tentative']),
});

const interpretationBundleSchema = z.object({
  centralThesis: z.string().min(36).max(360),
  cards: z.array(evidenceCardSchema).min(6).max(10),
  openQuestions: z.array(z.string().min(18).max(220)).max(4).default([]),
});

type InterpretationBundle = z.infer<typeof interpretationBundleSchema>;
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

const SYNTHESIS_SYSTEM = `당신은 캐릭터 설정과 인터뷰 전체를 읽고, 구체적 근거가 붙은 캐릭터 해석 지도를 만드는 분석가입니다.
이 단계의 목적은 원자료를 없애는 것이 아니라, 원자료의 구체성을 보존한 채 여러 단서를 연결해 상위 행동 원리를 도출하는 것입니다.

반드시 지킬 규칙:
- 질문 번호, 문항 번호, 선택지 번호, 슬라이더 수치, 백분율, 점수 같은 인터뷰 UI 흔적은 남기지 마세요.
- evidence에는 실제로 캐릭터를 구별해 주는 구체적 행동·상황·관계 조건·습관을 짧게 바꿔 적으세요. 모든 것을 추상어로 치환하지 마세요.
- thesis는 evidence를 다시 말하는 문장이 아니라, 여러 evidence가 함께 가리키는 행동 규칙·우선순위·임계점·관계 차이·자기인식의 간극이어야 합니다.
- 가능하면 하나의 thesis에 서로 다른 두 개 이상의 근거를 연결하세요. 근거가 하나뿐이면 confidence를 tentative로 두고 과도한 심리 원인을 만들지 마세요.
- 사용자가 직접 적은 이유가 있으면 선택 결과 자체보다 이유의 논리를 더 중요하게 보세요.
- 자료가 서로 충돌하면 하나를 버리지 말고 exceptions에 어느 조건에서 다른 모습이 성립하는지 남기세요.
- 독특한 물건, 행동, 표현, 사건은 의미가 다른 근거와 연결될 때 삭제하지 말고 evidence에 보존하세요. 단순 목록으로 늘어놓지만 마세요.
- 오너가 틀렸다고 정정한 해석은 사용하지 말고 정정 내용을 사실로 우선하세요.
- 같은 해석을 표현만 바꿔 여러 카드에 반복하지 마세요.

좋은 카드는 '이 캐릭터는 독립적이다'가 아니라, '타인이 대신 해결하려 할 때보다 자신이 직접 손대어 형태를 다시 만들 수 있을 때 안정감을 느끼며, 이 기준은 가까운 관계에서도 일정 부분 유지된다'처럼 구체적 근거에서 한 단계 올라간 해석입니다.`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티 캐릭터의 유료 상세 캐해 리포트를 쓰는 분석가입니다.
당신에게는 (1) 여러 원자료를 연결한 해석 카드와 (2) 사실을 다시 확인할 수 있는 구체적 참고 자료가 함께 주어집니다.
해석 카드는 방향을 잡는 지도이고, 참고 자료는 해석이 캐릭터에서 벗어나지 않게 붙잡는 닻입니다. 둘이 충돌하면 구체적 참고 자료와 오너의 정정 내용을 우선하세요.

최종 결과에서 금지되는 것:
- 질문 번호, 문항 번호, 점수, 백분율, 슬라이더 값, 선택지 번호를 언급하지 마세요.
- '프로필에서', '질문에서', '답변에서', '오너가', 'AI 추론이', '원자료상', '근거상'처럼 분석 과정이나 출처를 설명하지 마세요.
- 인터뷰 답변이나 대사를 긴 문장 그대로 복사하지 마세요.
- 자료를 카테고리별로 다시 정리한 요약문을 만들지 마세요.
- 구체성을 피한다는 이유로 '자기 기준이 강하다', '관계에 따라 달라진다' 같은 누구에게나 붙일 수 있는 추상 문장만 쓰지 마세요.

최종 결과가 해야 하는 일:
- 각 주요 해석에는 가능하면 이 캐릭터만의 구체적인 행동·상황·관계 조건을 한두 개 자연스럽게 녹이세요. 출처를 밝히거나 인용하지 말고 해석의 예시와 근거로 사용하세요.
- 행동을 만드는 내부 기준과 우선순위를 설명하고, 그 기준이 언제 유지되고 언제 깨지는지 보여주세요.
- 관계의 거리, 책임 범위, 호감, 불안, 흥미 같은 조건이 행동을 어떻게 바꾸는지 구체적으로 설명하세요.
- 갈등에서는 무엇을 먼저 확인하고 어느 지점에서 개입하거나 물러나는지, 친밀감에서는 관찰·개입·보호·경계가 어떻게 변하는지 해석하세요.
- 겉으로 보이는 태도와 실제 내부 판단 사이의 간극이 있다면 왜 그런 간극이 생기는지 설명하세요.
- 서로 모순처럼 보이는 행동은 하나를 지우지 말고 더 큰 행동 원리 안에서 연결하세요.
- 독특한 디테일은 그 자체를 나열하지 말고, 그 디테일이 캐릭터의 인식 방식이나 선택 원리를 보여줄 때만 사용하세요.
- 단정할 수 없는 부분은 열린 가능성으로 남기세요.

문체는 자연스럽고 읽히는 한국어 산문이어야 합니다. 문단은 문장 수에 맞춰 기계적으로 자르지 말고, 논점이 실제로 전환될 때만 나누세요.`;

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

function allBundleText(bundle:InterpretationBundle){
  return [
    bundle.centralThesis,
    ...bundle.cards.flatMap(card=>[card.thesis,...card.evidence,...card.exceptions]),
    ...bundle.openQuestions,
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
      if(normalized.length<80)continue;
      const windowLength=Math.min(90,normalized.length);
      for(let start=0;start+windowLength<=normalized.length;start+=24){
        if(target.includes(normalized.slice(start,start+windowLength)))return true;
      }
    }
  }
  return false;
}

async function buildInterpretationBundle(seed:DetailSeed,packet:SourcePacket|UnknownRecord):Promise<InterpretationBundle>{
  let lastReason='';
  for(let attempt=0;attempt<2;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 너무 추상적이거나 인터뷰 UI 흔적이 남았습니다. 각 카드의 evidence에 이 캐릭터를 구별하는 실제 행동·상황·관계 조건을 더 보존하고, thesis는 그 근거들을 연결한 해석으로 다시 작성하세요. 실패 이유: ${lastReason}`;
    const bundle=await askClaudeJson({
      system:SYNTHESIS_SYSTEM,
      schema:interpretationBundleSchema,
      maxTokens:5200,
      input:`캐릭터 이름: ${seed.name}\n\n[분석 자료]\n${JSON.stringify(packet)}\n\n작성 규칙:\n- centralThesis는 이 캐릭터의 여러 영역을 관통하는 중심 원리를 한 문단으로 적으세요.\n- cards는 6~10개를 만드세요. 각 카드에는 thesis, evidence 2~5개, exceptions 0~3개, domains, confidence가 있어야 합니다.\n- evidence는 추상적인 형용사가 아니라 실제 행동·관계·상황 조건을 짧게 바꿔 적어야 합니다.\n- evidence에 질문 번호나 점수는 남기지 마세요.\n- 한 카드에 프로필의 구체적 행동과 인터뷰에서 드러난 판단이 함께 연결될 수 있으면 적극적으로 연결하세요.\n- 오너가 직접 정정한 내용은 가장 높은 우선순위로 반영하세요.\n- openQuestions에는 자료만으로 확정할 수 없는 해석만 남기세요.${retry}`,
      allowFallback:false,
      model:'anthropic/claude-sonnet-5',
    });
    const artifact=uiArtifactReason(allBundleText(bundle));
    if(artifact){lastReason=artifact;continue}
    return bundle;
  }
  throw new Error(`DETAIL_SYNTHESIS_FAILED: ${lastReason||'INTERPRETATION_BUNDLE_INVALID'}`);
}

async function generateDetailFields(
  seed:DetailSeed,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<DetailAnalysisGeneration>{
  const {packet,sources}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  const bundle=await buildInterpretationBundle(seed,packet);

  const baseInput=`캐릭터 이름: ${seed.name}\n\n[해석 지도]\n${JSON.stringify(bundle)}\n\n[구체성 확인용 참고 자료]\n${JSON.stringify(packet)}\n\n사용 순서:\n1. 해석 지도로 중심 원리와 연결 구조를 잡으세요.\n2. 참고 자료로 각 해석이 실제 캐릭터의 행동·관계·상황과 맞는지 다시 확인하세요.\n3. 해석 지도가 지나치게 일반화했거나 참고 자료와 충돌하면 참고 자료와 오너 정정 내용을 우선하세요.\n4. 최종 글에는 출처 이름이나 질문 번호를 쓰지 말고, 필요한 구체적 행동과 상황만 자연스럽게 녹이세요.\n\n출력 규칙:\n- outerSelf: 타인이 반복적으로 체감하는 행동 방식과 인상을 설명하되, 이 캐릭터만의 구체적 행동 패턴을 최소 하나 포함하세요. 외형 목록은 금지합니다. 180~320자.\n- innerSelf: 실제 선택을 정하는 우선순위와 자기인식, 긴장과 조절 방식을 설명하고 그 판단이 드러나는 구체적 상황을 자연스럽게 포함하세요. 180~320자.\n- conflictStyle: 갈등 감지 기준 → 초기 대응 → 개입 임계점 → 고집이 생기는 조건 → 물러나는 예외가 어떻게 이어지는지 설명하세요. 가능한 경우 구체적 행동 패턴을 포함하세요. 180~320자.\n- affectionStyle: 친밀감이 높아질수록 관찰·개입·보호·경계가 어떻게 달라지는지 설명하고, 다른 관계와 구별되는 실제 행동 방식을 포함하세요. 180~320자.\n- coreValues / desires / fears: 각각 2~5개. 누구에게나 적용되는 단어 하나가 아니라 이 캐릭터의 반복 선택을 설명하는 구체적인 원리로 쓰세요.\n- misunderstoodPoints / contradictions / interestingPoints: 각각 2~5개. 왜 그렇게 보이는지, 어떤 두 성향이 어떤 조건에서 동시에 성립하는지까지 포함한 해석 문장으로 쓰세요.\n- detailedReport: 850~1400자. 중심 원리 하나를 잡고 관계·갈등·감정·자기인식·고유 습관이 그 원리에서 어떻게 갈라져 나오는지 연결하세요. 각 주요 문단에는 가능하면 참고 자료에서 확인되는 구체적 행동·상황·관계 조건을 한두 개씩 녹이되, 출처 설명이나 직접 인용은 하지 마세요.\n- 자료에 없는 심리 원인이나 과거를 창작하지 마세요.\n- 문단은 논점이 실제로 바뀔 때만 \\n\\n으로 나누세요. 소제목, 번호, 불릿은 넣지 마세요.\n- 질문 번호, 점수, 퍼센트, 슬라이더 값, 선택지 번호, 분석 출처 표현은 절대 사용하지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  let lastReason='';
  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 캐릭터 고유의 구체성이 부족했거나 사용자에게 보여서는 안 되는 인터뷰 흔적이 남았습니다. 해석 지도만 반복하지 말고 참고 자료의 구체적 행동·관계·상황을 다시 확인해 해석에 녹이세요. 단, 질문 번호·점수·출처 설명·긴 직접 인용은 제거하세요. 실패 이유: ${lastReason}`;
    const raw=await askClaudeJson({
      system:REPORT_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:7600,
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
