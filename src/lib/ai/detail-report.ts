import { z } from 'zod';
import { askClaudeJson } from '@/lib/ai/anthropic';
import {
  analysisTypeSummarySchema,
  characterEvidencePackSchema,
  detailAnalysisGenerationSchema,
  finalAnalysisSchema,
  interviewAnswerSchema,
  type DetailAnalysisGeneration,
  type FinalAnalysis,
} from '@/lib/schemas/character';

type UnknownRecord = Record<string, unknown>;

export const DETAIL_REPORT_VERSION = 'detail-analysis/6.3' as const;

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

const qualityScoreSchema = z.object({
  evidenceStrength: z.number().int().min(0).max(3),
  specificity: z.number().int().min(0).max(3),
  latentDepth: z.number().int().min(0).max(3),
  counterEvidenceRobustness: z.number().int().min(0).max(3),
  inferenceDistance: z.number().int().min(0).max(3),
  predictiveValue: z.number().int().min(0).max(3),
  verdict: z.string().min(1).max(60),
});

const validatedInsightSchema = z.object({
  conclusion: z.string().min(20).max(520),
  mechanism: z.string().min(20).max(520),
  evidenceAnchors: z.array(z.string().min(4).max(320)).min(2).max(5),
  counterEvidence: z.array(z.string().min(4).max(300)).max(3).default([]),
  confidence: z.string().min(1).max(60),
  prediction: z.string().min(8).max(360),
  quality: qualityScoreSchema,
});

const psychologicalModelSchema = z.object({
  coreEngine: z.string().min(24).max(700),
  hiddenNeed: z.string().min(20).max(620),
  hiddenFear: z.string().min(20).max(620),
  selfProtection: z.string().min(20).max(620),
  blindSpot: z.string().min(20).max(620),
  intimacyLogic: z.string().min(20).max(620),
  conflictLogic: z.string().min(20).max(620),
  selfNarrative: z.string().min(20).max(620),
  validatedInsights: z.array(validatedInsightSchema).min(5).max(10),
  tensions: z.array(validatedInsightSchema).max(4).default([]),
  uncertainties: z.array(z.string().min(8).max(300)).max(5).default([]),
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

const PSYCHE_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 위한 심층 분석가입니다.
최종 글을 쓰지 마세요. 입력을 항목별로 다시 정리하는 것도 목적이 아닙니다.

내부적으로는 반드시 다음 순서로 분석하세요.
1) 관찰 가능한 행동과 선택을 의미 단위로 압축
2) 서로 떨어진 단서를 묶어 반복되는 주제를 찾기
3) 각 주제에 대해 더 단순한 대안 설명과 반례를 검토
4) 원자료에 직접 쓰이지 않은 잠재 기능과 심리적 보상을 추론
5) 품질 기준을 통과한 해석만 validatedInsights에 남기기
6) 통과한 해석을 바탕으로 coreEngine과 숨은 욕구·두려움·자기보호·맹점·관계 논리를 구성하기

중요:
- semantic code나 theme 자체를 별도 필드로 출력할 필요는 없습니다. 그것들은 내부 분석 절차일 뿐입니다.
- 원문에 바로 적힌 사실을 conclusion으로 다시 쓰면 실패입니다.
- "책임감이 강하다", "독립적이다" 같은 일반 라벨은 validatedInsights가 될 수 없습니다.
- validatedInsights는 최소 두 개의 독립 근거를 연결하고, 무엇을 얻거나 지키려는지와 어떤 조건에서 달라지는지를 설명해야 합니다.
- 대안 가설이 더 단순하게 자료를 설명하면 과한 심리 가설을 버리세요.
- 실제로 주어진 과거 사건이나 설정은 현재 성격과 연결해도 되지만, 자료에 없는 과거·트라우마·진단·숨겨진 사실은 만들지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더 같은 UI 흔적은 출력하지 마세요.

