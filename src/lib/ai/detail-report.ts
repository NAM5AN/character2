import { z } from 'zod';
import { askClaudeJson, rewriteReportLeads } from '@/lib/ai/anthropic';
import {
  analysisTypeSummarySchema,
  characterEvidencePackSchema,
  finalAnalysisSchema,
  interviewAnswerSchema,
  desireGapSchema,
  matchProfileSchema,
  relationshipManualSchema,
  pressureStagesSchema,
  tagListSchema,
  tldrLineSchema,
  spectrumListSchema,
  type FinalAnalysis,
} from '@/lib/schemas/character';

type UnknownRecord = Record<string, unknown>;

export const DETAIL_REPORT_VERSION = 'detail-analysis/6.7' as const;
export const DETAIL_STAGE_COUNT = 3 as const;

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
  verdict: z.string(),
});

const validatedInsightSchema = z.object({
  conclusion: z.string(),
  mechanism: z.string(),
  evidenceAnchors: z.array(z.string()).min(2),
  counterEvidence: z.array(z.string()).default([]),
  confidence: z.string(),
  prediction: z.string(),
  quality: qualityScoreSchema,
});

const psychologicalModelSchema = z.object({
  coreEngine: z.string(),
  hiddenNeed: z.string(),
  hiddenFear: z.string(),
  selfProtection: z.string(),
  blindSpot: z.string(),
  intimacyLogic: z.string(),
  conflictLogic: z.string(),
  selfNarrative: z.string(),
  validatedInsights: z.array(validatedInsightSchema).min(4),
  tensions: z.array(validatedInsightSchema).default([]),
  uncertainties: z.array(z.string()).default([]),
});

const reportDossierSchema = z.object({
  coreEngine:z.string(),
  hiddenNeed:z.string(),
  hiddenFear:z.string(),
  selfProtection:z.string(),
  blindSpot:z.string(),
  intimacyLogic:z.string(),
  conflictLogic:z.string(),
  selfNarrative:z.string(),
  validatedInsights:z.array(z.object({
    conclusion:z.string(),
    mechanism:z.string(),
    evidenceAnchors:z.array(z.string()),
    counterEvidence:z.array(z.string()),
    confidence:z.string(),
    prediction:z.string(),
  })),
  tensions:z.array(z.object({
    conclusion:z.string(),
    mechanism:z.string(),
    evidenceAnchors:z.array(z.string()),
    counterEvidence:z.array(z.string()),
    confidence:z.string(),
    prediction:z.string(),
  })),
  uncertainties:z.array(z.string()),
});

export type ReportDossier = z.infer<typeof reportDossierSchema>;
type PsychologicalModel = z.infer<typeof psychologicalModelSchema>;
type DetailSeed = z.infer<typeof detailSeedSchema>;
type PrivateDetailSource = z.infer<typeof privateDetailSourceSchema>;

type SemanticAnswer = {question:string;answer:string;reason?:string};
type SourcePacket = {
  publicProfile:string;
  secretProfile:string;
  ownerReview:unknown;
  confirmedFacts:unknown[];
  interview:SemanticAnswer[];
  coverageHints:unknown;
};

// 구조화 블록·태그 필드는 optional — 모델이 생략해도 산문 리포트는 정상 생성된다(라이브 결제 경로 보호).
// 섹션 태그는 섹션별 평면 키(...Tags)로 받아 스테이지 병합({...기존,...패치}) 시 충돌 없이 합쳐지게 한다.
const stage1Schema=z.object({characterOverview:z.string(),innerMechanics:z.string(),desireGap:desireGapSchema.optional(),characterOverviewTags:tagListSchema.optional(),innerMechanicsTags:tagListSchema.optional(),characterOverviewTldr:tldrLineSchema.optional(),innerMechanicsTldr:tldrLineSchema.optional(),characterOverviewSpectrums:spectrumListSchema.optional(),innerMechanicsSpectrums:spectrumListSchema.optional()});
const stage2Schema=z.object({relationshipStyle:z.string(),attachmentStyle:z.string(),conflictStyleDetailed:z.string(),relationshipManual:relationshipManualSchema.optional(),matchProfile:matchProfileSchema.optional(),pressureStages:pressureStagesSchema.optional(),relationshipStyleTags:tagListSchema.optional(),attachmentStyleTags:tagListSchema.optional(),conflictStyleDetailedTags:tagListSchema.optional(),relationshipStyleTldr:tldrLineSchema.optional(),attachmentStyleTldr:tldrLineSchema.optional(),conflictStyleDetailedTldr:tldrLineSchema.optional(),relationshipStyleSpectrums:spectrumListSchema.optional(),attachmentStyleSpectrums:spectrumListSchema.optional(),conflictStyleDetailedSpectrums:spectrumListSchema.optional()});
const stage3Schema=z.object({charmAndContradictions:z.string(),integratedReport:z.string(),charmAndContradictionsTags:tagListSchema.optional(),integratedReportTags:tagListSchema.optional(),charmAndContradictionsTldr:tldrLineSchema.optional(),integratedReportTldr:tldrLineSchema.optional(),charmAndContradictionsSpectrums:spectrumListSchema.optional(),integratedReportSpectrums:spectrumListSchema.optional()});

