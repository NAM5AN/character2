import { z } from 'zod';
import { askClaudeJson } from '@/lib/ai/anthropic';
import {
  analysisTypeSummarySchema,
  detailAnalysisGenerationSchema,
  detailAnalysisRawSchema,
  finalAnalysisSchema,
  type DetailAnalysisGeneration,
  type FinalAnalysis,
} from '@/lib/schemas/character';

type UnknownRecord = Record<string, unknown>;

export const detailSeedSchema = z.object({
  version: z.literal('detail-seed/1.0'),
  name: z.string().min(1),
  oneLineSummary: z.string().min(1),
  summary: analysisTypeSummarySchema,
  analysisSeeds: z.array(z.string().min(1)).min(1),
});

const DETAIL_SYSTEM = `당신은 자캐커뮤니티 캐릭터의 유료 상세 캐해 리포트를 작성하는 분석가입니다.
입력에는 이미 전체 프로필·비밀 프로필·오너 검수·20문항을 읽은 1차 분석 AI가 만든 요약과 압축 분석 씨앗만 제공됩니다.
이 씨앗을 근거로 깊게 풀어 쓰되, 씨앗에 없는 새로운 과거·관계·심리 원인을 창작하지 마세요.
요약을 길게 반복하는 대신 행동 원리, 관계 패턴, 예외 조건, 겉과 속의 간극, 중요한 모순이 어떻게 연결되는지 설명하세요.
캐릭터를 임상적으로 진단하거나 정상/비정상으로 평가하지 마세요.`;

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

async function generateDetailFields(seed:z.infer<typeof detailSeedSchema>):Promise<DetailAnalysisGeneration>{
  let lastReason='';
  const baseInput=`캐릭터 이름: ${seed.name}\n\n무료 요약:\n${JSON.stringify({oneLineSummary:seed.oneLineSummary,summary:seed.summary})}\n\n상세 생성용 분석 씨앗:\n${JSON.stringify(seed.analysisSeeds)}\n\n출력 규칙:\n- outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 하나의 문자열입니다. 180~320자 정도를 목표로 충분히 구체적으로 쓰되 서버 허용 범위는 최소 140자, 최대 360자입니다. 짧은 단락 하나로 끝내지 마세요.\n- coreValues / desires / fears / misunderstoodPoints / contradictions / interestingPoints: 각 2~5개 문자열 배열, 항목당 8~80자.\n- detailedReport: 하나의 문자열 700~1400자. 위 항목을 그대로 반복하지 말고 캐릭터의 행동 원리와 관계 패턴, 예외, 모순을 하나의 흐름으로 통합하세요.\n- 분석 씨앗에 없는 새 사실을 만들지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  for(let attempt=0;attempt<3;attempt+=1){
    const retry=attempt===0?'':`\n\n이전 생성은 서버 검증에 실패했습니다. 이전 출력을 수리하지 말고 같은 분석 씨앗으로 새로 작성하세요. 실패 원인: ${lastReason}`;
    const raw=await askClaudeJson({
      system:DETAIL_SYSTEM,
      schema:detailAnalysisRawSchema,
      maxTokens:5200,
      input:`${baseInput}${retry}`,
    });
    const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
    if(parsed.success)return parsed.data;
    lastReason=validationReason(parsed.error);
  }

  throw new Error(`AI_JSON_SCHEMA_FAILED: ${lastReason||'DETAIL_LENGTH_FAILED'}`);
}

export async function generatePaidDetail(seedInput:unknown):Promise<FinalAnalysis>{
  const seed=detailSeedSchema.parse(seedInput);
  const detail=await generateDetailFields(seed);
  return finalAnalysisSchema.parse({
    oneLineSummary:seed.oneLineSummary,
    summary:seed.summary,
    ...detail,
  });
}
