import { z } from 'zod';
import { askClaudeJson } from '@/lib/ai/anthropic';
import {
  analysisTypeSummarySchema,
  characterEvidencePackSchema,
  detailAnalysisGenerationSchema,
  detailAnalysisRawSchema,
  finalAnalysisSchema,
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

const DETAIL_SYSTEM = `당신은 자캐커뮤니티 캐릭터의 유료 상세 캐해 리포트를 작성하는 분석가입니다.
이번 단계의 목표는 짧은 무료 요약을 늘려 쓰는 것이 아니라, 제공된 근거 묶음을 다시 읽고 캐릭터의 행동 원리를 정밀하게 재구성하는 것입니다.
근거에 없는 새로운 과거·관계·심리 원인을 창작하지 마세요.
캐릭터를 임상적으로 진단하거나 정상/비정상으로 평가하지 마세요.
서로 모순처럼 보이는 근거가 있으면 하나를 지워 맞추지 말고, 관계·상황·예외 조건에 따라 둘이 어떻게 동시에 성립할 수 있는지 검토하세요.
사소한 물건·외형·습관은 중요하다고 단정하지도, 사소하다고 버리지도 마세요. Evidence Pack이 부여한 맥락과 다른 근거의 연결 정도를 보고 판단하세요.`;

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
  return `캐릭터 이름: ${seed.name}\n\n무료 요약:\n${JSON.stringify({oneLineSummary:seed.oneLineSummary,summary:seed.summary})}\n\n이 캐릭터는 Evidence Pack 도입 전 분석 버전입니다. 당시 저장된 상세 생성용 분석 씨앗:\n${JSON.stringify(seed.analysisSeeds)}\n\n씨앗에 없는 새 사실을 만들지 마세요.`;
}

function buildEvidenceInput(seed:z.infer<typeof evidenceDetailSeedSchema>,publicProfileText:string){
  return `캐릭터 이름: ${seed.name}\n\n공개 프로필 원문 — 결제 후 상세 단계에서 다시 읽는 원문입니다:\n${publicProfileText || '(공개 프로필 원문 없음)'}\n\n무료 요약 — 방향 참고용이며 최종 근거보다 우선하지 않습니다:\n${JSON.stringify({oneLineSummary:seed.oneLineSummary,summary:seed.summary})}\n\n구조화 Character Evidence Pack:\n${JSON.stringify(seed.evidencePack)}\n\nEvidence Pack 읽는 법 — 매우 중요:\n- ownerReviewEvidence와 interviewEvidence는 오너가 직접 정정하거나 20문항에서 확인된 정보이므로 가장 높은 우선순위로 읽으세요.\n- interviewEvidence는 1~20번을 전부 훑으세요. 몇 개의 강한 답만 골라 나머지를 무시하지 마세요.\n- secretProfileEvidence는 비밀 프로필에서 보존된 의미이며, 공개 프로필에 없다는 이유로 약한 근거로 취급하지 마세요.\n- publicProfileEvidence와 위 공개 프로필 원문을 서로 대조하세요. Evidence Pack이 원문을 왜곡한 것 같으면 공개 프로필 원문을 우선합니다.\n- behaviorRules / relationshipPatterns / emotionalPatterns / valuesAndMotives는 여러 근거를 결합한 해석입니다. 그 자체를 공식 사실처럼 복사하지 말고 하위 근거들과 일관되는지 검토하세요.\n- exceptionsAndConditions는 일반화의 경계를 정하는 핵심 정보입니다. 상세 캐해에서 반드시 반영하세요.\n- tensionsAndContradictions는 어느 한쪽을 지우지 말고 어떤 조건에서 각각 나타나는지 해석하세요.\n- distinctiveDetails는 캐릭터 고유성을 보존하기 위한 정보입니다. 심리적 의미가 근거에 없으면 상징으로 확대하지 마세요.\n- uncertainties는 확정하지 마세요. 필요하면 상세 리포트에서 '가능성' 또는 '아직 열려 있는 부분'으로만 다루세요.\n\n상세 결과는 무료 요약을 장황하게 다시 쓰는 글이 아니라, 위 근거들을 교차해 새롭게 정리한 2차 분석이어야 합니다.`;
}

async function generateDetailFields(seed:z.infer<typeof detailSeedSchema>,publicProfileText:string):Promise<DetailAnalysisGeneration>{
  let lastReason='';
  const sourceInput=seed.version==='detail-seed/2.0'
    ? buildEvidenceInput(seed,publicProfileText)
    : buildLegacyInput(seed);
  const baseInput=`${sourceInput}\n\n출력 규칙:\n- outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 하나의 문자열입니다. 180~320자 정도를 목표로 충분히 구체적으로 쓰되 서버 허용 범위는 최소 140자, 최대 360자입니다.\n- coreValues / desires / fears / misunderstoodPoints / contradictions / interestingPoints: 각 2~5개 문자열 배열, 항목당 8~80자.\n- detailedReport: 하나의 문자열 700~1400자. 위 항목을 그대로 반복하지 말고 캐릭터의 행동 원리, 관계 패턴, 예외 조건, 겉과 속의 간극, 중요한 모순과 고유 디테일이 어떻게 연결되는지 하나의 흐름으로 통합하세요.\n- 근거에 없는 새 사실을 만들지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 생성은 서버 검증에 실패했습니다. 이전 출력을 수리하지 말고 같은 근거로 새로 작성하세요. 실패 원인: ${lastReason}`;
    const raw=await askClaudeJson({
      system:DETAIL_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:5600,
      input:`${baseInput}${retry}`,
    });
    const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
    if(parsed.success)return parsed.data;
    lastReason=validationReason(parsed.error);
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'DETAIL_LENGTH_FAILED'}`);
}

export async function generatePaidDetail(seedInput:unknown,publicProfileText=''):Promise<FinalAnalysis>{
  const seed=detailSeedSchema.parse(seedInput);
  const detail=await generateDetailFields(seed,publicProfileText);
  return finalAnalysisSchema.parse({
    oneLineSummary:seed.oneLineSummary,
    summary:seed.summary,
    ...detail,
  });
}