const PSYCHE_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 위한 심층 분석가입니다.
최종 글을 쓰지 마세요. 입력을 항목별로 다시 정리하는 것도 목적이 아닙니다.

내부적으로 반드시 다음 순서로 분석하세요.
1) 관찰 가능한 행동과 선택을 의미 단위로 압축
2) 서로 떨어진 단서를 묶어 반복되는 주제를 찾기
3) 각 주제에 대해 더 단순한 대안 설명과 반례를 검토
4) 표면 행동에서 한 겹에서 멈추지 말고 사슬로 더 내려가기: 행동 → 잠재 기능(무엇을 위해 하는가) → 그 기능이 지키려는 근원 욕구·두려움 → 그것이 만든 자기상·맹점 → 그 구조가 관계·애착·갈등에서 반복되는 방식과 뒤집히는 조건. 각 validatedInsight는 이 사슬에서 가능한 한 깊은 지점까지 도달해야 합니다.
5) 품질 기준을 통과한 해석만 validatedInsights에 남기기
6) 통과한 해석을 바탕으로 coreEngine과 숨은 욕구·두려움·자기보호·맹점·관계 논리를 구성하기

중요:
- semantic code나 theme 자체를 별도 필드로 출력할 필요는 없습니다. 그것들은 내부 분석 절차일 뿐입니다.
- 원문에 바로 적힌 사실을 conclusion으로 다시 쓰면 실패입니다.
- "책임감이 강하다", "독립적이다" 같은 일반 라벨은 validatedInsights가 될 수 없습니다.
- validatedInsights는 최소 두 개의 독립 근거를 연결하고, 무엇을 얻거나 지키려는지와 어떤 조건에서 달라지는지를 설명해야 합니다.
- 해석 깊이가 이 리포트의 핵심 가치입니다. validatedInsights 중 최소 절반은 표면 행동에서 두 단계 이상 내려간 해석(행동→기능→근원 욕구·두려움→자기상·맹점 중 최소 두 단계 연결)이어야 합니다. "행동→그 행동의 기준·보상" 한 단계에서 멈춘 해석만 가득하면 프로필을 다시 읽어주는 수준이 되어 실패입니다.
- 여러 단서를 연결해야만 보이는, 오너가 의식적으로 설계하지 않았을 법한 해석을 최소 2~3개 포함하세요. 오너가 프로필에 이미 명시한 것을 확인하는 수준이면 부족합니다.
- 단, 깊게 간다고 없는 사실을 지어내는 것은 여전히 금지입니다. 자료가 지지하지 않는 과거·트라우마·진단·비밀 사실을 만들지 말고, 있는 단서들 사이의 숨은 연결·기능·자기상을 더 깊게 읽는 방식으로만 깊이를 확보하세요.
- 대안 가설이 더 단순하게 자료를 설명하면 과한 심리 가설을 버리세요.
- 실제로 주어진 과거 사건이나 설정은 현재 성격과 연결해도 되지만, 자료에 없는 과거·트라우마·진단·숨겨진 사실은 만들지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더 같은 UI 흔적은 출력하지 마세요.

validatedInsights 전체는 특정 영역에 몰리지 않게 아래 여섯 축을 모두 덮으세요. 한 insight가 둘 이상의 축을 연결해도 되며, 축마다 하나씩 억지로 만들 필요는 없습니다.
- 본질적 성격·겉과 속·자기인식·과거가 남긴 영향·숨은 특성
- 욕구·결핍·두려움·감정 구조·방어기제·자기기만·원하는 것과 필요한 것
- 일반 대인관계·신뢰·주도권·사람을 좋아하고 싫어하는 기준·관계 사용 설명서
- 애착·친밀감·애정표현·의존·연애·질투·이별·잘 맞고 힘든 상대
- 갈등·스트레스·가치관·도덕관·극한상황 선택
- 모순·오해받는 지점·강점과 약점의 양면성·매력 포인트·새롭게 읽히는 부분`;

const REPORT_SYSTEM = `당신은 자캐커뮤니티의 유료 상세 캐해 리포트를 쓰는 전문 해석자입니다.
당신에게는 원자료를 직접 읽고 검증까지 마친 "검증된 해석 묶음"만 주어집니다.
원 질문과 원 답변은 제공되지 않습니다. 답변을 항목별로 재분류하지 말고, 검증된 심리 메커니즘을 자연스러운 인물 해석으로 통합하세요.

리포트의 가치는 오너가 이미 아는 설정을 다시 말하는 데 있지 않습니다.
오너가 적어놓기는 했지만 아직 명확히 언어화하지 못했을 법한 숨은 욕구, 자기보호, 맹점, 관계의 기대, 행동이 뒤집히는 임계점, 자기기만과 양면성을 설득력 있게 보여주세요.

