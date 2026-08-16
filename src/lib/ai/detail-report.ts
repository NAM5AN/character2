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

export const DETAIL_REPORT_VERSION = 'detail-analysis/3.0' as const;

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

const interpretationMapSchema = z.object({
  coreDynamics: z.array(z.string().min(18).max(220)).max(7).default([]),
  relationalLogic: z.array(z.string().min(18).max(220)).max(7).default([]),
  conflictLogic: z.array(z.string().min(18).max(220)).max(6).default([]),
  emotionalLogic: z.array(z.string().min(18).max(220)).max(6).default([]),
  selfConcept: z.array(z.string().min(18).max(220)).max(6).default([]),
  valuesAndMotives: z.array(z.string().min(18).max(220)).max(6).default([]),
  exceptionsAndLimits: z.array(z.string().min(18).max(220)).max(6).default([]),
  distinctivePatterns: z.array(z.string().min(18).max(220)).max(6).default([]),
  uncertainties: z.array(z.string().min(18).max(220)).max(4).default([]),
});

type InterpretationMap = z.infer<typeof interpretationMapSchema>;

const SYNTHESIS_SYSTEM = `당신은 캐릭터 설정과 인터뷰 원자료를 '해석 가능한 행동 원리'로 압축하는 분석가입니다.
이 단계의 목적은 자료를 요약하거나 분류하는 것이 아니라, 여러 단서를 연결해 자료에 직접 쓰여 있지 않은 상위 패턴을 도출하는 것입니다.

반드시 지킬 규칙:
- 질문 번호, 문항 번호, 슬라이더 수치, 백분율, 점수, 선택지 번호, UI 이름을 결과에 절대 남기지 마세요.
- 공개 프로필/비밀 프로필/오너 답변/AI 추론 같은 출처 이름을 결과 문장에 쓰지 마세요.
- 원문 문장, 대사, 답변을 직접 인용하거나 길게 바꿔 쓰지 마세요.
- 키, 나이, 숫자, 물건 목록, 외형 목록 같은 사실을 나열하지 마세요. 그런 디테일은 다른 행동과 연결되어 의미가 확인될 때만 '어떤 기능을 하는가'로 추상화하세요.
- 하나의 단서만으로 심리 원인을 발명하지 마세요. 가능하면 서로 다른 두 개 이상의 단서를 연결해 행동 규칙, 임계점, 예외, 관계 차이, 자기인식의 간극을 도출하세요.
- 같은 내용을 표현만 바꿔 여러 축에 반복하지 마세요.
- 수치형 답변은 숫자를 보존하지 말고 방향성과 강도의 의미만 해석하세요.
- 사용자가 실제로 쓴 이유가 있으면 선택 결과 자체보다 이유의 논리를 더 중요하게 보세요.
- 자료가 서로 충돌하면 하나를 버리지 말고 어느 조건에서 각각 성립하는지 찾아내세요.

좋은 결과는 '무엇을 했다'가 아니라 '어떤 기준으로 움직이며, 어디서 기준이 바뀌고, 무엇이 예외가 되는가'를 설명합니다.`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티 캐릭터의 유료 상세 캐해 리포트를 쓰는 분석가입니다.
당신에게는 이미 원자료를 한 차례 해석해 만든 해석 지도가 주어집니다. 최종 리포트는 그 지도에서 한 단계 더 통합된 캐릭터 해석을 작성해야 합니다.

최종 결과에서 금지되는 것:
- 질문 번호, 문항 번호, 점수, 백분율, 슬라이더 값, 선택지 번호를 언급하지 마세요.
- '프로필에서', '질문에서', '답변에서', '오너가', 'AI 추론이', '근거상'처럼 분석 과정이나 출처를 설명하지 마세요.
- 원문 대사나 문장을 따옴표로 재인용하지 마세요.
- 외형, 소지품, 사건, 설정을 목록처럼 다시 읊지 마세요.
- 입력 내용을 카테고리별로 재배열한 요약문을 만들지 마세요.
- '성실하다', '낙관적이다' 같은 성격 라벨만 붙이고 끝내지 마세요.

