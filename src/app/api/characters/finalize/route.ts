import { NextResponse } from 'next/server';
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
import { askClaudeJson } from '@/lib/ai/anthropic';
import { attachAiUsageSession, withAiUsageContext } from '@/lib/ai/usage';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { apiError } from '@/lib/http';

const requestSchema=z.object({draft:characterDraftSchema,answers:z.array(interviewAnswerSchema).length(20)});
type R=Record<string,unknown>;

const SUMMARY_SYSTEM=`당신은 자캐커뮤니티 캐릭터를 정밀하게 읽고, 오너에게 옆에서 풀이해주는 전문 해석자입니다.
이번 단계의 목표는 결제 전 공개할 "흥미로운 요약 리포트"와 이후 상세 분석을 보조할 고차원 패턴을 만드는 것입니다.

이 요약은 프로필이나 질의응답을 보기 좋게 다시 적는 요약문이 아닙니다. 사용자가 "내가 적은 내용을 그대로 읽어준 게 아니라, 서로 떨어진 단서를 연결해서 캐릭터를 읽었구나"라고 느껴야 합니다.

분석 규칙:
- 공개 프로필, 비밀 프로필, 외관 자료 관찰 메모, 오너 검수, 20문항의 답변과 이유를 모두 사용할 수 있습니다.
- basicProfile.appearanceNotes가 있으면 이미지에서 직접 관찰한 외형·의상·소품·시각적 인상 메모입니다. 외형과 자기표현, 첫인상, 반복 모티프를 해석하는 보조 자료로 사용하세요.
- 외관 자료만으로 성격·동기·정신상태·과거·관계 성향을 확정하지 마세요. 심리적인 결론은 반드시 프로필이나 질의응답의 다른 단서와 연결될 때만 강화하세요.
- 그림체, 조명, 포즈 한 장의 연출을 공식 성격 설정처럼 취급하지 마세요.
- 오너의 명시적 정정과 보충은 AI의 기존 추론보다 우선합니다.
- 각 사용자 노출 카드에는 가능하면 서로 다른 두 개 이상의 단서를 연결해 원문에 직접 적혀 있지 않은 연결을 하나 이상 포함하세요.
- 원문에서 바로 찾을 수 있는 사실 하나를 표현만 바꾸어 적는 것은 실패입니다.
- "충동적이다", "다정하다", "독립적이다" 같은 성격 라벨만 붙이지 말고, 어떤 기준·욕구·민감점 때문에 그렇게 보이는지를 한 단계 더 설명하세요.
- 구체적 행동은 해석을 붙잡는 짧은 예로만 쓰고, 질문이나 답변을 순서대로 다시 읽어주지 마세요.
- "프로필에서", "답변에서", "질문에서", 문항 번호, 점수, 퍼센트, 슬라이더 같은 분석 과정과 UI 흔적을 노출하지 마세요.
- 없는 과거, 트라우마, 진단, 비밀 설정을 창작하지 마세요.

문체와 문단:
- 실제 상담사가 캐릭터 오너에게 차분하게 풀이하듯 자연스러운 해요체 존댓말을 사용하세요.
- "~다.", "~이다.", "~한다." 같은 보고서체는 쓰지 마세요. "~해요", "~보여요", "~수 있어요", "~쪽에 가까워요"처럼 설명하세요.
- 각 summary 카드는 서로 이어지는 2개의 짧은 문단으로 구성하고, 문단 사이는 반드시 빈 줄 하나(\n\n)로 구분하세요.
- 문장 수를 맞추려고 기계적으로 나누지 말고, 첫 문단에서 핵심 인상·작동 원리를 설명한 뒤 두 번째 문단에서 조건·예외·의외의 연결로 자연스럽게 이어가세요.
- 모든 문단의 첫 문장은 **굵은 안내문**이어야 합니다. 형식은 반드시 **안내문**처럼 별표 두 개로 감싸세요.
- 굵은 안내문은 결론 요약이 아니라 "이 문단이 무엇을 다루는지"만 알려줘야 합니다.
- 안내문은 아래 두 결 중 문단에 자연스러운 하나만 사용하세요. 두 방식을 한 문장에 합치지 마세요.
  A형: 상담사가 화제를 안내하는 문장. 예: **겉으로 보이는 인상부터 조금 더 들여다볼게요.**
  C형: 독자가 궁금해할 질문. 예: **이 캐릭터는 왜 이런 인상으로 보일까요?**
- A형/C형을 A-C-A-C처럼 규칙적으로 번갈아 쓰지 마세요. 같은 유형이 연속되어도 괜찮고, 카드마다 자연스럽게 섞으세요.
- **이 캐릭터는 사실 통제욕이 강해요.**처럼 해석 결론 자체를 굵은 안내문에 넣지 마세요.

결제 전 요약은 충분히 읽을 가치가 있어야 하지만 상세 리포트를 통째로 대신해서도 안 됩니다. 각 카드는 핵심적인 한 단계의 해석까지 보여주고, 그 원리가 관계·애착·갈등·극한 상황에서 어떻게 이어지는지에 대한 전체 인과와 반례는 상세 리포트에 남겨두세요.

사용자에게 보이는 summary 6개 필드는 각각 160~240자를 목표로 작성하세요. 같은 행동이나 같은 결론을 카드마다 반복하지 마세요.
- outerSelf: 겉으로 다른 사람이 체감하는 인상과, 그 인상이 단순한 성격 라벨로 설명되지 않는 지점을 보여주세요. 외관 관찰이 있다면 시각적 첫인상과 실제 행동 패턴의 차이를 연결할 수 있습니다.
- innerSelf: 실제 선택을 움직이는 자기상·욕구·내적 기준과 표면 인상 사이의 차이를 보여주세요.
- conflictStyle: 단순한 싸움 절차가 아니라 감정이 흔들리는 자극, 상처받는 지점, 평소와 반응이 달라지는 순간을 보여주세요.
- affectionStyle: 애정 행동 나열보다 사람과 거리를 조절하는 법, 신뢰가 생기는 조건, 가까워질수록 반복되는 관계 패턴을 보여주세요.
- misunderstoodPoint: 겉으로는 한 의미로 오해받기 쉽지만 실제 기능은 다르게 읽히는 지점을 하나 골라 설명하세요. 외관과 행동이 다르게 읽히는 경우도 좋은 후보입니다.
- hiddenPattern: 서로 멀리 떨어진 단서 두 개 이상을 연결했을 때만 보이는 의외의 공통 원리나 숨은 패턴을 보여주세요. 상세 리포트의 모든 이유를 미리 풀지는 마세요.

oneLineSummary는 가장 눈에 띄는 긴장이나 행동 원리를 25~80자의 한 문장으로 압축하세요.
Evidence Pack의 원자료 보존 부분은 서버가 직접 만듭니다. 당신은 behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties 같은 고차원 패턴만 간결하게 제안하세요.
근거가 부족한 Evidence Pack 축은 억지로 개수를 채우지 말고 빈 배열로 둘 수 있습니다.`;

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
function buildPack(rawPack:unknown,body:z.infer<typeof requestSchema>,review:any){
  const p=rec(rawPack);
  const appearanceDetails=fragments(body.draft.basicProfile.appearanceNotes||'',8).map(x=>`외관 관찰: ${x}`);
  const rawDistinctive=Array.isArray(p.distinctiveDetails)?p.distinctiveDetails:typeof p.distinctiveDetails==='string'?[p.distinctiveDetails]:[];
  return {
    version:'evidence-pack/2.0' as const,
    publicProfileEvidence:fragments(body.draft.basicProfile.profileText,32),
    secretProfileEvidence:fragments(body.draft.basicProfile.secretProfileText||'',28),
    ownerReviewEvidence:ownerEvidence(review),
    interviewEvidence:deterministicInterviewEvidence(body.answers),
    behaviorRules:texts(p.behaviorRules,14),relationshipPatterns:texts(p.relationshipPatterns,12),emotionalPatterns:texts(p.emotionalPatterns,12),valuesAndMotives:texts(p.valuesAndMotives,12),exceptionsAndConditions:texts(p.exceptionsAndConditions,12),tensionsAndContradictions:texts(p.tensionsAndContradictions,10),distinctiveDetails:texts([...rawDistinctive,...appearanceDetails],16),uncertainties:texts(p.uncertainties,10),
  };
}
function normalize(raw:z.infer<typeof summaryAnalysisRawSchema>,body:z.infer<typeof requestSchema>,review:any){
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
    evidencePack:buildPack(raw.evidencePack,body,review),
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

async function generateSummary(input:string,body:z.infer<typeof requestSchema>,review:any):Promise<SummaryAnalysisGeneration>{
  let last='';
  for(let attempt=0;attempt<2;attempt++){
    const retry=attempt===0?'':`\n\n이전 생성은 JSON 형식 또는 공개 요약 품질 점검에 걸렸습니다. 이번에는 사용자에게 보이는 oneLineSummary와 summary 6개 필드를 최우선으로 새로 작성하세요. 각 summary 필드는 160~240자를 목표로 하고 130자보다 짧아지지 않게 충분한 맥락을 담으세요. 각 필드는 반드시 2문단이며 문단 사이에 \\n\\n을 넣으세요. 각 문단 첫 문장은 반드시 **굵은 안내문**이고, 결론이 아니라 그 문단에서 다룰 주제만 알려줘야 합니다. 안내형과 질문형 중 하나만 골라 자연스럽게 사용하고 규칙적으로 번갈아 쓰지 마세요. 전체 본문은 상담사가 풀이하듯 자연스러운 해요체 존댓말로 작성하세요. 원자료 한 문장을 표현만 바꾸지 말고 서로 다른 단서를 연결한 해석을 반드시 포함하세요. misunderstoodPoint와 hiddenPattern도 빠뜨리지 마세요. evidencePack은 빈 객체 {}로 출력해도 됩니다. 이전 출력을 수리하지 말고 원자료에서 새로 작성하세요. 점검 내용: ${last}`;
    try{
      const raw=await askClaudeJson({system:SUMMARY_SYSTEM,schema:summaryAnalysisRawSchema,maxTokens:4000,maxAttempts:1,input:`${input}${retry}`,allowFallback:false});
      const parsed=summaryAnalysisGenerationSchema.safeParse(normalize(raw,body,review));
      if(parsed.success){
        const shortFields=shortSummaryFields(parsed.data.summary);
        const formatIssues=summaryFormatIssues(parsed.data.summary);
        if((shortFields.length||formatIssues.length)&&attempt===0){
          last=[shortFields.length?`공개 요약 필드가 권장 최소 130자보다 짧음: ${shortFields.join(', ')}`:'',formatIssues.length?`문단 형식 오류: ${formatIssues.join(', ')}`:''].filter(Boolean).join(' / ');
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
async function uniqueShareCode(){const sb=getSupabaseServer();for(let i=0;i<8;i++){const code=generateShareCode();const {data,error}=await sb.rpc('character2_share_code_exists',{p_share_code:code});if(error)throw error;if(data!==true)return code}throw new Error('SHARE_CODE_EXHAUSTED')}

export async function POST(request:Request){
  try{
    await assertRateLimit('character_finalize',8,60);
    const body=requestSchema.parse(await request.json());
    const inferenceReview={
      confirmed:body.draft.aiInferences.filter(x=>x.ownerVerdict==='confirmed').map(x=>({text:x.text,evidence:x.evidence})),
      ambiguous:body.draft.aiInferences.filter(x=>x.ownerVerdict==='ambiguous').map(x=>({text:x.text,evidence:x.evidence,ownerFeedback:x.ownerFeedback?.trim()||''})),
      rejectedCorrections:body.draft.aiInferences.filter(x=>x.ownerVerdict==='rejected'&&x.ownerFeedback?.trim()).map(x=>({ownerCorrection:x.ownerFeedback!.trim()})),
    };
    const analysisDraft={basicProfile:body.draft.basicProfile,traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,confirmedFacts:body.draft.confirmedFacts,analysisConfidence:body.draft.analysisConfidence};
    const summaryInput=`캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n출력 규칙:\n- oneLineSummary: 25~80자의 한 문장. 단순 성격 라벨보다 이 캐릭터의 가장 흥미로운 긴장이나 행동 원리를 잡으세요.\n- basicProfile.appearanceNotes가 있으면 외관 자료의 직접 관찰 메모입니다. 첫인상·자기표현·시각 모티프를 참고하되, 외형만으로 내면을 단정하지 마세요.\n- summary.outerSelf: 겉으로 보이는 인상과 그 인상을 단순 라벨로만 설명할 수 없는 지점. 외관 관찰이 있으면 행동과 교차해 활용하세요.\n- summary.innerSelf: 실제 선택을 움직이는 자기상·욕구·내적 기준.\n- summary.conflictStyle: 감정이 흔들리는 자극과 평소 반응이 달라지는 순간.\n- summary.affectionStyle: 신뢰가 생기는 조건과 관계에서 반복되는 거리·개입 패턴.\n- summary.misunderstoodPoint: 겉에서 오해하기 쉬운 의미와 실제 내부 기능의 차이.\n- summary.hiddenPattern: 서로 다른 두 개 이상의 단서를 연결했을 때 보이는 의외의 공통 원리.\n- summary 6개 필드는 각각 160~240자를 목표로 하고 최대 260자를 넘기지 마세요.\n- 각 summary 필드는 정확히 2개의 자연스러운 문단으로 나누고 문단 사이는 빈 줄 하나(\\n\\n)로 구분하세요.\n- 모든 문단은 **문단에서 다룰 주제만 알려주는 짧은 안내문**으로 시작하세요. 안내형 또는 질문형 중 하나만 쓰고, 결론을 굵은 문장에 미리 요약하지 마세요.\n- 본문은 실제 상담사가 오너에게 캐릭터를 풀이하듯 자연스러운 해요체 존댓말로 작성하세요. 보고서체 '~다/~이다/~한다'는 피하세요.\n- 여섯 카드는 같은 행동이나 같은 결론을 반복하지 마세요. 각 카드마다 원문에서 바로 찾기 어려운 연결을 최소 하나 포함하세요.\n- 상세 리포트에서 다룰 모든 인과와 반례를 미리 풀지 말고, 결제 전 요약만으로도 흥미로운 핵심 연결까지 보여주세요.\n- evidencePack에는 behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties만 작성합니다. 외관 관찰이 있으면 distinctiveDetails에 중요한 시각 특징을 포함할 수 있습니다. 각 축은 정말 중요한 발견만 0~3개로 제한하세요.\n- 근거가 부족한 Evidence Pack 축은 빈 배열로 두세요.\n- 사용자에게 보이는 oneLineSummary와 summary 6개 필드의 완결성·추론 깊이·충분한 분량이 evidencePack의 개수보다 항상 우선합니다.\n최종 JSON 키는 oneLineSummary, summary, evidencePack만 사용하세요.`;
    const summaryResult=await withAiUsageContext({sessionId:body.draft.usageSessionId,stage:'summary_teaser'},()=>generateSummary(summaryInput,body,inferenceReview));
    characterEvidencePackSchema.parse(summaryResult.evidencePack);

    const sb=getSupabaseServer(),shareCode=await uniqueShareCode(),editToken=createEditToken(),characterId=crypto.randomUUID();
    const {name,age,gender,profileText}=body.draft.basicProfile;
    const sharedInferences=body.draft.aiInferences.map(x=>({id:x.id,text:x.text,confidence:x.confidence,evidenceIds:[],evidence:[],ownerVerdict:x.ownerVerdict}));
    const passport=characterPassportSchema.parse({schemaVersion:'character-passport/1.0',characterId,shareCode,basicProfile:{name,age,gender,profileText},traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,confirmedFacts:body.draft.confirmedFacts,aiInferences:sharedInferences,interview:{version:'interview/1.0',completedCount:20,answers:body.answers},analysis:{oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,outerSelf:'',innerSelf:'',coreValues:[],desires:[],fears:[],conflictStyle:'',affectionStyle:'',misunderstoodPoints:[],contradictions:[],interestingPoints:[]},engineVersions:{parser:'parser/1.4-image',interview:'interview/1.4',analysis:'claude-summary-teaser/3.2'}});
    const detailSeed={version:'detail-seed/2.0',name,oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,evidencePack:summaryResult.evidencePack};
    const appearanceForDetail=body.draft.basicProfile.appearanceNotes?.trim()?`[외관 자료 관찰 메모 — 시각 보조 근거이며 성격·감정·과거를 단독으로 확정하지 말 것]\n${body.draft.basicProfile.appearanceNotes.trim()}`:'';
    const secretProfileText=[body.draft.basicProfile.secretProfileText||'',appearanceForDetail].filter(Boolean).join('\n\n');
    const privateSource={version:'detail-source/1.0',secretProfileText,ownerReview:inferenceReview,answers:body.answers,confirmedFacts:body.draft.confirmedFacts,traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits};
    const {data:saved,error}=await sb.rpc('character2_create_character_preview_v2',{p_character_id:characterId,p_share_code:shareCode,p_name:name,p_schema_version:passport.schemaVersion,p_passport_json:passport,p_analysis_confidence:body.draft.analysisConfidence,p_engine_versions:passport.engineVersions,p_answers:body.answers,p_edit_token_hash:sha256(editToken),p_detail_seed_json:detailSeed,p_source_json:privateSource});
    if(error)throw error;if(saved!==true)throw new Error('CHARACTER_SAVE_FAILED');
    await attachAiUsageSession(body.draft.usageSessionId,shareCode);
    return NextResponse.json({preview:buildCharacterReportPreview(passport),shareCode,editToken});
  }catch(error){return apiError(error)}
}