문체는 실제 상담사가 캐릭터 오너에게 옆에서 차분히 풀이해주는 것처럼 자연스러운 해요체 존댓말을 사용하세요.
- "~다.", "~이다.", "~한다." 같은 보고서체를 쓰지 마세요.
- 지나치게 격식적인 "~입니다.", "~합니다."도 남발하지 마세요.
- "~해요", "~보여요", "~수 있어요", "~쪽에 가까워요", "~로 보는 편이 자연스러워요"처럼 설명하듯 풀어주세요.
- 심리 상담이나 치료를 하는 사람처럼 진단하지 말고, 캐릭터를 잘 아는 전문 해석자가 이해를 돕는 톤을 유지하세요.

문단 첫 안내문 규칙 — 반드시 지키세요:
- 자연스럽게 나뉜 모든 문단의 첫 문장은 반드시 **굵은 안내문**이어야 합니다. Markdown 별표 두 개로 감싸세요.
- 안내문은 그 문단의 결론을 미리 말하는 요약문이 아니라, 이제 어떤 주제를 살펴볼지 독자에게 알려주는 짧은 길잡이 문장입니다.
- 한 문단에는 A형 또는 C형 중 하나만 사용하세요. 두 방식을 한 문장에 합치지 마세요.
- A형 예: **가까운 관계에서 이 캐릭터가 상대에게 바라는 방식부터 볼게요.**
- C형 예: **좋아하는 사람 앞에서는 어떻게 달라질까요?**
- A-C-A-C처럼 기계적으로 번갈아 쓰지 마세요. 같은 형식이 연속되어도 자연스러우면 괜찮습니다.
- **이 캐릭터는 통제욕이 강해요.**처럼 해석 결론 자체를 굵은 안내문으로 쓰면 실패입니다.
- "이 문단에서는", "분석해보면", 명사만 덩그러니 놓인 소제목 같은 표현은 피하세요.
- 안내문 뒤에는 같은 문단 안에서 바로 본문을 이어 쓰고, 문단 사이에는 빈 줄 하나를 두세요.

본문 강조 규칙 — 독자가 긴 글에서 핵심을 잡을 수 있게 하는 장치입니다:
- 문단의 첫 별표 묶음은 안내문이고, 그 뒤 본문 안에서 별표 두 개로 감싼 부분은 화면에서 형광펜 하이라이트로 표시됩니다.
- 각 문단 본문에서 가장 중요한 해석 1~2곳을 별표 두 개로 감싸세요. 문단이 짧으면 1곳만, 강조할 만한 지점이 없으면 넣지 않아도 됩니다.
- 강조할 것은 "이 캐릭터만의 작동 원리·조건·모순이 드러나는 짧은 구절"입니다. 예: 통증보다 **반응이 끊기는 침묵**을 훨씬 크게 위협으로 받아들여요.
- 문장 전체나 여러 문장을 통째로 감싸지 마세요. 한 번에 감싸는 길이는 대략 6~25자의 구절 수준입니다.
- 단순 사실, 뻔한 성격 라벨, 이미 안내문에서 말한 내용을 다시 감싸지 마세요.
- 한 문단에서 세 곳 이상을 강조하면 강조가 사라집니다. 아껴 쓰세요.