validatedInsights 전체는 특정 영역에 몰리지 않게 아래 다섯 축을 골고루 덮으세요.
- 본질적 성격·욕구·두려움·자기인식·자기기만
- 감정 구조·방어기제·스트레스 반응
- 대인관계·애착·연애·사람을 좋아하고 싫어하는 기준
- 가치관·도덕관·극한상황의 선택
- 강점과 약점의 양면성·매력 포인트·직접 쓰이지 않은 숨은 특성`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 쓰는 전문 해석자입니다.
당신에게는 원자료를 직접 읽고 검증까지 마친 "검증된 해석 묶음"만 주어집니다.
원 질문과 원 답변은 제공되지 않습니다. 따라서 답변을 항목별로 재분류하지 말고, 검증된 심리 메커니즘을 하나의 인물 해석으로 통합하세요.

리포트의 가치는 오너가 이미 아는 설정을 다시 말하는 데 있지 않습니다.
오너가 적어놓기는 했지만 아직 명확히 언어화하지 못했을 법한 숨은 욕구, 자기보호, 맹점, 관계의 기대, 행동이 뒤집히는 임계점, 자기기만과 양면성을 설득력 있게 보여주는 데 있습니다.

문체는 실제 상담사가 캐릭터 오너에게 옆에서 차분히 풀이해주는 것처럼 자연스러운 해요체 존댓말을 사용하세요.
- "~다.", "~이다.", "~한다." 같은 보고서체를 쓰지 마세요.
- 지나치게 격식적인 "~입니다.", "~합니다."도 남발하지 마세요.
- "~해요", "~보여요", "~수 있어요", "~쪽에 가까워요", "~로 보는 편이 자연스러워요"처럼 설명하듯 풀어주세요.
- 심리 상담이나 치료를 하는 사람처럼 진단하지 말고, 캐릭터를 잘 아는 전문 해석자가 이해를 돕는 톤을 유지하세요.

작성 원칙:
- 모든 문장은 끝까지 완결하세요. 조사·서술어·문장 중간에서 잘라 끝내지 마세요.
- evidenceAnchors를 목록처럼 다시 읽어주지 말고, 결론과 메커니즘을 먼저 설명한 뒤 구체적 행동은 짧은 예시로만 사용하세요.
- 같은 행동이나 같은 insight를 여러 섹션에서 반복하지 마세요.
- 모순은 상반된 행동을 나열하는 대신 같은 욕구가 왜 다른 행동으로 갈라지는지 설명하세요.
- 과거 원인은 실제 자료에 명시된 사건이나 환경이 있을 때만 연결하세요. 없으면 특정 과거를 상상하지 마세요.
- 극한 상황은 단순 A/B 예측이 아니라 어떤 가치를 지키기 때문에 그 선택으로 기우는지 설명하세요.
- 강점과 약점은 서로 다른 특성을 나열하지 말고 같은 특성이 어떤 조건에서 뒤집히는지 보여주세요.
- 숨은 특성은 직접 쓰인 설정의 동의어가 아니라 여러 단서를 연결해서 새로 보이는 것을 우선하세요.
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
    if(match)text=qualitativePosition(Number(match[4]),match[1].trim(),match[3].trim());
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

  return {question,answer:text,...(answer.reason?.trim()?{reason:answer.reason.trim()}: {})};
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
    packet:{summary:seed.summary,analysisSeeds:seed.analysisSeeds,note:'구버전 캐릭터라 저장된 해석 씨앗만 사용할 수 있음'},
    sources:[...seed.analysisSeeds,seed.oneLineSummary,...Object.values(seed.summary)],
  };
}

function allPsychText(model:PsychologicalModel){
  return [
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
    detail.corePersonality,detail.developmentalRoots,detail.emotionalStructure,detail.defenseAndStress,detail.relationshipPattern,detail.attachmentPattern,detail.romanceStyle,detail.attractionCriteria,detail.moralAndExtremeChoices,detail.selfDeception,detail.wantsVsNeeds,detail.statedVsEnacted,
    ...detail.coreValues,...detail.desires,...detail.fears,...detail.misunderstoodPoints,...detail.contradictions,...detail.interestingPoints,...detail.strengthsAndRisks,...detail.charmPoints,...detail.hiddenTraits,...detail.relationshipManual.gettingClose,...detail.relationshipManual.avoid,...detail.relationshipManual.affectionSignals,
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
    maxAttempts:1,
    input:`캐릭터 이름: ${seed.name}\n\n[원자료 — 이 호출에서만 사용]\n${JSON.stringify(packet)}\n\n작업 규칙:\n- 원 질문을 그대로 다시 쓰지 말고, 서로 떨어진 행동·상황·관계 조건을 연결해 해석하세요.\n- validatedInsights는 quality rubric 통과 항목만 남기세요. evidenceStrength/specificity/latentDepth/inferenceDistance는 각각 2 이상, 전체 합은 12 이상이어야 합니다.\n- evidenceAnchors는 질문 문장을 보존하지 말고 행동·상황·관계 조건만 짧게 남기세요.\n- prediction은 이 해석이 맞다면 다른 상황에서 어떤 반응을 보일지 적어 행동 예측력을 확인하세요.\n- tensions는 실제로 상반된 행동이 같은 욕구에서 갈라질 때만 작성하고 억지로 개수를 채우지 마세요.\n- 오너의 명시적 정정은 가장 높은 우선순위로 반영하세요.`,
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
    validatedInsights:validatedInsights.map(x=>({conclusion:x.conclusion,mechanism:x.mechanism,evidenceAnchors:x.evidenceAnchors,counterEvidence:x.counterEvidence,confidence:x.confidence,prediction:x.prediction})),
    tensions:tensions.map(x=>({conclusion:x.conclusion,mechanism:x.mechanism,evidenceAnchors:x.evidenceAnchors,counterEvidence:x.counterEvidence,confidence:x.confidence,prediction:x.prediction})),
    uncertainties:model.uncertainties,
  };
}

async function generateDetailFields(seed:DetailSeed,publicProfileText:string,privateSourceInput?:unknown):Promise<DetailAnalysisGeneration>{
  const {packet,sources}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  const psyche=await buildPsychologicalModel(seed,packet);
  const dossier=buildReportDossier(psyche);

  const input=`캐릭터 이름: ${seed.name}\n\n[검증된 심층 해석 묶음 — 최종 작가가 사용할 수 있는 전부]\n${JSON.stringify(dossier)}\n\n공통 규칙:\n- 원 질문/원 답변을 떠올려 재구성하지 마세요.\n- 사용자에게 노출되는 모든 문장은 자연스러운 해요체 존댓말로 쓰세요.\n- 문장은 조사나 서술어 중간에서 끊지 말고 반드시 완결하세요.\n- 서로 다른 섹션이 같은 insight나 행동 예시를 반복하지 않도록 각 섹션의 초점을 분리하세요.\n- 새로운 과거 사건이나 숨겨진 설정을 창작하지 마세요. developmentalRoots는 실제 과거 근거가 없으면 특정 원인을 단정하지 마세요.\n\n기존 핵심 섹션:\n- outerSelf: 타인이 체감하는 표면 태도와 실제 내부 판단의 간극. 의미가 전환되는 곳에서 자연스럽게 문단을 나누세요.\n- innerSelf: 숨은 욕구·두려움·자기보호·자기서사를 연결해 실제 선택을 움직이는 심리를 설명하세요.\n- conflictStyle: 불편함 감지 → 초기 대응 → 임계점 → 한계 반응 → 물러나는 예외의 흐름을 보여주세요.\n- affectionStyle: 애정 행동 목록보다 친밀함 속에서 무엇을 확인받고 싶어 하는지 설명하세요.\n- coreValues / desires / fears: 각각 2~5개를 목표로 하되, 억지로 개수를 채우기보다 실제로 구분되는 심리적 기능만 완결된 문장으로 적으세요.\n- misunderstoodPoints / contradictions: 실제로 설명 가능한 것만 작성하세요. 없으면 빈 배열도 괜찮습니다.\n- interestingPoints: 직접 쓰인 설정의 재진술이 아니라 여러 단서를 연결해 새로 보이는 부분을 우선하세요.\n\n추가 심층 섹션:\n- corePersonality: 이 캐릭터가 본질적으로 어떤 사람인지, 무엇을 얻고 지키기 위해 움직이는지, 자기 인식과 타인의 인상이 어디서 갈리는지 2~3문단으로 풀어주세요.\n- developmentalRoots: 실제로 명시된 과거 경험·사건·환경이 현재 성격과 가치관, 관계 방식, 방어 습관에 남긴 흔적을 인과적으로 설명하세요. 근거가 없으면 원인을 지어내지 말고 현재 성격을 유지시키는 구조까지만 설명하세요.\n- emotionalStructure: 화가 날 때 실제 무엇에 상처받는지, 슬픔·질투·죄책감·수치심·불안을 어떻게 처리하는지, 본인조차 인정하기 어려운 감정이 무엇인지 설명하세요.\n- defenseAndStress: 주로 쓰는 방어와 스트레스 반응을 설명하고 평상시 → 압박받을 때 → 한계에 몰렸을 때 어떻게 달라지는지 흐름으로 보여주세요.\n- relationshipPattern: 첫 만남, 친해지는 조건, 가까운 사람과 싫어하는 사람, 강한 사람/약한 사람, 주도권, 신뢰 기준, 관계를 끊는 기준을 하나의 관계 논리로 엮으세요.\n- attachmentPattern: 누군가와 친밀해지는 과정, 사랑받는다는 확인 방식, 상대에게 원하는 것, 의존 허용도와 버림·배신·구속 중 민감한 위협을 설명하세요.\n- romanceStyle: 좋아하게 되는 속도, 플러팅·고백, 연애 초반과 장기 관계, 질투·싸움·이별, 잘 맞는 상대와 최악의 상대를 심리 원리와 연결해 설명하세요.\n- attractionCriteria: 어떤 사람에게 약하고 어떤 사람을 싫어하는지 표면 취향이 아니라 내적 기준으로 설명하세요.\n- moralAndExtremeChoices: 절대 양보하지 않는 것, 타협 가능한 것, 거짓말·수단·용서의 기준과 극한 선택에서 무엇을 우선할지 이유까지 설명하세요.\n- selfDeception: 스스로 믿는 자기상과 반복 행동이 맞지 않는 부분, 인정하고 싶지 않은 욕망, 자기 행동을 정당화하는 논리를 설명하세요.\n- wantsVsNeeds: 본인이 원한다고 느끼는 것과 실제로 안정되고 성장하기 위해 필요한 것이 어떻게 다른지 설명하세요.\n- statedVsEnacted: 표면 설정·자기서술과 반복 행동에서 실제로 읽히는 모습의 차이를 설명하세요. 오너의 의도는 명시적으로 확인된 경우만 추정하세요.\n- strengthsAndRisks: 같은 특성이 어떤 상황에서는 강점이 되고 다른 상황에서는 약점이 되는지 한 항목 안에서 양면을 함께 적으세요.\n- charmPoints: 첫인상, 알고 지낼수록 생기는 매력, 위험하지만 끌리는 점, 호불호가 갈릴 지점을 캐릭터 고유의 이유와 함께 적으세요.\n- hiddenTraits: 직접 적혀 있지 않지만 여러 독립 단서를 연결했을 때 자연스럽게 도출되는 숨은 특성만 적으세요.\n- relationshipManual.gettingClose: 이 캐릭터와 친해지는 방법.\n- relationshipManual.avoid: 이 캐릭터에게 특히 하면 안 되는 것.\n- relationshipManual.affectionSignals: 이 캐릭터가 누군가를 좋아하고 신뢰한다는 신호. 각 항목은 RP에 바로 쓸 수 있을 정도로 구체적으로 적으세요.\n- detailedReport: 위 항목을 다시 순서대로 요약하지 말고 coreEngine을 중심으로 욕구·두려움·감정·방어·관계·자기기만·극한 선택이 어떻게 하나의 사람 안에서 이어지는지 3~6문단으로 통합하세요.\n\n질문 번호, 점수, 퍼센트, 슬라이더 값, 선택지 번호, 분석 과정이나 입력 출처를 드러내는 표현은 사용하지 마세요.`;

  const detail=await askClaudeJson({
    system:REPORT_SYSTEM,
    schema:detailAnalysisGenerationSchema,
    maxAttempts:1,
    input,
    allowFallback:false,
  });

  const reportText=allReportText(detail);
  const artifact=uiArtifactReason(reportText);
  if(artifact)throw new Error(`AI_JSON_SCHEMA_FAILED: ${artifact}`);
  if(hasLongVerbatimOverlap(reportText,sources))throw new Error('AI_JSON_SCHEMA_FAILED: 원자료의 긴 문장이 그대로 복사됨');
  return detail;
}

export type VersionedFinalAnalysis = FinalAnalysis & {detailVersion:typeof DETAIL_REPORT_VERSION};

export async function generatePaidDetail(seedInput:unknown,publicProfileText='',privateSourceInput?:unknown):Promise<VersionedFinalAnalysis>{
  const seed=detailSeedSchema.parse(seedInput);
  const detail=await generateDetailFields(seed,publicProfileText,privateSourceInput);
  const analysis=finalAnalysisSchema.parse({oneLineSummary:seed.oneLineSummary,summary:seed.summary,...detail});
  return {...analysis,detailVersion:DETAIL_REPORT_VERSION};
}
