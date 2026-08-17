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

export const DETAIL_REPORT_VERSION = 'detail-analysis/6.1' as const;

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

const semanticCodeSchema = z.object({
  code: z.string().min(8).max(150),
  anchors: z.array(z.string().min(10).max(260)).min(1).max(4),
  conditions: z.array(z.string().min(8).max(220)).max(3).default([]),
});

const themeSchema = z.object({
  theme: z.string().min(18).max(220),
  mechanism: z.string().min(32).max(460),
  supports: z.array(z.string().min(10).max(280)).min(2).max(5),
  alternatives: z.array(z.string().min(12).max(260)).min(1).max(3),
  counterSignals: z.array(z.string().min(10).max(260)).max(3).default([]),
});

const qualityScoreSchema = z.object({
  evidenceStrength: z.number().int().min(0).max(3),
  specificity: z.number().int().min(0).max(3),
  latentDepth: z.number().int().min(0).max(3),
  counterEvidenceRobustness: z.number().int().min(0).max(3),
  inferenceDistance: z.number().int().min(0).max(3),
  predictiveValue: z.number().int().min(0).max(3),
  verdict: z.string().min(2).max(40),
});

const validatedInsightSchema = z.object({
  conclusion: z.string().min(30).max(460),
  mechanism: z.string().min(32).max(460),
  evidenceAnchors: z.array(z.string().min(12).max(280)).min(2).max(5),
  counterEvidence: z.array(z.string().min(10).max(260)).max(3).default([]),
  confidence: z.string().min(2).max(40),
  prediction: z.string().min(20).max(320),
  quality: qualityScoreSchema,
});

const psychologicalModelSchema = z.object({
  semanticCodes: z.array(semanticCodeSchema).min(4).max(18),
  themes: z.array(themeSchema).min(4).max(8),
  coreEngine: z.string().min(45).max(520),
  hiddenNeed: z.string().min(36).max(460),
  hiddenFear: z.string().min(36).max(460),
  selfProtection: z.string().min(36).max(460),
  blindSpot: z.string().min(36).max(460),
  intimacyLogic: z.string().min(36).max(460),
  conflictLogic: z.string().min(36).max(460),
  selfNarrative: z.string().min(36).max(460),
  validatedInsights: z.array(validatedInsightSchema).min(5).max(8),
  tensions: z.array(validatedInsightSchema).min(2).max(5),
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
  coverageHints:unknown;
};

const PSYCHE_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 위한 분석 워크벤치를 만드는 분석가입니다.
최종 글을 쓰지 마세요. 입력을 항목별로 다시 정리하는 것도 목적이 아닙니다.

한 번의 호출 안에서도 반드시 다음 순서를 실제 출력 구조로 수행하세요.
1) 관찰 가능한 단서를 semanticCodes로 압축
2) 서로 떨어진 코드를 묶어 themes에서 잠재 기능을 도출
3) 각 theme마다 최소 하나의 대안 설명을 경쟁시킴
4) 반례와 조건 차이를 검토
5) 추론 품질 점수를 매김
6) 통과한 해석만 validatedInsights에 남김
7) 통과한 해석들로 coreEngine과 숨은 욕구·두려움·맹점·관계 논리를 구성