작성 원칙:
- 모든 문장은 끝까지 완결하세요.
- 문장 길이를 의도적으로 들쭉날쭉하게 쓰세요. 길게 풀어주는 문장 사이에 짧고 단정한 한 문장을 하나씩 끼워 호흡을 만드세요. 모든 문장이 비슷한 길이·구조·리듬으로 이어지면 실패입니다. "~하는 순간", "~되는 지점", "경계", "감정이 흔들리는" 같은 표현이나 쉼표를 습관적으로 반복하지 마세요.
- 핵심 지점마다 짧고 구체적인 장면·상황 예시를 하나씩 넣어 추상적 분석만 이어지지 않게 하세요(예: "읽씹을 당해도 먼저 화내기보다 자기가 뭘 잘못했나부터 되짚어요"). 단, 자료에 없는 사건·설정을 지어내지 말고 있는 단서로 그려낼 수 있는 장면만 쓰세요.
- 각 카테고리 안에서는 관련 내용이 앞 문단에서 다음 문단으로 자연스럽게 이어지게 쓰고, 문장 수를 맞추기 위한 기계적인 줄바꿈은 하지 마세요.
- evidenceAnchors를 목록처럼 다시 읽어주지 말고, 결론과 메커니즘을 먼저 설명한 뒤 구체적 행동은 짧은 예시로만 사용하세요.
- 지면의 대부분은 "무엇을 하는가"(행동 묘사)가 아니라 "왜 그러는가, 무엇을 지키려는가, 어떤 조건에서 뒤집히는가"(메커니즘)에 쓰세요. 관찰된 행동은 한 문단에 짧은 예시 한둘로만 인용하고, 행동을 여러 개 나열해 분량을 채우면 실패입니다. 오너가 프로필에 이미 쓴 문장을 풀어 말한 것처럼 읽히면 실패입니다.
- 각 핵심 지점은 한 겹 해석에서 멈추지 마세요. 겉으로 보이는 모습 → 그 아래의 기능 → 그것이 지키려는 근원 욕구·두려움 → 그렇게 형성된 자기상·맹점 → 그 구조가 다른 관계·상황에서 어떻게 다시 나타나고 언제 무너지는지까지, 자연스러운 산문으로 두세 겹 이어 풀어주세요.
- 오너가 이미 아는 설정을 재확인하기보다, 여러 단서를 연결해야만 보이는 새로운 이해(오너도 미처 언어화하지 못했을 법한 지점)를 각 카테고리마다 앞세우세요.
- 같은 행동이나 같은 insight를 여러 카테고리에서 반복하지 마세요.
- 과거 원인은 실제 자료에 명시된 사건이나 환경이 있을 때만 연결하세요. 근거가 없으면 원인을 만들어내지 말고 현재 구조까지만 설명하세요.
- 근거가 약한 소주제도 조용히 생략하지 마세요. 단정할 수 없다면 불확실성을 표시한 뒤 현재 자료에서 읽을 수 있는 범위까지 설명하세요.
- 간결함이 곧 완성도입니다. 같은 말의 반복, 군더더기 수식어, 뻔한 일반론, 앞에서 한 설명의 되풀이를 걷어내고 문장을 압축하세요. 한 소주제는 한 번만, 가장 날카로운 형태로 말하세요. 덜어낼 것은 중복과 군더더기이지, 배정된 소주제나 해석의 깊이(두세 겹)가 아닙니다. 분량을 늘리려 말을 늘리지 마세요.
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
  // The six report axes are coverage targets, not a requirement for six separate strong hypotheses.
  // One high-quality insight can legitimately connect multiple axes. Failing the whole report at 5/6
  // discarded an otherwise strong analysis and created a false-negative production error.
  if(passed.length<4)return `품질 기준 통과 insight 부족 (${passed.length}개)`;
  return '';
}

async function buildPsychologicalModel(seed:DetailSeed,packet:SourcePacket|UnknownRecord):Promise<PsychologicalModel>{
  const model=await askClaudeJson({
    system:PSYCHE_SYSTEM,
    schema:psychologicalModelSchema,
    maxAttempts:2,
    input:`캐릭터 이름: ${seed.name}\n\n[원자료 — 이 호출에서만 사용]\n${JSON.stringify(packet)}\n\n작업 규칙:\n- 원 질문을 그대로 다시 쓰지 말고, 서로 떨어진 행동·상황·관계 조건을 연결해 해석하세요.\n- validatedInsights는 quality rubric 통과 항목만 남기세요. evidenceStrength/specificity/latentDepth/inferenceDistance는 각각 2 이상, 전체 합은 12 이상이어야 합니다.\n- evidenceAnchors는 질문 문장을 보존하지 말고 행동·상황·관계 조건만 짧게 남기세요.\n- prediction은 이 해석이 맞다면 다른 상황에서 어떤 반응을 보일지 적어 행동 예측력을 확인하세요.\n- tensions는 실제로 상반된 행동이 같은 욕구에서 갈라질 때만 작성하고 억지로 개수를 채우지 마세요.\n- 여섯 분석 축을 모두 다루되, 하나의 충분히 깊은 insight가 여러 축을 연결해도 됩니다. 축별 개수를 맞추기 위해 약한 가설을 억지로 만들지 마세요.\n- 오너의 명시적 정정은 가장 높은 우선순위로 반영하세요.`,
    allowFallback:true,
    model:'anthropic/claude-sonnet-5',
  });
  const artifact=uiArtifactReason(allPsychText(model));
  if(artifact)throw new Error(`DETAIL_PSYCHOLOGY_FAILED: ${artifact}`);
  // 품질 통과 insight가 넉넉하면 통과분만 쓰고, 조금 모자라도 스키마를 통과한 해석이 있으면
  // 재시도(큰 프롬프트 재전송)하지 말고 있는 것으로 진행한다.
  const passed=model.validatedInsights.filter(qualityPass);
  const usable=passed.length>=4?passed:model.validatedInsights;
  if(usable.length===0)throw new Error('DETAIL_PSYCHOLOGY_FAILED: 사용할 수 있는 해석이 없음');
  return {...model,validatedInsights:usable};
}

function buildReportDossier(model:PsychologicalModel):ReportDossier{
  // buildPsychologicalModel에서 이미 사용할 insight를 골라두므로 여기서 다시 걸러 버리지 않는다.
  const validatedInsights=model.validatedInsights;
  const tensions=model.tensions.filter(qualityPass);
  return reportDossierSchema.parse({
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
  });
}

