import { readJsonWithinBudget } from '@/lib/request-budget';
import { z } from 'zod';
import {
  characterDraftSchema,
  characterEvidencePackSchema,
  summaryAnalysisGenerationSchema,
  summaryAnalysisRawSchema,
  interviewAnswerSchema,
  characterPassportSchema,
  type SummaryAnalysisGeneration,
  type InterviewAnswer,
} from '@/lib/schemas/character';
import { streamClaudeJson } from '@/lib/ai/anthropic';
import { ndjsonStream } from '@/lib/ai/stream';
import { attachAiUsageSession, logGenRetry, withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { apiError } from '@/lib/http';

// 요약 생성은 1~3분 걸리고 그동안 진행률 스트림이 열려 있어야 한다. 플랫폼 상한을
// 명시해 두지 않으면 기본값이 바뀔 때 스트림이 중간에 끊길 수 있다.
export const maxDuration=300;

const requestSchema=z.object({draft:characterDraftSchema,answers:z.array(interviewAnswerSchema).length(20)});
type R=Record<string,unknown>;

// 요약 생성의 입력. finalize는 요청 draft에서, 관리자 재생성은 저장된 데이터에서 이걸 구성해
// 같은 프롬프트/파이프라인으로 요약을 만든다.
export type SummaryReview={
  confirmed:{text:string;evidence?:string[]}[];
  ambiguous:{text:string;evidence?:string[];ownerFeedback:string}[];
  rejectedCorrections:{ownerCorrection:string}[];
};
export type SummarySource={
  name:string;
  basicProfile:{profileText:string;secretProfileText?:string;appearanceNotes?:string};
  answers:InterviewAnswer[];
  review:SummaryReview;
  analysisDraft:unknown;
};

const summaryQualitySchema=z.object({
  evidenceStrength:z.number().int().min(0).max(3),
  specificity:z.number().int().min(0).max(3),
  latentDepth:z.number().int().min(0).max(3),
  counterEvidenceRobustness:z.number().int().min(0).max(3),
  inferenceDistance:z.number().int().min(0).max(3),
  predictiveValue:z.number().int().min(0).max(3),
  verdict:z.string(),
});
const summaryInsightSchema=z.object({
  conclusion:z.string(),
  mechanism:z.string(),
  evidenceAnchors:z.array(z.string()).min(2).max(4),
  counterEvidence:z.array(z.string()).max(3).default([]),
  confidence:z.string(),
  prediction:z.string(),
  quality:summaryQualitySchema,
});
const summaryDossierSchema=z.object({
  coreEngine:z.string(),
  hiddenNeed:z.string(),
  hiddenFear:z.string(),
  selfProtection:z.string(),
  blindSpot:z.string(),
  intimacyLogic:z.string(),
  conflictLogic:z.string(),
  selfNarrative:z.string(),
  validatedInsights:z.array(summaryInsightSchema).min(4).max(9),
  tensions:z.array(summaryInsightSchema).max(4).default([]),
  uncertainties:z.array(z.string()).max(6).default([]),
});
type SummaryDossier=z.infer<typeof summaryDossierSchema>;

const SUMMARY_PSYCHE_SYSTEM=`당신은 자캐커뮤니티 캐릭터의 요약 리포트를 만들기 전에 심층 해석만 수행하는 분석가입니다.
최종 사용자용 글을 쓰지 마세요. 프로필과 20문항을 항목별로 다시 요약하는 것도 목적이 아닙니다.

상세 리포트와 같은 분석 원리를 짧은 요약 단계에도 적용합니다. 내부적으로 반드시 다음 순서를 거치세요.
1) 관찰 가능한 행동·선택·관계 조건을 의미 단위로 압축
2) 서로 멀리 떨어진 단서를 연결해 반복되는 주제를 찾기
3) 각 주제에 대해 더 단순한 대안 설명과 반례를 검토
4) 원자료를 다시 말하지 말고, 표면 행동 아래의 잠재 기능·숨은 욕구·자기보호·관계의 기대 중 적어도 한 겹을 짚는 해석을 도출 (겉으로 보이는 모습을 재서술하는 데서 멈추지 않기)
5) 근거가 충분한 해석만 validatedInsights에 남기기
6) 통과한 해석을 바탕으로 coreEngine, 욕구·두려움·방어·맹점·친밀감·갈등 논리를 구성

규칙:
- 오너가 직접 정정·보충한 내용이 가장 높은 우선순위입니다.
- validatedInsights는 최소 두 개의 서로 독립적인 단서를 연결해야 합니다.
- 원문 한 문장만 바꿔 말한 conclusion은 실패입니다.
- "다정하다", "독립적이다", "책임감이 강하다" 같은 성격 라벨만으로 끝내지 마세요.
- 무엇을 얻거나 지키려는지, 어떤 조건에서 반응이 달라지는지까지 설명해야 합니다.
- 대안 설명이 더 단순하게 자료를 설명하면 과한 심리 가설을 버리세요.
- 외관 자료는 첫인상·자기표현·반복 모티프의 보조 단서로만 사용하고 외형 하나로 내면을 확정하지 마세요.
- 실제로 주어진 과거 사건은 현재 구조와 연결할 수 있지만 없는 과거·트라우마·진단·비밀 설정은 만들지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더, 선택지 번호 같은 UI 흔적을 남기지 마세요.
- 이 묶음은 최종 사용자 글이 아니라 내부 분석 메모입니다. conclusion·mechanism·prediction은 완결된 산문이 아니라 핵심만 담은 짧은 메모로 쓰세요. 판단에 필요한 최소한으로만 짧게 쓰고, 수식어·중복 설명·같은 말 반복·장식 문장으로 길이를 늘리지 마세요. 해석의 깊이(단서 연결·잠재 기능·조건)는 그대로 유지하되 표현은 간결할수록 좋습니다. 이 단계가 짧아야 전체 생성이 빨라집니다.

validatedInsights 전체는 본질/겉과 속, 욕구·감정·방어, 일반 관계, 애착·친밀감, 갈등·한계, 모순·오해·매력의 여섯 축을 골고루 덮으세요. 하나의 깊은 insight가 여러 축을 연결해도 됩니다.`;

const SUMMARY_SYSTEM=`당신은 자캐커뮤니티 캐릭터를 정밀하게 읽고, 오너에게 옆에서 풀이해주는 전문 해석자입니다.
당신에게는 원 프로필과 원 문답이 아니라, 그것들을 이미 교차 검증하고 반례까지 살핀 "요약용 심층 해석 묶음"만 주어집니다.
따라서 원자료를 다시 읽어주는 식으로 쓰지 말고, 검증된 메커니즘을 짧고 흥미로운 리포트로 풀어주세요.

이 요약은 상세 리포트와 같은 해석 원리를 사용하되 더 짧습니다. 사용자가 "내가 적은 내용을 그대로 되풀이한 게 아니라 한 단계 더 읽었다"고 느껴야 합니다.

분석·작성 규칙:
- 각 사용자 노출 카드에는 가능하면 서로 다른 두 개 이상의 단서가 연결된 해석을 담으세요.
- evidenceAnchors는 근거 목록처럼 나열하지 말고, 필요할 때만 짧은 행동 예시로 한두 개 사용하세요.
- 핵심은 conclusion보다 mechanism입니다. 왜 그런 모습이 생기고 어떤 조건에서 달라지는지를 설명하세요.
- 원자료에 직접 적힌 행동을 여러 개 나열하는 것으로 분량을 채우지 마세요.
- 서로 다른 카드가 같은 행동과 같은 결론을 반복하면 실패입니다.
- 없는 과거, 트라우마, 진단, 비밀 설정을 창작하지 마세요.
- 질문 번호, 점수, 퍼센트, 슬라이더, 분석 과정이나 입력 출처를 노출하지 마세요.

문체와 문단:
- 실제 상담사가 캐릭터 오너에게 차분하게 풀이하듯 자연스러운 해요체 존댓말을 사용하세요.
- 보고서체 "~다/~이다/~한다"는 피하세요.
- AI 티를 줄이세요. "~하는 순간", "~되는 순간", "~하는 지점", "감정이 흔들리는", "경계", "임계점", "미묘한", "묘한", "일종의" 같은 상투 표현을 반복하지 말고(요약 하나에서 '순간·지점'은 한두 번만), 명사화("~하는 것", "~라는 점") 대신 동사로 직접 말하세요.
- 문장 길이와 리듬을 다양하게 하고, 짧은 문장과 긴 문장을 섞으세요. 쉼표로 여러 절을 길게 잇지 말고 문장을 나누세요(한 문장에 쉼표 둘을 넘기면 대개 끊는 게 낫습니다). "A하고 B하며 C하는" 3박자 나열을 반복하지 마세요.
- "~에 대해", "~을 통해", "가지고 있다", "~되어진다", "~에 의해" 같은 번역투를 쓰지 마세요. 완곡·추측 표현("~할 수 있어요")도 문단마다 반복하지 말고, 실제 사람이 쓴 것처럼 자연스럽게 쓰세요.
- 각 summary 카드는 서로 이어지는 2개의 짧은 문단으로 구성하고 문단 사이는 빈 줄 하나(\n\n)로 구분하세요.
- 모든 문단의 첫 문장은 반드시 **굵은 안내문**이어야 합니다.
- 굵은 안내문은 결론 요약이 아니라 그 문단에서 무엇을 살펴볼지 알려주는 짧은 길잡이 문장입니다.
- A형: **겉으로 보이는 인상부터 조금 더 들여다볼게요.**
- C형: **이 캐릭터는 가까워질수록 어떻게 달라질까요?**
- A형과 C형을 한 문장에 섞거나 기계적으로 번갈아 쓰지 마세요.

본문 강조:
- 문단의 첫 별표 묶음은 안내문이고, 그 뒤 본문 안에서 별표 두 개로 감싼 부분은 화면에서 형광펜 하이라이트로 표시됩니다.
- 각 문단 본문에서 가장 중요한 해석 한 곳을 별표 두 개로 감싸세요(문단당 1곳, 많아야 2곳).
- 강조할 것은 이 캐릭터만의 작동 원리나 모순이 드러나는 짧은 구절(대략 6~25자)입니다. 문장 전체를 통째로 감싸지 마세요.
- 뻔한 성격 라벨이나 안내문에서 이미 말한 내용은 강조하지 마세요. 강조가 많아지면 강조 효과가 사라집니다.

결제 전 요약은 충분히 읽을 가치가 있어야 하지만 상세 리포트를 통째로 대신해서도 안 됩니다. 각 summary 카드는 겉으로 보이는 모습을 다시 묘사하는 게 아니라, 그 아래의 '왜'(무엇을 지키려는지, 어떤 조건에서 뒤집히는지)를 한 겹 보여줘야 합니다. 표면 묘사만 있고 그 아래를 안 짚으면 실패이고, 오너가 프로필·답변에 이미 쓴 것을 되풀이한 것처럼 읽혀도 실패입니다. 다만 여러 겹의 사슬과 관계·애착·갈등·극한상황의 전체 인과·반례는 상세 리포트에 남겨두세요.

사용자에게 보이는 summary 6개 필드는 각각 160~260자를 목표로 작성하세요.
- outerSelf: 타인이 체감하는 인상과 그 인상이 단순 성격 라벨보다 복잡한 이유
- innerSelf: 실제 선택을 움직이는 자기상·욕구·내적 기준과 표면 인상의 간극
- conflictStyle: 감정이 흔들리는 자극, 실제 상처 지점, 평소와 반응이 달라지는 임계점
- affectionStyle: 신뢰가 생기는 조건, 거리 조절, 가까워질수록 반복되는 관계 패턴
- misunderstoodPoint: 겉에서는 한 의미로 보이지만 내부 기능은 다르게 작동하는 지점
- hiddenPattern: 멀리 떨어진 단서들을 연결했을 때 보이는 의외의 공통 원리

oneLineSummary는 가장 눈에 띄는 긴장이나 행동 원리를 25~80자의 한 문장으로 압축하세요.
Evidence Pack의 원자료 보존 부분은 서버가 직접 만듭니다. behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties 같은 고차원 패턴만 간결하게 제안하세요.`;

function rec(v:unknown):R{return v&&typeof v==='object'&&!Array.isArray(v)?v as R:{}}
function text(v:unknown):string{if(typeof v==='string')return v.replace(/\s+/g,' ').trim();if(Array.isArray(v))return v.map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();if(v&&typeof v==='object')return Object.values(v as R).map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();return v==null?'':String(v).trim()}
function summaryText(v:unknown):string{
  if(typeof v!=='string')return text(v);
  return v.replace(/\r\n?/g,'\n')
    .split(/\n{2,}/)
    .map(block=>block.replace(/[ \t]+/g,' ').replace(/\n+/g,' ').trim())
    .filter(Boolean)
    .join('\n\n');
}
function clip(v:string,max:number){const s=v.replace(/\s+/g,' ').trim();return s.length<=max?s:s.slice(0,max).trimEnd()}
function clipSentence(v:string,max:number){
  const s=v.replace(/\s+/g,' ').trim();
  if(s.length<=max)return s;
  const cut=s.slice(0,max).trimEnd();
  const ends=[cut.lastIndexOf('요.'),cut.lastIndexOf('다.'),cut.lastIndexOf('.'),cut.lastIndexOf('?'),cut.lastIndexOf('!')];
  const end=Math.max(...ends);
  return end>=25?cut.slice(0,end+1):`${cut}…`;
}
function texts(v:unknown,maxItems:number){const a=Array.isArray(v)?v:typeof v==='string'?v.split(/\n+/):[];return [...new Set(a.map(text).map(x=>clip(x,190)).filter(x=>x.length>=8))].slice(0,maxItems)}
// 요약 카드 키워드 태그를 관대하게 정리한다. 잘못된 형식은 조용히 버려서 요약 생성 자체를 실패시키지 않는다.
function cleanTags(v:unknown):string[]{const a=Array.isArray(v)?v:[];return [...new Set(a.map(x=>typeof x==='string'?x.replace(/^#/,'').replace(/\s+/g,' ').trim():'').filter(x=>x.length>=1&&x.length<=16))].slice(0,4)}
function summaryTagMap(v:unknown):Record<string,string[]>|undefined{
  const src=rec(v);const out:Record<string,string[]>={};
  for(const key of ['outerSelf','innerSelf','conflictStyle','affectionStyle','misunderstoodPoint','hiddenPattern']){
    const tags=cleanTags(src[key]);if(tags.length)out[key]=tags;
  }
  return Object.keys(out).length?out:undefined;
}
// 요약 카드 전용 한 문장을 관대하게 정리한다(말줄임표 제거, 6~90자만, 잘못된 건 조용히 버림).
function cleanCardLine(v:unknown):string{const s=typeof v==='string'?v.replace(/\s+/g,' ').replace(/…+\s*$/u,'').trim():'';return s.length>=6&&s.length<=90?s:''}
function summaryCardLineMap(v:unknown):Record<string,string>|undefined{
  const src=rec(v);const out:Record<string,string>={};
  for(const key of ['outerSelf','innerSelf','conflictStyle','affectionStyle','misunderstoodPoint','hiddenPattern']){
    const line=cleanCardLine(src[key]);if(line)out[key]=line;
  }
  return Object.keys(out).length?out:undefined;
}
function fragments(source:string,maxItems:number){
  const out:string[]=[];
  for(const line of source.replace(/\r\n?/g,'\n').split('\n')){
    const clean=line.replace(/\s+/g,' ').trim();if(!clean)continue;
    const parts=clean.match(/[^.!?。！？]+[.!?。！？]?/gu)||[clean];
    for(const p of parts){const x=clip(p.trim(),190);if(x.length>=8)out.push(x);if(out.length>=maxItems)return [...new Set(out)]}
  }
  return [...new Set(out)].slice(0,maxItems);
}
function deterministicInterviewEvidence(answers:InterviewAnswer[]){return answers.slice().sort((a,b)=>a.order-b.order).map(a=>({order:a.order,finding:clip(`답변: ${a.answer}${a.reason?` / 이유: ${a.reason}`:''}`,190)}))}
function ownerEvidence(review:{confirmed:{text:string}[];ambiguous:{text:string;ownerFeedback:string}[];rejectedCorrections:{ownerCorrection:string}[]}){
  return [
    ...review.confirmed.map(x=>`오너 확인 추론: ${x.text}`),
    ...review.ambiguous.filter(x=>x.ownerFeedback).map(x=>`오너 보충: ${x.ownerFeedback}`),
    ...review.rejectedCorrections.map(x=>`오너 정정: ${x.ownerCorrection}`),
  ].map(x=>clip(x,190)).filter(x=>x.length>=8).slice(0,20);
}
function buildPack(rawPack:unknown,src:SummarySource){
  const p=rec(rawPack);
  const appearanceDetails=fragments(src.basicProfile.appearanceNotes||'',8).map(x=>`외관 관찰: ${x}`);
  const rawDistinctive=Array.isArray(p.distinctiveDetails)?p.distinctiveDetails:typeof p.distinctiveDetails==='string'?[p.distinctiveDetails]:[];
  return {
    version:'evidence-pack/2.0' as const,
    publicProfileEvidence:fragments(src.basicProfile.profileText,32),
    secretProfileEvidence:fragments(src.basicProfile.secretProfileText||'',28),
    ownerReviewEvidence:ownerEvidence(src.review),
    interviewEvidence:deterministicInterviewEvidence(src.answers),
    behaviorRules:texts(p.behaviorRules,14),relationshipPatterns:texts(p.relationshipPatterns,12),emotionalPatterns:texts(p.emotionalPatterns,12),valuesAndMotives:texts(p.valuesAndMotives,12),exceptionsAndConditions:texts(p.exceptionsAndConditions,12),tensionsAndContradictions:texts(p.tensionsAndContradictions,10),distinctiveDetails:texts([...rawDistinctive,...appearanceDetails],16),uncertainties:texts(p.uncertainties,10),
  };
}
function normalize(raw:z.infer<typeof summaryAnalysisRawSchema>,src:SummarySource){
  const s=rec(raw.summary);
  return {
    oneLineSummary:clipSentence(text(raw.oneLineSummary),80),
    summary:{
      outerSelf:summaryText(s.outerSelf),
      innerSelf:summaryText(s.innerSelf),
      conflictStyle:summaryText(s.conflictStyle),
      affectionStyle:summaryText(s.affectionStyle),
      misunderstoodPoint:summaryText(s.misunderstoodPoint),
      hiddenPattern:summaryText(s.hiddenPattern),
    },
    ...(summaryTagMap((raw as Record<string,unknown>).summaryTags)?{summaryTags:summaryTagMap((raw as Record<string,unknown>).summaryTags)}:{}),
    ...(summaryCardLineMap((raw as Record<string,unknown>).summaryCardLines)?{summaryCardLines:summaryCardLineMap((raw as Record<string,unknown>).summaryCardLines)}:{}),
    evidencePack:buildPack(raw.evidencePack,src),
  };
}
function validationReason(e:z.ZodError){return e.issues.slice(0,16).map(x=>`${x.path.join('.')||'(root)'}: ${x.message}`).join('; ')}
const teaserKeys=['outerSelf','innerSelf','conflictStyle','affectionStyle','misunderstoodPoint','hiddenPattern'] as const;
function shortSummaryFields(summary:SummaryAnalysisGeneration['summary']){
  return teaserKeys.flatMap(key=>{
    const value=summary[key];
    return !value||value.trim().length<130?[`${key} ${value?.trim().length||0}자`]:[];
  });
}
function summaryFormatIssues(summary:SummaryAnalysisGeneration['summary']){
  return teaserKeys.flatMap(key=>{
    const value=summary[key];
    if(!value)return [`${key}: 누락`];
    const paragraphs=value.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
    if(paragraphs.length!==2)return [`${key}: 문단 ${paragraphs.length}개`];
    const bad=paragraphs.findIndex(p=>!/^\*\*[^*]+\*\*\s*\S/u.test(p));
    return bad>=0?[`${key}: ${bad+1}문단 굵은 안내문 누락`]:[];
  });
}
// 내용은 멀쩡한데 문단 형식만 어긋난 응답을 프롬프트 재전송 없이 코드로 고친다.
// 재생성은 비용이 두 배가 되므로, 글을 새로 쓰지 않고 형식만 맞출 수 있으면 여기서 맞춘다.
// 문장을 창작하지 않는다: 이미 있는 문장을 나누거나 첫 문장을 안내문으로 감쌀 뿐이다.
function repairSummaryParagraphs(value:string){
  const blocks=value.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean)
    // 한 문단 안에서 별표 짝이 안 맞으면(열린 채 끝나는 등) 그 문단의 별표는 걷어낸다.
    // 깨진 별표를 그대로 두면 아래 안내문 판정이 계속 실패한다.
    .map(block=>(block.match(/\*\*/gu)?.length??0)%2===0?block:block.replace(/\*\*/gu,'').trim())
    .filter(Boolean);
  // 문단이 하나로 붙어 나온 경우: 문장 경계에서 최대한 균형 있게 두 덩이로 나눈다.
  if(blocks.length===1){
    const sentences=blocks[0].match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu)?.map(x=>x.trim()).filter(Boolean)||[];
    if(sentences.length>=4){
      // 굵은 안내문이 이미 있으면 그 문장은 첫 문단에 남긴다.
      const half=Math.round(sentences.length/2);
      blocks.splice(0,1,sentences.slice(0,half).join(' '),sentences.slice(half).join(' '));
    }
  }
  // 문단이 셋 이상이면 뒤쪽을 두 번째 문단으로 합친다.
  if(blocks.length>2)blocks.splice(1,blocks.length-1,blocks.slice(1).join(' '));
  if(blocks.length!==2)return '';
  const repaired=blocks.map(block=>{
    if(/^\*\*[^*]+\*\*\s*\S/u.test(block))return block;
    // 별표가 깨진 형태(한쪽만 있거나 전부 감쌈)는 걷어내고 다시 붙인다.
    const plain=block.replace(/\*\*/gu,'').trim();
    const match=plain.match(/^([^.!?。！？]+[.!?。！？]+)\s*(\S[\s\S]*)$/u);
    if(!match)return '';
    return `**${match[1].trim()}** ${match[2].trim()}`;
  });
  return repaired.every(Boolean)?repaired.join('\n\n'):'';
}
function repairSummaryFormat(summary:SummaryAnalysisGeneration['summary']){
  const out={...summary};
  let changed=false;
  for(const key of teaserKeys){
    const value=out[key];
    if(!value)continue;
    const paragraphs=value.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
    const needsFix=paragraphs.length!==2||paragraphs.some(p=>!/^\*\*[^*]+\*\*\s*\S/u.test(p));
    if(!needsFix)continue;
    const fixed=repairSummaryParagraphs(value);
    if(fixed){out[key]=fixed;changed=true}
  }
  return changed?out:null;
}
function summaryQualityPass(insight:z.infer<typeof summaryInsightSchema>){
  const q=insight.quality;
  const total=q.evidenceStrength+q.specificity+q.latentDepth+q.counterEvidenceRobustness+q.inferenceDistance+q.predictiveValue;
  return q.evidenceStrength>=2&&q.specificity>=2&&q.latentDepth>=2&&q.inferenceDistance>=2&&total>=12;
}

async function buildSummaryDossier(input:string,onProgress?:(ratio:number)=>void):Promise<SummaryDossier>{
  let last='';
  let lastModel:SummaryDossier|null=null;
  for(let attempt=0;attempt<2;attempt++){
    const retry=attempt===0?'':`\n\n이전 분석에서 엄격한 품질 기준을 통과한 insight가 부족했습니다. 프로필·오너 검수·문답에서 서로 독립적인 단서를 다시 연결하고, 단순 재서술이 아닌 메커니즘 수준의 해석을 만들어주세요. 점검: ${last}`;
    const model=await streamClaudeJson({
      system:SUMMARY_PSYCHE_SYSTEM,
      schema:summaryDossierSchema,
      maxTokens:6000,
      maxAttempts:2,
      model:'anthropic/claude-sonnet-5',
      allowFallback:true,
      input:`${input}${retry}`,
      onProgress,
    });
    lastModel=model;
    const passed=model.validatedInsights.filter(summaryQualityPass);
    if(passed.length>=3){
      return {...model,validatedInsights:passed,tensions:model.tensions.filter(summaryQualityPass)};
    }
    last=`품질 기준 통과 insight ${passed.length}개`;
    // 품질 게이트에 걸려 프롬프트를 통째로 다시 보내는 순간을 기록한다(비용이 두 배가 되는 지점).
    if(attempt===0)logGenRetry('RETRY_INSIGHT_QUALITY',`통과 ${passed.length}/필요 3 · 생성 ${model.validatedInsights.length}개`);
  }
  // 두 번 시도해도 통과분이 3개 미만이면 재시도로 또 큰 프롬프트를 보내지 말고 마지막 결과를 그대로 사용한다.
  if(lastModel&&lastModel.validatedInsights.length>=1){
    return {...lastModel,tensions:lastModel.tensions.filter(summaryQualityPass)};
  }
  throw new Error(`SUMMARY_PSYCHOLOGY_FAILED: ${last||'충분한 해석을 만들지 못함'}`);
}

async function generateSummary(input:string,src:SummarySource,onProgress?:(ratio:number)=>void):Promise<SummaryAnalysisGeneration>{
  let last='';
  for(let attempt=0;attempt<2;attempt++){
    const retry=attempt===0?'':`\n\n이전 생성은 JSON 형식 또는 공개 요약 품질 점검에 걸렸습니다. 이번에는 사용자에게 보이는 oneLineSummary와 summary 6개 필드를 최우선으로 새로 작성하세요. 각 summary 필드는 160~260자를 목표로 하고 130자보다 짧아지지 않게 충분한 맥락을 담으세요. 각 필드는 반드시 2문단이며 문단 사이에 \\n\\n을 넣으세요. 각 문단 첫 문장은 반드시 **굵은 안내문**이고, 결론이 아니라 그 문단에서 다룰 주제만 알려줘야 합니다. 원자료를 다시 읽는 것이 아니라 제공된 심층 해석 묶음의 mechanism을 풀어쓰세요. misunderstoodPoint와 hiddenPattern도 빠뜨리지 마세요. evidencePack은 빈 객체 {}로 출력해도 됩니다. 이전 출력을 수리하지 말고 심층 해석 묶음에서 새로 작성하세요. 점검 내용: ${last}`;
    try{
      const raw=await streamClaudeJson({system:SUMMARY_SYSTEM,schema:summaryAnalysisRawSchema,maxTokens:5000,maxAttempts:2,input:`${input}${retry}`,allowFallback:true,onProgress});
      const parsed=summaryAnalysisGenerationSchema.safeParse(normalize(raw,src));
      if(parsed.success){
        // 형식만 어긋났다면 재생성 대신 코드로 고쳐서 그대로 통과시킨다(비용 두 배 방지).
        if(summaryFormatIssues(parsed.data.summary).length){
          const repaired=repairSummaryFormat(parsed.data.summary);
          if(repaired&&!summaryFormatIssues(repaired).length){
            logGenRetry('REPAIR_SUMMARY_FORMAT','문단 형식 자동 보정(재생성 없음)');
            parsed.data.summary=repaired;
          }
        }
        const shortFields=shortSummaryFields(parsed.data.summary);
        const formatIssues=summaryFormatIssues(parsed.data.summary);
        if((shortFields.length||formatIssues.length)&&attempt===0){
          last=[shortFields.length?`공개 요약 필드가 권장 최소 130자보다 짧음: ${shortFields.join(', ')}`:'',formatIssues.length?`문단 형식 오류: ${formatIssues.join(', ')}`:''].filter(Boolean).join(' / ');
          logGenRetry(shortFields.length?'RETRY_SUMMARY_TOO_SHORT':'RETRY_SUMMARY_FORMAT',last);
          continue;
        }
        return parsed.data;
      }
      last=validationReason(parsed.error);
    }catch(error){
      last=error instanceof Error?error.message:String(error);
    }
  }
  throw new Error(`AI_JSON_SCHEMA_FAILED: ${last||'SUMMARY_EVIDENCE_PACK_FAILED'}`);
}
// 요약 생성 전체 파이프라인(심층 dossier → 사용자용 요약). finalize와 관리자 재생성이 공유한다.
export async function generateSummaryReport(src:SummarySource,usage:{sessionId?:string;shareCode?:string},onProgress?:(ratio:number)=>void):Promise<SummaryAnalysisGeneration>{
  // 요약은 심층분석 → 요약작성 두 단계다. 진행률은 앞 단계 55% / 뒷 단계 45%로 이어붙여
  // 화면의 % 가 실제 생성량을 따라가게 한다(단계 이름은 노출하지 않는다).
  const dossierProgress=onProgress?(r:number)=>onProgress(r*.55):undefined;
  const writeProgress=onProgress?(r:number)=>onProgress(.55+r*.45):undefined;
  const dossierInput=`캐릭터 데이터:\n${JSON.stringify(src.analysisDraft)}\n\n오너 검수:\n${JSON.stringify(src.review)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(src.answers)}\n\n작업 규칙:\n- 답변의 문장을 순서대로 요약하지 말고 행동·조건·이유를 의미 단위로 압축하세요.\n- 서로 멀리 떨어진 단서를 최소 두 개 이상 연결해서만 강한 insight를 만드세요.\n- 오너가 정정한 내용은 기존 추론보다 우선하세요.\n- 한 행동이 어떤 욕구를 충족하거나 어떤 위험을 피하는지, 어떤 조건에서 반대로 뒤집히는지까지 보세요.\n- evidenceAnchors는 원 질문 전체를 복사하지 말고 행동·관계·조건만 짧게 남기세요.`;
  const summaryDossier=await withAiUsageContext({sessionId:usage.sessionId,shareCode:usage.shareCode,stage:'summary_psychology'},()=>buildSummaryDossier(dossierInput,dossierProgress));
  const summaryInput=`캐릭터 이름: ${src.name}\n\n[검증된 요약용 심층 해석 묶음]\n${JSON.stringify(summaryDossier)}\n\n출력 규칙:\n- 원 프로필과 원 문답은 다시 볼 수 없다고 생각하고 이 심층 해석 묶음만으로 작성하세요.\n- oneLineSummary: 25~80자의 한 문장. 가장 흥미로운 긴장이나 행동 원리를 잡으세요.\n- summary.outerSelf: 겉으로 보이는 인상과 그 인상을 단순 라벨로 설명할 수 없는 이유.\n- summary.innerSelf: 실제 선택을 움직이는 자기상·욕구·내적 기준.\n- summary.conflictStyle: 감정이 흔들리는 자극과 평소 반응이 달라지는 임계점.\n- summary.affectionStyle: 신뢰가 생기는 조건과 관계에서 반복되는 거리·개입 패턴.\n- summary.misunderstoodPoint: 겉에서 오해하기 쉬운 의미와 실제 내부 기능의 차이.\n- summary.hiddenPattern: 서로 다른 insight를 다시 연결했을 때 보이는 의외의 공통 원리.\n- summary 6개 필드는 각각 160~260자를 목표로 하세요.\n- 각 필드는 정확히 2개의 자연스러운 문단으로 나누고 문단 사이는 빈 줄 하나(\\n\\n)로 구분하세요.\n- 모든 문단은 **문단에서 다룰 주제만 알려주는 짧은 안내문**으로 시작하세요.\n- 본문은 실제 상담사가 오너에게 캐릭터를 풀이하듯 자연스러운 해요체 존댓말로 작성하세요.\n- evidenceAnchors를 근거 목록처럼 나열하지 말고 필요한 경우 짧은 예시로만 사용하세요.\n- 여섯 카드는 같은 행동이나 같은 결론을 반복하지 마세요.\n- 상세 리포트에서 다룰 전체 인과와 반례를 미리 다 풀지는 마세요.\n- evidencePack에는 behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties만 작성하고 각 축은 중요한 발견만 0~3개로 제한하세요.\n- summaryTags: 각 요약 카드의 스캔용 키워드 태그. {"outerSelf":[...],"innerSelf":[...],"conflictStyle":[...],"affectionStyle":[...],"misunderstoodPoint":[...],"hiddenPattern":[...]} 형태로, 카드마다 2~3개, 항목당 2~10자의 짧은 한국어 키워드(문장/설명/해시태그 기호 금지). 해당 카드 본문의 핵심만 담으세요.\n- summaryCardLines: 각 카드에 표시할 "전용 한 문장". {"outerSelf":"...","innerSelf":"...","conflictStyle":"...","affectionStyle":"...","misunderstoodPoint":"...","hiddenPattern":"..."} 형태로 6개 모두 작성하세요.\n  · 긴 summary 본문을 요약·축약하거나 첫 문장을 재사용하지 말고, 그 항목에서 가장 핵심적으로 새롭게 읽힌 결론을 한눈에 이해되게 정리한 문장이어야 합니다.\n  · 한 카드당 완결된 문장 1개. 약 25~55자 목표(자연스러움 우선). 말줄임표(…)로 끝내지 말고 문장을 완결하세요.\n  · 문체는 요약 본문과 같은 해요체(~해요/~보여요/~쪽에 가까워요 등).\n  · 카드 제목을 반복하거나 "이 캐릭터는 ~예요" 같은 메타 설명을 넣지 마세요.\n  · "다정해요/신중해요/관계를 중요하게 생각해요" 같은 일반적 성격 라벨로 끝내면 안 되고, 이 캐릭터만의 구체적 작동 원리나 모순이 드러나야 합니다.\n  · 본문 첫 안내문(**~부터 볼게요.**)을 그대로 쓰지 마세요.\n  · 6개 문장은 서로 같은 말을 반복하지 말고 각자 역할이 분명해야 합니다.\n  · 필드 역할: outerSelf=타인이 처음 보는 모습의 핵심과 그 인상이 단순하지 않은 이유 / innerSelf=실제 선택·행동을 움직이는 내적 기준 / conflictStyle=평소와 달라지는 핵심 자극·감정 임계점 / affectionStyle=가까워질수록 반복되는 친밀감·신뢰 패턴 / misunderstoodPoint=겉 의미와 실제 작동 이유의 차이 / hiddenPattern=여러 떨어진 단서를 연결해야 보이는 의외의 공통 원리.\n최종 JSON 키는 oneLineSummary, summary, summaryTags, summaryCardLines, evidencePack만 사용하세요.`;
  return withAiUsageContext({sessionId:usage.sessionId,shareCode:usage.shareCode,stage:'summary_teaser'},()=>generateSummary(summaryInput,src,writeProgress));
}

async function uniqueShareCode(){const sb=getSupabaseServer();for(let i=0;i<8;i++){const code=generateShareCode();const {data,error}=await sb.rpc('character2_share_code_exists',{p_share_code:code});if(error)throw error;if(data!==true)return code}throw new Error('SHARE_CODE_EXHAUSTED')}

export async function POST(request:Request){
  // 요청 본문 파싱 실패는 스트림을 열기 전에 평소대로 JSON 오류로 답한다.
  let body:z.infer<typeof requestSchema>;
  try{
    body=requestSchema.parse(await readJsonWithinBudget(request));
  }catch(error){return apiError(error)}

  // 요약 생성은 1~3분 걸린다. 예전에는 응답이 끝날 때까지 화면이 시간 기반으로 지어낸
  // %를 보여줬는데, 실제 생성량과 무관해서 96%에서 한참 멈춘 것처럼 보였다.
  // 이제 실제 생성 진행률을 그대로 흘려보낸다(단계 이름은 노출하지 않는다).
  return ndjsonStream(async(emit)=>{
    await assertRateLimit('character_finalize',8,60);
    // 성격 태그는 AI 추론 단계에서 정해진 aiInitial과 오너가 고른 ownerSelected로 고정한다.
    // 인터뷰 후·요약 후 태그를 다시 뽑던 AI 호출 2회는 제거했다(생성 시간·비용 절감).
    // 스키마 호환을 위해 필드는 남기되, 확정된 태그를 그대로 채워 화면 폴백이 끊기지 않게 한다.
    const fixedTags=body.draft.personalityTags.ownerSelected.length?body.draft.personalityTags.ownerSelected:body.draft.personalityTags.aiInitial;
    body.draft.personalityTags={...body.draft.personalityTags,interviewAdaptive:fixedTags,finalAdaptive:fixedTags};
    const inferenceReview={
      confirmed:body.draft.aiInferences.filter(x=>x.ownerVerdict==='confirmed').map(x=>({text:x.text,evidence:x.evidence})),
      ambiguous:body.draft.aiInferences.filter(x=>x.ownerVerdict==='ambiguous').map(x=>({text:x.text,evidence:x.evidence,ownerFeedback:x.ownerFeedback?.trim()||''})),
      rejectedCorrections:body.draft.aiInferences.filter(x=>x.ownerVerdict==='rejected'&&x.ownerFeedback?.trim()).map(x=>({ownerCorrection:x.ownerFeedback!.trim()})),
    };
    const analysisDraft={basicProfile:body.draft.basicProfile,traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,confirmedFacts:body.draft.confirmedFacts,personalityTags:body.draft.personalityTags,analysisConfidence:body.draft.analysisConfidence};
    const summaryStartedAt=Date.now();
    const summaryResult=await generateSummaryReport({
      name:body.draft.basicProfile.name,
      basicProfile:body.draft.basicProfile,
      answers:body.answers,
      review:inferenceReview,
      analysisDraft,
    },{sessionId:body.draft.usageSessionId},r=>emit(r*.97));
    characterEvidencePackSchema.parse(summaryResult.evidencePack);
    const summaryGenMs=Date.now()-summaryStartedAt;


    const sb=getSupabaseServer(),shareCode=await uniqueShareCode(),editToken=createEditToken(),characterId=crypto.randomUUID();
    const {name,age,gender,profileText}=body.draft.basicProfile;
    const sharedInferences=body.draft.aiInferences.map(x=>({id:x.id,text:x.text,confidence:x.confidence,evidenceIds:[],evidence:[],ownerVerdict:x.ownerVerdict}));
    const passport=characterPassportSchema.parse({schemaVersion:'character-passport/1.0',characterId,shareCode,basicProfile:{name,age,gender,profileText},traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,confirmedFacts:body.draft.confirmedFacts,aiInferences:sharedInferences,personalityTags:body.draft.personalityTags,interview:{version:'interview/1.0',completedCount:20,answers:body.answers},analysis:{oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,...(summaryResult.summaryTags?{summaryTags:summaryResult.summaryTags}:{}),...(summaryResult.summaryCardLines?{summaryCardLines:summaryResult.summaryCardLines}:{}),outerSelf:'',innerSelf:'',coreValues:[],desires:[],fears:[],conflictStyle:'',affectionStyle:'',misunderstoodPoints:[],contradictions:[],interestingPoints:[]},engineVersions:{parser:'parser/1.4-image',interview:'interview/1.5-personality',analysis:'claude-summary-dossier/4.1-personality-final'}});
    const detailSeed={version:'detail-seed/2.0',name,oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,personalityTags:body.draft.personalityTags,evidencePack:summaryResult.evidencePack};
    const appearanceForDetail=body.draft.basicProfile.appearanceNotes?.trim()?`[외관 자료 관찰 메모 — 시각 보조 근거이며 성격·감정·과거를 단독으로 확정하지 말 것]\n${body.draft.basicProfile.appearanceNotes.trim()}`:'';
    const secretProfileText=[body.draft.basicProfile.secretProfileText||'',appearanceForDetail].filter(Boolean).join('\n\n');
    const privateSource={version:'detail-source/1.0',secretProfileText,ownerReview:inferenceReview,answers:body.answers,confirmedFacts:body.draft.confirmedFacts,traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,personalityTags:body.draft.personalityTags};
    const {data:saved,error}=await sb.rpc('character2_create_character_preview_v2',{p_character_id:characterId,p_share_code:shareCode,p_name:name,p_schema_version:passport.schemaVersion,p_passport_json:passport,p_analysis_confidence:body.draft.analysisConfidence,p_engine_versions:passport.engineVersions,p_answers:body.answers,p_edit_token_hash:sha256(editToken),p_detail_seed_json:detailSeed,p_source_json:privateSource});
    if(error)throw error;if(saved!==true)throw new Error('CHARACTER_SAVE_FAILED');
    await attachAiUsageSession(body.draft.usageSessionId,shareCode);
    // 요약 리포트 생성 소요시간(관리자용). 실패해도 캐릭터 생성엔 영향 없게 조용히 넘어간다.
    try{await sb.rpc('character2_set_summary_timing',{p_share_code:shareCode,p_ms:summaryGenMs})}catch{}
    return {preview:buildCharacterReportPreview(passport),shareCode,editToken};
  // 스트리밍이 끊겨 진행률이 안 올라와도 막대가 멈춰 보이지 않게 시간 기반 하한을 둔다.
  },{estimateSeconds:100,floorCap:.9});
}