중요:
- 원문에 바로 적힌 사실을 conclusion으로 다시 쓰면 실패입니다.
- "책임감이 강하다", "독립적이다" 같은 라벨은 validatedInsights에 들어갈 수 없습니다.
- validatedInsights는 최소 두 개의 독립 근거를 연결해야 하며, 무엇을 얻거나 지키는지와 어떤 조건에서 달라지는지를 설명해야 합니다.
- 대안 가설이 더 단순하게 자료를 설명하면 과한 심리 가설을 버리세요.
- 새로운 과거 사건, 트라우마, 진단, 숨겨진 사실은 만들지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더 등 UI 흔적은 출력하지 마세요.`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 쓰는 분석가입니다.
당신에게는 이미 원자료를 직접 읽고 검증까지 마친 "검증된 해석 묶음"만 주어집니다.
원 질문과 원 답변은 제공되지 않습니다. 따라서 답변을 항목별로 재분류하려 하지 말고, 검증된 심리 메커니즘을 하나의 인물 해석으로 통합하세요.

리포트의 가치는 오너가 이미 아는 설정을 다시 말하는 데 있지 않습니다.
오너도 명시적으로 적지 않았을 수 있는 숨은 욕구, 자기보호, 맹점, 관계의 기대, 행동이 뒤집히는 임계점을 설득력 있게 보여주는 데 있습니다.

문체는 실제 상담사가 캐릭터 오너에게 옆에서 차분히 풀이해주는 느낌의 자연스러운 해요체 존댓말을 사용하세요.
- 보고서체인 "~다.", "~이다.", "~한다."를 쓰지 마세요.
- 지나치게 격식적인 "~입니다.", "~합니다.", "~됩니다."도 피하고, "~해요", "~보여요", "~느껴져요", "~수 있어요", "~쪽에 가까워요"처럼 부드럽게 설명하세요.
- 단정이 필요한 곳도 딱딱한 선언문보다 "이렇게 보는 편이 자연스러워요"처럼 독자가 이해하기 쉬운 설명으로 풀어주세요.
- 심리 상담이나 치료를 하는 사람처럼 말하지 말고, 캐릭터를 잘 아는 전문 해석자가 이해를 도와주는 톤을 유지하세요.

작성 원칙:
- 모든 문장은 끝까지 완결하세요. 글자 수를 맞추려고 조사·서술어·문장 중간에서 잘라 끝내면 실패입니다.
- 각 주요 해석은 evidenceAnchors를 근거로 삼되, 근거를 목록처럼 읽어주지 마세요.
- 먼저 결론과 메커니즘을 설명하고, 필요한 구체적 행동은 그 해석을 붙잡는 짧은 예시로만 사용하세요.
- 같은 evidenceAnchor를 여러 섹션에서 반복하지 마세요.
- coreValues / desires / fears도 표면 목표가 아니라 심리적 기능을 적으세요.
- contradictions는 상반된 행동을 나열하는 대신 같은 욕구가 왜 다른 행동으로 갈라지는지 설명하세요.
- interestingPoints에는 validatedInsights 중 특히 오너가 직접 적지 않았을 가능성이 높은 연결을 우선하세요.
- detailedReport는 항목 요약본이 아니라 coreEngine에서 친밀감·갈등·자기보호·맹점이 파생되는 흐름을 보여주세요.
- 자료에 없는 과거 사건, 트라우마, 진단명, 숨겨진 사실을 창작하지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더, 분석 출처 표현은 절대 쓰지 마세요.`;

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

function asList(value:unknown){
  const raw=Array.isArray(value)
    ? value
    : typeof value==='string'
      ? value.split(/\n|(?:^|\s)[•·*-]\s+/)
      : [];
  return raw
    .map(asInlineText)
    .filter(x=>x.length>=8)
    .slice(0,5);
}