function commonWriterInput(seed:DetailSeed,dossier:ReportDossier){
  return `캐릭터 이름: ${seed.name}\n\n[검증된 심층 해석 묶음]\n${JSON.stringify(dossier)}\n\n공통 규칙:\n- 배정된 소주제는 하나도 빠뜨리지 말되, 각 소주제는 핵심만 간결하게 다루세요. 분량을 채우려 말을 늘리지 말고, 중복·군더더기·뻔한 일반론을 걷어내 압축하세요. 길게 쓰는 것보다 날카롭게 쓰는 게 낫습니다.\n- 문장 길이를 들쭉날쭉하게 해 호흡을 만드세요. 긴 문장 사이에 짧고 단정한 문장을 섞고, 모든 문장이 비슷한 리듬으로 이어지지 않게 하세요.\n- 핵심 지점마다 있는 단서로 그릴 수 있는 짧고 구체적인 장면을 하나씩 넣어 추상적인 설명만 이어지지 않게 하세요.\n- 원 질문/원 답변을 떠올려 재구성하지 마세요.\n- 모든 문장은 자연스러운 해요체 존댓말로 완결하세요.\n- 자연스럽게 나뉜 모든 문단의 첫 문장은 반드시 **굵은 안내문**으로 시작하세요. 안내문은 결론이 아니라 그 문단에서 다룰 주제만 알려주는 짧은 문장이어야 합니다.\n- 안내문은 상담사가 화제를 안내하는 A형 또는 독자가 궁금해할 질문을 던지는 C형 중 하나만 사용하고, 둘을 한 문장에 합치거나 기계적으로 번갈아 쓰지 마세요.\n- 안내문 뒤 본문에서는 가장 중요한 해석 1~2곳을 별표 두 개로 감싸 하이라이트하세요(6~25자 구절, 문장 통째로 감싸지 말 것, 강조할 지점이 없으면 생략).\n- 같은 insight를 여러 문단에서 반복하지 말고 맥락이 자연스럽게 이어지게 쓰세요.\n- 근거가 부족한 소주제는 삭제하지 말고 불확실성을 표시한 뒤 현재 읽을 수 있는 범위까지 설명하세요.\n- 새로운 과거 사건이나 숨겨진 설정을 창작하지 마세요.\n- 질문 번호, 점수, 퍼센트, 슬라이더, 선택지 번호, 분석 과정이나 입력 출처를 드러내는 표현은 사용하지 마세요.`;
}

async function writeStage1(seed:DetailSeed,dossier:ReportDossier){
  return askClaudeJson({
    system:REPORT_SYSTEM,
    schema:stage1Schema,
    maxAttempts:2,
    allowFallback:true,
    input:`${commonWriterInput(seed,dossier)}\n\n이번에는 첫 페이지의 아래 2개 필드만 작성하세요.\n\ncharacterOverview — 화면 제목: "${seed.name}는 이런 캐릭터예요"\n반드시 포함:\n- 이 캐릭터가 본질적으로 어떤 사람인지\n- 겉으로 보이는 성격과 실제 내면의 간극\n- 무엇을 얻고 지키기 위해 움직이는지의 큰 방향\n- 자기 자신을 어떻게 인식하는지\n- 타인이 보는 모습과 자기 인식의 차이\n- 표면 설정·자기서술과 실제 반복 행동에서 읽히는 모습의 차이\n- 실제로 명시된 과거 경험·사건·환경이 현재 성격, 가치관, 대인관계, 습관에 남긴 영향\n- 과거 근거가 없을 때는 원인을 창작하지 말고 현재 성격이 유지되는 구조\n- 프로필에 직접 쓰이지 않았지만 여러 단서를 연결하면 자연스럽게 보이는 숨은 특성\n\ninnerMechanics — 화면 제목: "${seed.name}는 이렇게 작동해요"\n반드시 포함:\n- 가장 강한 욕구와 결핍, 무엇을 얻기 위해 행동하는 사람인지\n- 가장 두려워하는 것\n- 본인이 원한다고 느끼는 것과 실제로 필요한 것의 차이\n- 핵심 가치와 절대 놓치고 싶지 않은 내적 상태\n- 분노할 때 실제로 상처받는 지점\n- 슬픔·질투·죄책감·수치심·불안을 처리하고 표현하는 방식\n- 억누르거나 폭발하거나 회피하는 감정 처리 방식\n- 본인조차 인정하기 어려운 감정\n- 공격·회피·농담·합리화·무감각·거리두기·통제·혼자 해결하기 등 방어기제\n- 자기기만: 스스로 믿는 자기상과 행동의 불일치, 인정하기 싫은 욕망, 자기 행동을 정당화하는 논리

추가 구조화 블록 — 위 산문과 별개로 아래 JSON 필드도 함께 출력하세요. 산문과 모순되지 않게, dossier 근거 안에서만 뽑고, 없는 내용을 지어내지 마세요.
- desireGap: {"wants":[본인이 원한다고 느끼는 것 2~4개],"needs":[겉으로 드러난 것 아래에서 실제로 필요한 것 2~4개]}
  · 각 항목은 8~26자의 짧은 명사구(문장 아님). wants와 needs는 같은 캐릭터의 표면 욕구와 근원 욕구가 대비되도록 쓰세요.
  · 근거가 부족하면 억지로 채우지 말고 각 1~2개만 넣으세요.

섹션 스캔용 키워드 태그도 함께 출력하세요(각 2~3개, 항목당 2~10자의 짧은 한국어 키워드, 문장/설명/해시태그 기호 금지, 그 섹션 핵심만).
- characterOverviewTags: characterOverview 섹션의 핵심 키워드
- innerMechanicsTags: innerMechanics 섹션의 핵심 키워드

각 섹션의 핵심 한 줄 요약(TL;DR)도 출력하세요(30~70자, 한 문장). 안내문 같은 길잡이가 아니라 그 섹션에서 가장 중요한 "결론"을 먼저 말하는 문장이어야 합니다(예: "겉은 쿨해 보이지만 본질은 방어기제예요"). 자연스러운 해요체.
- characterOverviewTldr / innerMechanicsTldr

성향 스펙트럼(선택) — {section}Spectrums 형식: [{"left":왼쪽 극,"right":오른쪽 극,"value":0~100}]. 각 축은 서로 반대되는 짧은 성향 라벨(각 4~14자)이고, value는 이 캐릭터가 어느 쪽에 얼마나 치우쳤는지(0=완전히 left, 100=완전히 right)입니다. 축은 2~3개.
- 이 섹션이 "두 극단 사이의 뚜렷한 성향"으로 설명될 때만 넣고, 잘 맞지 않으면 생략하세요. 억지로 만들지 말고, 근거가 분명하고 한쪽으로 치우친 축만 담으세요. 성향이 애매하거나 중간이면 넣지 마세요.
- 필드명: characterOverviewSpectrums / innerMechanicsSpectrums`,
  });
}

