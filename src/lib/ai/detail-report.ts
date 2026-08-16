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

const DETAIL_SYSTEM = `당신은 자캐커뮤니티 캐릭터의 유료 상세 캐해 리포트를 작성하는 분석가입니다.
이번 단계에서는 공개 프로필 원문, 비밀 프로필 원문, 오너의 AI 추론 검수/정정, 20문항의 질문·답변·이유 전체를 다시 읽고 캐릭터를 재분석합니다.
무료 요약이나 Evidence Pack을 단순히 늘려 쓰지 마세요. 그것들은 누락 검사용 보조 인덱스일 뿐이며, 최종 판단은 원자료를 다시 읽어 내려야 합니다.
근거에 없는 새로운 과거·관계·심리 원인을 창작하지 마세요.
캐릭터를 임상적으로 진단하거나 정상/비정상으로 평가하지 마세요.
서로 모순처럼 보이는 원자료가 있으면 하나를 지워 맞추지 말고 관계·상황·예외 조건에 따라 둘이 어떻게 동시에 성립하는지 검토하세요.
사소한 물건·외형·습관은 중요하다고 단정하지도 사소하다고 버리지도 마세요. 원자료에서 반복되는지, 의미가 명시되는지, 다른 행동과 연결되는지를 보고 판단하세요.`;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object') return Object.values(value as UnknownRecord).map(asText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return value == null ? '' : String(value).trim();
}

function clipText(text:string,max:number){
  const normalized=text.replace(/\s+/g,' ').trim();
  if(normalized.length<=max)return normalized;
  const cut=normalized.slice(0,max).trimEnd();
  const stops=[cut.lastIndexOf('.'),cut.lastIndexOf('!'),cut.lastIndexOf('?')];
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
    .map(asText)
    .map(x=>clipText(x,80))
    .filter(x=>x.length>=8)
    .slice(0,5);
}

function normalizeDetail(raw:z.infer<typeof detailAnalysisRawSchema>){
  return {
    outerSelf:clipText(asText(raw.outerSelf),360),
    innerSelf:clipText(asText(raw.innerSelf),360),
    coreValues:asList(raw.coreValues),
    desires:asList(raw.desires),
    fears:asList(raw.fears),
    conflictStyle:clipText(asText(raw.conflictStyle),360),
    affectionStyle:clipText(asText(raw.affectionStyle),360),
    misunderstoodPoints:asList(raw.misunderstoodPoints),
    contradictions:asList(raw.contradictions),
    interestingPoints:asList(raw.interestingPoints),
    detailedReport:clipText(asText(raw.detailedReport),1400),
  };
}

function validationReason(error:z.ZodError){
  return error.issues.slice(0,12).map(issue=>`${issue.path.join('.')||'(root)'}: ${issue.message}`).join('; ');
}

function buildLegacyInput(seed:z.infer<typeof legacyDetailSeedSchema>){
  return `캐릭터 이름: ${seed.name}\n\n무료 요약:\n${JSON.stringify({oneLineSummary:seed.oneLineSummary,summary:seed.summary})}\n\n이 캐릭터는 원자료 재독해 기능 도입 전 분석 버전입니다. 당시 저장된 상세 생성용 분석 씨앗:\n${JSON.stringify(seed.analysisSeeds)}\n\n씨앗에 없는 새 사실을 만들지 마세요.`;
}