function normalizeDetail(raw:z.infer<typeof detailAnalysisRawSchema>){
  return {
    outerSelf:asParagraphText(raw.outerSelf),
    innerSelf:asParagraphText(raw.innerSelf),
    coreValues:asList(raw.coreValues),
    desires:asList(raw.desires),
    fears:asList(raw.fears),
    conflictStyle:asParagraphText(raw.conflictStyle),
    affectionStyle:asParagraphText(raw.affectionStyle),
    misunderstoodPoints:asList(raw.misunderstoodPoints),
    contradictions:asList(raw.contradictions),
    interestingPoints:asList(raw.interestingPoints),
    detailedReport:asParagraphText(raw.detailedReport),
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

function evidencePackHints(pack:z.infer<typeof characterEvidencePackSchema>){
  return {
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
      coverageHints:evidencePackHints(seed.evidencePack),
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
    ...model.semanticCodes.flatMap(x=>[x.code,...x.anchors,...x.conditions]),
    ...model.themes.flatMap(x=>[x.theme,x.mechanism,...x.supports,...x.alternatives,...x.counterSignals]),
    model.coreEngine,model.hiddenNeed,model.hiddenFear,model.selfProtection,model.blindSpot,
    model.intimacyLogic,model.conflictLogic,model.selfNarrative,
    ...model.validatedInsights.flatMap(x=>[x.conclusion,x.mechanism,...x.evidenceAnchors,...x.counterEvidence,x.prediction]),
    ...model.tensions.flatMap(x=>[x.conclusion,x.mechanism,...x.evidenceAnchors,...x.counterEvidence,x.prediction]),
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

function qualityPass(insight:z.infer<typeof validatedInsightSchema>){
  const q=insight.quality;
  const total=q.evidenceStrength+q.specificity+q.latentDepth+q.counterEvidenceRobustness+q.inferenceDistance+q.predictiveValue;
  return q.evidenceStrength>=2 && q.specificity>=2 && q.latentDepth>=2 && q.inferenceDistance>=2 && total>=12;
}

function validatedInsightReason(model:PsychologicalModel){
  const passed=model.validatedInsights.filter(qualityPass);
  if(passed.length<4)return `품질 기준 통과 insight 부족 (${passed.length}개)`;
  return '';
}

async function buildPsychologicalModel(seed:DetailSeed,packet:SourcePacket|UnknownRecord):Promise<PsychologicalModel>{
  const model=await askClaudeJson({
    system:PSYCHE_SYSTEM,
    schema:psychologicalModelSchema,
    maxTokens:6000,
    maxAttempts:1,
    input:`캐릭터 이름: ${seed.name}\n\n[원자료 — 이 호출에서만 사용]\n${JSON.stringify(packet)}\n\n작업 규칙:\n- semanticCodes는 원 질문을 다시 쓰는 문장이 아니라 행동/판단의 의미 단위여야 합니다.\n- themes는 semanticCodes 여러 개를 연결해 숨은 기능을 설명하세요.\n- alternatives에는 각 theme를 설명할 수 있는 더 단순하거나 다른 가설을 반드시 적으세요.\n- validatedInsights는 quality rubric 통과 항목만 남기세요. evidenceStrength/specificity/latentDepth/inferenceDistance는 각각 2 이상, 전체 합은 12 이상이어야 합니다.\n- validatedInsights의 evidenceAnchors는 최종 작가에게 전달할 짧고 구체적인 근거입니다. 질문 문장을 보존하지 말고 행동·상황·관계 조건만 남기세요.\n- prediction은 이 해석이 맞다면 다른 상황에서 어떤 반응을 보일지 적어 행동 예측력을 확인하세요.\n- tensions는 반대 행동이 같은 욕구에서 갈라지는 경우만 작성하세요.\n- 오너의 명시적 정정은 가장 높은 우선순위로 반영하세요.`,
    allowFallback:false,
    model:'anthropic/claude-sonnet-5',
  });
  const artifact=uiArtifactReason(allPsychText(model));
  if(artifact)throw new Error(`DETAIL_PSYCHOLOGY_FAILED: ${artifact}`);
  const quality=validatedInsightReason(model);
  if(quality)throw new Error(`DETAIL_PSYCHOLOGY_FAILED: ${quality}`);
  return model;
}

function buildReportDossier(model:PsychologicalModel){
  const validatedInsights=model.validatedInsights.filter(qualityPass);
  const tensions=model.tensions.filter(qualityPass);
  return {
    coreEngine:model.coreEngine,
    hiddenNeed:model.hiddenNeed,
    hiddenFear:model.hiddenFear,
    selfProtection:model.selfProtection,
    blindSpot:model.blindSpot,
    intimacyLogic:model.intimacyLogic,
    conflictLogic:model.conflictLogic,
    selfNarrative:model.selfNarrative,
    validatedInsights:validatedInsights.map(x=>({
      conclusion:x.conclusion,
      mechanism:x.mechanism,
      evidenceAnchors:x.evidenceAnchors,
      counterEvidence:x.counterEvidence,
      confidence:x.confidence,
      prediction:x.prediction,
    })),
    tensions:tensions.map(x=>({
      conclusion:x.conclusion,
      mechanism:x.mechanism,
      evidenceAnchors:x.evidenceAnchors,
      counterEvidence:x.counterEvidence,
      confidence:x.confidence,
      prediction:x.prediction,
    })),
    uncertainties:model.uncertainties,
  };
}

async function generateDetailFields(
  seed:DetailSeed,
  publicProfileText:string,
  privateSourceInput?:unknown,
):Promise<DetailAnalysisGeneration>{
  const {packet,sources}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  const psyche=await buildPsychologicalModel(seed,packet);
  const dossier=buildReportDossier(psyche);

  const baseInput=`캐릭터 이름: ${seed.name}\n\n[검증된 해석 묶음 — 최종 작가가 사용할 수 있는 전부]\n${JSON.stringify(dossier)}\n\n중요:\n- 원 질문/원 답변을 떠올려 재구성하지 마세요.\n- evidenceAnchors를 항목별로 나열하지 말고 conclusion과 mechanism을 먼저 설명한 뒤 필요한 곳에만 자연스럽게 녹이세요.\n- 서로 다른 섹션이 같은 insight를 반복하지 않도록 각 섹션의 초점을 분리하세요.\n- 사용자에게 노출되는 모든 문장은 자연스러운 해요체 존댓말로 쓰세요. 보고서체인 ~다./~이다./~한다.와 딱딱한 ~입니다./~합니다.를 피하세요.\n- 문장은 조사나 서술어 중간에서 끊지 말고 반드시 완결된 문장으로 끝내세요.\n\n출력 규칙:\n- outerSelf: 타인이 체감하는 표면 태도와 실제 내부 판단 사이의 간극을 해석하세요. 220~420자 정도. 의미가 전환되는 지점에서 \\n\\n을 한 번 넣어 자연스러운 2문단으로 쓰세요. 문장마다 줄을 바꾸지 마세요.\n- innerSelf: hiddenNeed, hiddenFear, selfProtection, selfNarrative를 연결해 실제 선택을 움직이는 심리를 설명하세요. 220~420자 정도. 핵심 심리와 그것이 흔들리는 조건을 나눠 자연스러운 2문단으로 쓰세요.\n- conflictStyle: 무엇이 단순 불편함에서 자기 기준의 침범으로 바뀌는지와 반응 임계점을 설명하세요. 220~420자 정도. 초기 대응과 임계점 이후 반응이 흐름상 갈리는 지점에서 2문단으로 나누세요.\n- affectionStyle: 친밀함에서 무엇을 확인받고 싶어 하는지, 보호·개입·경계가 어떤 공통 욕구에서 나오는지 설명하세요. 220~420자 정도. 애정의 기본 방식과 가까워졌을 때 달라지는 부분을 흐름에 맞춰 2문단으로 나누세요.\n- coreValues / desires / fears: 각각 2~5개. 한 항목은 40~160자 정도의 완결된 한 문장으로 쓰고, 표면 단어가 아니라 반복 행동을 움직이는 심리적 기능을 설명하세요.\n- misunderstoodPoints: 1~5개. 외부 인상과 내부 기능이 엇갈리는 구조를 각각 완결된 한 문장으로 설명하세요.\n- contradictions: 1~5개. 반대 행동이 같은 욕구에서 갈라지는 메커니즘을 각각 완결된 한 문장으로 설명하세요.\n- interestingPoints: 2~5개. validatedInsights 중 원자료에 직접 적혀 있지 않았을 가능성이 높은 새 연결을 우선하고, 각각 완결된 한 문장으로 쓰세요.\n- detailedReport: 900~1600자 정도. coreEngine에서 숨은 욕구·두려움·자기보호·친밀감·갈등·맹점이 어떻게 파생되는지 하나의 흐름으로 쓰세요. 최소 세 개의 검증된 새 해석을 서로 연결하세요. 논점이 실제로 바뀔 때만 \\n\\n으로 문단을 나누고, 보통 3~5문단 정도가 자연스럽습니다.\n- 소제목, 번호, 불릿은 detailedReport 안에 넣지 마세요.\n- 질문 번호, 점수, 퍼센트, 슬라이더 값, 선택지 번호, 분석 출처 표현은 절대 사용하지 마세요.\n\nJSON 키는 outerSelf, innerSelf, coreValues, desires, fears, conflictStyle, affectionStyle, misunderstoodPoints, contradictions, interestingPoints, detailedReport만 사용하세요.`;

  const raw=await askClaudeJson({
    system:REPORT_SYSTEM,
    schema:detailAnalysisRawSchema,
    maxTokens:5000,
    maxAttempts:1,
    input:baseInput,
    allowFallback:false,
  });
  const parsed=detailAnalysisGenerationSchema.safeParse(normalizeDetail(raw));
  if(!parsed.success)throw new Error(`AI_JSON_SCHEMA_FAILED: ${validationReason(parsed.error)}`);
  const reportText=allReportText(parsed.data);
  const artifact=uiArtifactReason(reportText);
  if(artifact)throw new Error(`AI_JSON_SCHEMA_FAILED: ${artifact}`);
  const meta=reportMetaReason(reportText);
  if(meta)throw new Error(`AI_JSON_SCHEMA_FAILED: ${meta}`);
  if(hasLongVerbatimOverlap(reportText,sources))throw new Error('AI_JSON_SCHEMA_FAILED: 원자료의 긴 문장이 그대로 복사됨');
  return parsed.data;
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