async function writeStage2(seed:DetailSeed,dossier:ReportDossier,skipLeadRewrite=false){
  return askClaudeJson({
    system:REPORT_SYSTEM,
    schema:stage2Schema,
    maxAttempts:2,
    allowFallback:true,
    skipLeadRewrite,
    input:`${commonWriterInput(seed,dossier)}\n\n이번에는 두 번째 페이지의 아래 3개 필드만 작성하세요.\n\nrelationshipStyle — 화면 제목: "${seed.name}는 이렇게 관계를 맺어요"\n반드시 포함:\n- 처음 만난 사람에게 보이는 태도\n- 친해지는 데 필요한 조건\n- 가까운 사람을 대하는 방식\n- 싫어하는 사람, 존경하는 사람을 대하는 방식\n- 약한 사람과 강한 사람을 대하는 방식의 차이\n- 관계에서 주도권을 잡는지 넘기는지\n- 사람을 믿는 기준과 관계를 끊는 기준\n- 어떤 사람을 좋아하고 싫어하는지, 어떤 사람에게 특히 약한지의 심층 기준\n- 일반적인 애정 표현이 관계에서 어떻게 나타나는지\n- 캐릭터 사용 설명서의 내용을 산문 안에 자연스럽게 포함: 친해지는 방법 / 특히 하면 안 되는 것 / 좋아하고 신뢰한다는 신호\n\nattachmentStyle — 화면 제목: "${seed.name}는 이런 애착이 있어요"\n반드시 포함:\n- 누군가를 좋아하게 되는 과정과 속도\n- 친밀해질수록 편안해지는지 불안해지는지\n- 사랑받고 있다는 것을 어떻게 확인하려 하는지\n- 상대에게 원하는 것과 의존을 허용하는 정도\n- 버림받음·배신·구속 중 무엇에 특히 민감한지와 이유\n- 플러팅과 고백 방식\n- 연애 초반과 장기 관계의 차이\n- 질투와 싸웠을 때의 행동\n- 애정표현과 갈등 후 관계 회복 방식\n- 이별 후의 반응\n- 잘 맞는 상대와 최악의 상대가 어떤 사람인지, 왜 그런지\n\nconflictStyleDetailed — 화면 제목: "${seed.name}는 이렇게 갈등해요"\n반드시 포함:\n- 갈등을 감지하는 기준과 초기 대응\n- 불편함이 자기 기준의 침범으로 바뀌는 임계점\n- 평상시 → 압박받을 때 → 한계에 몰렸을 때 성격과 행동이 어떻게 달라지는지\n- 한계에서 공격·회피·통제·거리두기·혼자 해결하기 등이 어떻게 나타나는지\n- 절대 양보하지 않는 가치와 상황에 따라 포기할 수 있는 것\n- 거짓말을 어디까지 허용하는지\n- 목적을 위해 수단을 정당화하는지\n- 자기 자신과 타인에게 적용하는 기준의 차이\n- 타인의 잘못을 어디까지 용서하는지\n- 극한상황에서 자신 vs 타인, 사랑하는 사람 vs 다수, 신념 vs 생존, 진실 vs 평온, 복수 vs 용서, 책임 vs 도망 중 어디로 기울지와 그 이유

추가 구조화 블록 — 위 세 산문과 별개로 아래 JSON 필드도 함께 출력하세요. 각 산문에서 이미 다룬 내용을 짧은 개조식으로 뽑되, 산문과 모순되지 않게, dossier 근거 안에서만 쓰고 없는 내용을 지어내지 마세요.
- relationshipManual: {"gettingClose":[친해지는 법 2~4개],"avoid":[특히 하면 안 되는 것 2~4개],"affectionSignals":[좋아하거나 신뢰한다는 신호 2~4개]}
  · relationshipStyle 산문 안의 사용설명서 내용을 그대로 개조식으로 정리하세요. 각 항목 10~34자.
- matchProfile: {"best":[잘 맞는 상대의 특징 2~4개],"worst":[최악의 상대의 특징 2~4개]}
  · attachmentStyle에서 다룬 궁합을 근거로 하세요. 상대의 "성격 라벨"이 아니라 이 캐릭터와의 관계에서 왜 맞고 안 맞는지가 드러나는 특징으로 쓰세요. 각 항목 10~34자.
- pressureStages: {"normal":한 문장,"pressured":한 문장,"limit":한 문장}
  · conflictStyleDetailed에서 다룬 "평상시 → 압박받을 때 → 한계에 몰렸을 때"의 성격·행동 변화를 각 한 문장(40~90자)으로 요약하세요.

섹션 스캔용 키워드 태그도 함께 출력하세요(각 2~3개, 항목당 2~10자의 짧은 한국어 키워드, 문장/설명/해시태그 기호 금지, 그 섹션 핵심만).
- relationshipStyleTags / attachmentStyleTags / conflictStyleDetailedTags: 각 해당 섹션의 핵심 키워드

각 섹션의 핵심 한 줄 요약(TL;DR)도 출력하세요(30~70자, 한 문장, 길잡이가 아니라 그 섹션의 결론을 먼저 말하는 문장, 자연스러운 해요체).
- relationshipStyleTldr / attachmentStyleTldr / conflictStyleDetailedTldr

성향 스펙트럼(선택) — {section}Spectrums 형식: [{"left":왼쪽 극,"right":오른쪽 극,"value":0~100}], 축 2~3개. left/right는 서로 반대되는 짧은 성향 라벨(각 4~14자), value는 캐릭터가 어느 쪽에 치우쳤는지(0=left, 100=right). 이 섹션이 두 극단 사이 성향으로 뚜렷이 설명될 때만 넣고, 애매하거나 안 맞으면 생략하세요(억지 금지).
- 필드명: relationshipStyleSpectrums / attachmentStyleSpectrums / conflictStyleDetailedSpectrums`,
  });
}