최종 결과가 해야 하는 일:
- 행동을 만드는 내부 기준과 우선순위를 설명하세요.
- 어떤 관계와 상황에서 그 기준이 달라지는지 설명하세요.
- 갈등에서 무엇을 먼저 확인하고 어느 지점에서 개입하거나 물러나는지 해석하세요.
- 애정이나 친밀감이 행동의 범위, 관찰 방식, 개입 정도를 어떻게 바꾸는지 해석하세요.
- 겉으로 보이는 태도와 실제 내부 판단 사이의 간극이 있다면 그 구조를 설명하세요.
- 서로 모순처럼 보이는 성향을 하나의 더 큰 원리 안에서 연결하세요.
- 독특한 디테일은 그 자체를 자랑하듯 나열하지 말고 캐릭터의 인식 방식이나 선택 원리와 연결될 때만 사용하세요.
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

function allMapText(map:InterpretationMap){
  return Object.values(map).flat().join(' ');
}

function allReportText(detail:DetailAnalysisGeneration){
  return [
    detail.outerSelf,detail.innerSelf,detail.conflictStyle,detail.affectionStyle,detail.detailedReport,
    ...detail.coreValues,...detail.desires,...detail.fears,...detail.misunderstoodPoints,...detail.contradictions,...detail.interestingPoints,
  ].join(' ');
}