function buildEvidenceInput(
  seed:z.infer<typeof evidenceDetailSeedSchema>,
  publicProfileText:string,
  source:z.infer<typeof privateDetailSourceSchema>,
){
  return `캐릭터 이름: ${seed.name}\n\n[원자료 1 — 공개 프로필 원문]\n${publicProfileText || '(공개 프로필 원문 없음)'}\n\n[원자료 2 — 비밀 프로필 원문]\n${source.secretProfileText || '(비밀 프로필 없음)'}\n\n[원자료 3 — AI 추론 검수 및 오너 정정/보충]\n${JSON.stringify(source.ownerReview)}\n\n[원자료 4 — 인터뷰 20문항 질문/답변/이유 전체]\n${JSON.stringify(source.answers)}\n\n[원자료 5 — 프로필에서 구조화된 확인 사실]\n${JSON.stringify(source.confirmedFacts)}\n\n[참고 — traits / relationshipTraits]\n${JSON.stringify({traits:source.traits,relationshipTraits:source.relationshipTraits})}\n\n[누락 검사용 Evidence Pack]\n${JSON.stringify(seed.evidencePack)}\n\n[무료 요약 — 참고용, 원자료보다 우선하지 않음]\n${JSON.stringify({oneLineSummary:seed.oneLineSummary,summary:seed.summary})}\n\n재분석 규칙 — 매우 중요:\n- 원자료를 처음부터 다시 읽으세요. 무료 요약의 결론에 맞추기 위해 원자료를 선택적으로 해석하지 마세요.\n- rejected된 AI 추론은 틀린 해석입니다. ownerReview의 오너 정정만 근거로 사용하세요.\n- ambiguous 추론은 ownerFeedback이 있으면 그것을 우선하고, 없으면 확정 사실로 취급하지 마세요.\n- 20문항은 1번부터 20번까지 모두 읽으세요. answer뿐 아니라 reason이 있으면 이유를 반드시 함께 반영하세요.\n- 같은 행동이라도 관계, 상황, 책임 범위에 따라 달라진다는 답이 있으면 하나의 고정 성격으로 평탄화하지 마세요.\n- 비밀 프로필은 공개 프로필과 같은 원자료입니다. 숨겨진 정보라는 이유로 과대평가하지 말고, 공개 프로필과 충돌하거나 보완하는 지점을 실제 내용에 따라 판단하세요.\n- Evidence Pack은 원자료에서 빠뜨린 축이 없는지 마지막에 대조하는 체크리스트입니다. Evidence Pack과 원문이 충돌하면 원문과 오너 직접 답변을 우선하세요.\n- distinctiveDetails에 있는 요소도 원자료에서 중요성이 확인되지 않으면 상징이나 트라우마로 확대하지 마세요.\n- uncertainties는 단정하지 말고 열린 가능성으로 남기세요.\n\n상세 결과는 '1차 요약의 확장판'이 아니라 동일한 원자료를 결제 후 더 긴 예산으로 다시 읽은 2차 캐해여야 합니다.`;
}

async function generateDetailFields(
  seed:z.infer<typeof detailSeedSchema>,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<DetailAnalysisGeneration>{
  let lastReason='';
  let sourceInput:string;
  if(seed.version==='detail-seed/2.0'){
    const source=privateDetailSourceSchema.parse(privateSourceInput);
    sourceInput=buildEvidenceInput(seed,publicProfileText,source);
  }else{
    sourceInput=buildLegacyInput(seed);
  }

  const baseInput=`${sourceInput}\n\n출력 규칙:\n- outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 하나의 문자열입니다. 180~320자 정도를 목표로 충분히 구체적으로 쓰되 서버 허용 범위는 최소 140자, 최대 360자입니다.\n- coreValues / desires / fears / misunderstoodPoints / contradictions / interestingPoints: 각 2~5개 문자열 배열, 항목당 8~80자.\n- detailedReport: 하나의 문자열 700~1400자. 위 항목을 그대로 반복하지 말고 원자료에서 확인된 행동 원리, 관계 패턴, 예외 조건, 겉과 속의 간극, 중요한 모순과 고유 디테일이 어떻게 연결되는지 하나의 흐름으로 통합하세요.\n- 근거에 없는 새 사실을 만들지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 생성은 서버 검증에 실패했습니다. 이전 출력을 수리하지 말고 같은 원자료를 처음부터 다시 읽어 새로 작성하세요. 실패 원인: ${lastReason}`;
    const raw=await askClaudeJson({
      system:DETAIL_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:6200,
      input:`${baseInput}${retry}`,
    });
    const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
    if(parsed.success)return parsed.data;
    lastReason=validationReason(parsed.error);
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'DETAIL_LENGTH_FAILED'}`);
}

export async function generatePaidDetail(
  seedInput:unknown,
  publicProfileText='',
  privateSourceInput?:unknown,
):Promise<FinalAnalysis>{
  const seed=detailSeedSchema.parse(seedInput);
  const detail=await generateDetailFields(seed,publicProfileText,privateSourceInput);
  return finalAnalysisSchema.parse({
    oneLineSummary:seed.oneLineSummary,
    summary:seed.summary,
    ...detail,
  });
}