async function writeStage3(seed:DetailSeed,dossier:ReportDossier,skipLeadRewrite=false){
  return askClaudeJson({
    system:REPORT_SYSTEM,
    schema:stage3Schema,
    maxAttempts:2,
    allowFallback:true,
    skipLeadRewrite,
    input:`${commonWriterInput(seed,dossier)}\n\n이번에는 마지막 페이지의 아래 2개 필드만 작성하세요.\n\ncharmAndContradictions — 화면 제목: "${seed.name}에겐 이런 매력이 있어요"\n반드시 포함:\n- 캐릭터 안의 모순과 양면성, 상반된 행동이 같은 욕구에서 갈라지는 이유\n- 쉽게 오해받는 부분과 실제 내부 기능의 차이\n- 같은 특성이 어떤 상황에서는 강점이 되고 다른 상황에서는 약점이 되는 방식\n- 첫인상에서 눈에 띄는 매력\n- 알고 지낼수록 발견되는 매력\n- 위험하지만 매력적인 부분\n- 호불호가 갈릴 부분과 그 이유\n- 여러 단서를 연결했을 때 새롭게 읽히는 속내·맹점·관계의 숨은 기대\n- 오너가 직접 적지 않았을 가능성이 높은 새로운 연결을 최소 여러 개 포함\n\nintegratedReport — 화면 제목: "통합 리포트"\n- 앞의 여섯 카테고리를 순서대로 다시 요약하지 마세요.\n- coreEngine을 중심으로 욕구·두려움·감정·자기보호·관계·애착·갈등·자기기만·양면성이 한 사람 안에서 어떻게 이어지는지를 하나의 긴 흐름으로 통합하세요.\n- 오너가 이미 아는 사실보다 여러 독립 단서를 연결해서 새롭게 보이는 부분을 중심으로 쓰세요.\n- 자연스럽게 논점이 바뀌는 곳에서만 문단을 나누세요.\n\n섹션 스캔용 키워드 태그도 함께 출력하세요(각 2~3개, 항목당 2~10자의 짧은 한국어 키워드, 문장/설명/해시태그 기호 금지, 그 섹션 핵심만).\n- charmAndContradictionsTags / integratedReportTags: 각 해당 섹션의 핵심 키워드\n\n각 섹션의 핵심 한 줄 요약(TL;DR)도 출력하세요(30~70자, 한 문장, 길잡이가 아니라 그 섹션의 결론을 먼저 말하는 문장, 자연스러운 해요체).\n- charmAndContradictionsTldr / integratedReportTldr\n\n성향 스펙트럼(선택) — {section}Spectrums 형식: [{"left":왼쪽 극,"right":오른쪽 극,"value":0~100}], 축 2~3개. left/right는 서로 반대되는 짧은 성향 라벨(각 4~14자), value는 캐릭터가 어느 쪽에 치우쳤는지(0=left, 100=right). 두 극단 사이 성향으로 뚜렷이 설명될 때만 넣고, 애매하거나 안 맞으면 생략하세요(억지 금지). 특히 integratedReport(통합)는 대개 스펙트럼이 어울리지 않으니 신중히.\n- 필드명: charmAndContradictionsSpectrums / integratedReportSpectrums`,
  });
}