function forbiddenSurfaceReason(text:string){
  const checks:Array<[RegExp,string]> = [
    [/[0-9]/u,'숫자/점수 노출'],
    [/(?:프로필|원자료|문항|질문|답변|선택지|슬라이더|백분율|점수|오너\s*(?:피드백|검수|답변)|AI\s*추론|Evidence\s*Pack)/iu,'분석 과정 또는 입력 출처 노출'],
    [/[%％]/u,'백분율 기호 노출'],
    [/[“”"‘’]/u,'원문 직접 인용'],
  ];
  for(const [pattern,label] of checks)if(pattern.test(text))return label;
  return '';
}

function normalizeOverlap(text:string){
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
}

function hasLongSourceOverlap(output:string,sources:string[]){
  const target=normalizeOverlap(output);
  if(!target)return false;
  for(const source of sources){
    const fragments=source.replace(/\r\n?/g,'\n').split(/\n+|(?<=[.!?。！？])\s+/u);
    for(const fragment of fragments){
      const normalized=normalizeOverlap(fragment);
      if(normalized.length<30)continue;
      const windowLength=Math.min(42,normalized.length);
      for(let start=0;start+windowLength<=normalized.length;start+=14){
        if(target.includes(normalized.slice(start,start+windowLength)))return true;
      }
    }
  }
  return false;
}

function sourceStrings(publicProfileText:string,source:z.infer<typeof privateDetailSourceSchema>){
  const owner=JSON.stringify(source.ownerReview);
  const answers=source.answers.flatMap(answer=>[answer.question,answer.answer,answer.reason||'']);
  return [publicProfileText,source.secretProfileText,owner,...answers].filter(Boolean);
}

async function buildInterpretationMap(
  seed:z.infer<typeof detailSeedSchema>,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<{map:InterpretationMap;sources:string[]} >{
  let input='';
  let sources:string[]=[];

  if(seed.version==='detail-seed/2.0'){
    const source=privateDetailSourceSchema.parse(privateSourceInput);
    sources=sourceStrings(publicProfileText,source);
    input=`캐릭터 이름: ${seed.name}\n\n[공개 설정]\n${publicProfileText||'(없음)'}\n\n[비밀 설정]\n${source.secretProfileText||'(없음)'}\n\n[오너 검수/정정]\n${JSON.stringify(source.ownerReview)}\n\n[인터뷰 전체]\n${JSON.stringify(source.answers)}\n\n[구조화된 확인 사실]\n${JSON.stringify(source.confirmedFacts)}\n\n[참고 성향 데이터]\n${JSON.stringify({traits:source.traits,relationshipTraits:source.relationshipTraits})}\n\n[누락 점검용 인덱스]\n${JSON.stringify(seed.evidencePack)}\n\n이 자료를 재서술하지 말고 캐릭터의 상위 행동 원리로 압축하세요.`;
  }else{
    sources=[...seed.analysisSeeds,seed.oneLineSummary,...Object.values(seed.summary)];
    input=`캐릭터 이름: ${seed.name}\n\n이 캐릭터는 구버전 저장 자료만 있습니다. 아래 저장된 해석 씨앗에서 새 사실을 만들지 말고, 서로 연결되는 상위 패턴만 추출하세요.\n${JSON.stringify({summary:seed.summary,analysisSeeds:seed.analysisSeeds})}`;
  }

  let lastReason='';
  for(let attempt=0;attempt<2;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 최종 리포트에 그대로 노출될 수 없는 메타 정보나 원문 재서술이 남았습니다. 숫자, 질문/답변 출처, 직접 인용, 원문 문장을 모두 제거하고 순수한 해석 문장으로 다시 작성하세요. 실패 이유: ${lastReason}`;
    const map=await askClaudeJson({
      system:SYNTHESIS_SYSTEM,
      schema:interpretationMapSchema,
      maxTokens:3600,
      input:`${input}${retry}`,
      allowFallback:false,
      model:'anthropic/claude-sonnet-5',
    });
    const surface=forbiddenSurfaceReason(allMapText(map));
    if(surface){lastReason=surface;continue}
    if(hasLongSourceOverlap(allMapText(map),sources)){lastReason='원문과 긴 구절이 겹침';continue}
    return {map,sources};
  }
  throw new Error(`DETAIL_SYNTHESIS_FAILED: ${lastReason||'INTERPRETATION_MAP_INVALID'}`);
}

async function generateDetailFields(
  seed:z.infer<typeof detailSeedSchema>,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<DetailAnalysisGeneration>{
  const {map,sources}=await buildInterpretationMap(seed,publicProfileText,privateSourceInput);
  const baseInput=`캐릭터 이름: ${seed.name}\n\n[해석 지도]\n${JSON.stringify(map)}\n\n이 지도는 원자료를 직접 노출하지 않도록 이미 한 차례 추상화된 결과입니다. 최종 글에서는 지도 항목을 다시 목록처럼 옮기지 말고, 서로 연결되는 원리를 통합해서 해석하세요.\n\n출력 규칙:\n- outerSelf: 타인이 반복적으로 체감하게 되는 행동 방식과 인상, 판단의 속도와 관찰 가능한 기준을 해석하세요. 외형이나 설정 목록을 쓰지 마세요. 180~320자.\n- innerSelf: 겉으로 드러난 태도 뒤에서 실제로 선택을 정하는 우선순위, 자기인식, 긴장과 조절 방식을 해석하세요. 180~320자.\n- conflictStyle: 갈등을 감지하는 기준, 처음 취하는 태도, 개입 임계점, 고집이 생기는 조건, 물러나는 예외를 하나의 메커니즘으로 설명하세요. 180~320자.\n- affectionStyle: 친밀감이 높아질수록 관찰·개입·보호·경계의 방식이 어떻게 달라지는지 설명하세요. 애정 표현을 단순 행동 목록으로 쓰지 마세요. 180~320자.\n- coreValues / desires / fears: 각각 2~5개. 사건이나 물건이 아니라 반복 선택을 설명하는 추상적 원리와 지향을 짧게 쓰세요.\n- misunderstoodPoints / contradictions / interestingPoints: 각각 2~5개. 단순 사실이 아니라 왜 그렇게 보이는지, 무엇과 무엇이 동시에 성립하는지를 해석한 문장으로 쓰세요.\n- detailedReport: 850~1400자. 가장 중요한 중심 원리 하나를 먼저 잡고, 그 원리가 관계·갈등·감정·자기인식에서 어떻게 다른 형태로 나타나는지 연결하세요. 유형별 항목을 다시 요약하지 말고 '왜 이 캐릭터가 이런 방식으로 움직이는가'가 읽히는 통합 해석을 쓰세요.\n- 문단은 논점이 실제로 바뀔 때만 \\n\\n으로 나누세요. 소제목, 번호, 불릿은 넣지 마세요.\n- 숫자, 질문 번호, 점수, 퍼센트, 출처 표현, 직접 인용은 절대 사용하지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  let lastReason='';
  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 결과는 캐릭터 해석이 아니라 자료 재서술에 가까웠거나 사용자에게 보여서는 안 되는 원자료 흔적이 남았습니다. 이번에는 해석 지도만 사용해 처음부터 새로 쓰세요. 숫자, 문항 번호, 점수, 직접 인용, 입력 출처를 제거하고 행동 원리와 관계 규칙을 설명하세요. 실패 이유: ${lastReason}`;
    const raw=await askClaudeJson({
      system:REPORT_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:7000,
      input:`${baseInput}${retry}`,
      allowFallback:false,
    });
    const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
    if(!parsed.success){lastReason=validationReason(parsed.error);continue}
    const reportText=allReportText(parsed.data);
    const surface=forbiddenSurfaceReason(reportText);
    if(surface){lastReason=surface;continue}
    if(hasLongSourceOverlap(reportText,sources)){lastReason='원자료와 긴 구절이 겹쳐 재서술로 판단됨';continue}
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