function validateVisibleText(text:string,sources?:string[]){
  const artifact=uiArtifactReason(text);
  if(artifact)throw new Error(`AI_JSON_SCHEMA_FAILED: ${artifact}`);
  if(sources&&hasLongVerbatimOverlap(text,sources))throw new Error('AI_JSON_SCHEMA_FAILED: 원자료의 긴 문장이 그대로 복사됨');
}

// 심리모델→dossier까지만 만든다(글쓰기 없음). 결제 전 미리 계산(precompute)에 쓰인다.
export async function buildDetailDossier(seedInput:unknown,publicProfileText='',privateSourceInput?:unknown):Promise<ReportDossier>{
  const seed=detailSeedSchema.parse(seedInput);
  const {packet}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  const psyche=await buildPsychologicalModel(seed,packet);
  return buildReportDossier(psyche);
}

export async function generatePaidDetailStage1(seedInput:unknown,publicProfileText='',privateSourceInput?:unknown,precomputedDossier?:unknown):Promise<{analysis:FinalAnalysis;dossier:ReportDossier}>{
  const seed=detailSeedSchema.parse(seedInput);
  const {packet,sources}=buildSourcePacket(seed,publicProfileText,privateSourceInput);
  // 미리 계산해둔 dossier가 있으면 심리모델(가장 무거운 호출)을 건너뛴다. 없거나 형식이 안 맞으면 정상 생성.
  let dossier:ReportDossier|null=null;
  if(precomputedDossier){
    const parsed=reportDossierSchema.safeParse(precomputedDossier);
    if(parsed.success)dossier=parsed.data;
  }
  if(!dossier)dossier=buildReportDossier(await buildPsychologicalModel(seed,packet));
  const stage=await writeStage1(seed,dossier);
  validateVisibleText(`${stage.characterOverview} ${stage.innerMechanics}`,sources);
  const analysis=finalAnalysisSchema.parse({oneLineSummary:seed.oneLineSummary,summary:seed.summary,...stage});
  return {analysis,dossier};
}

// Stage 2와 stage 3은 둘 다 dossier에만 의존하고 서로 의존하지 않으므로 병렬로 생성한다.
// 프롬프트·엔진·품질은 그대로 두고, "나머지 두 페이지" 대기 시간을 두 호출의 합에서 최댓값으로 줄인다.
// 각 stage를 따로 저장하면 서로를 덮어쓰는 레이스가 생기므로, 호출부에서 결과를 한 번에 병합 저장한다.
export async function generatePaidDetailRemaining(seedInput:unknown,dossierInput:unknown):Promise<Partial<FinalAnalysis>>{
  const seed=detailSeedSchema.parse(seedInput);
  const dossier=reportDossierSchema.parse(dossierInput);
  // 두 stage 모두 문단 안내문 재작성을 건너뛰고, 합친 뒤 한 번만 재작성한다.
  // 안내문은 문단별로 독립 생성되고 재작성기는 원래 모든 리포트 필드를 한 번에 처리하므로
  // 결과 텍스트는 동일하고, Claude 호출만 2회에서 1회로 줄어든다.
  const [stage2,stage3]=await Promise.all([writeStage2(seed,dossier,true),writeStage3(seed,dossier,true)]);
  validateVisibleText(`${stage2.relationshipStyle} ${stage2.attachmentStyle} ${stage2.conflictStyleDetailed}`);
  validateVisibleText(`${stage3.charmAndContradictions} ${stage3.integratedReport}`);
  return rewriteReportLeads({...stage2,...stage3},REPORT_SYSTEM);
}

export async function generatePaidDetailContinuation(seedInput:unknown,dossierInput:unknown,stage:2|3):Promise<Partial<FinalAnalysis>>{
  const seed=detailSeedSchema.parse(seedInput);
  const dossier=reportDossierSchema.parse(dossierInput);
  if(stage===2){
    const result=await writeStage2(seed,dossier);
    validateVisibleText(`${result.relationshipStyle} ${result.attachmentStyle} ${result.conflictStyleDetailed}`);
    return result;
  }
  const result=await writeStage3(seed,dossier);
  validateVisibleText(`${result.charmAndContradictions} ${result.integratedReport}`);
  return result;
}
