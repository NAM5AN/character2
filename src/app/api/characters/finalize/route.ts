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
} from '@/lib/schemas/character';
import { askClaudeJson } from '@/lib/ai/anthropic';
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { apiError } from '@/lib/http';

const requestSchema=z.object({
  draft:characterDraftSchema,
  answers:z.array(interviewAnswerSchema).length(20),
});

type R=Record<string,unknown>;
const SUMMARY_SYSTEM=`당신은 자캐커뮤니티 캐릭터를 정밀하게 읽는 분석가입니다.
이번 단계에서는 결제 전 공개할 짧은 요약과, 결제 후 상세 리포트의 누락을 막는 구조화 Evidence Pack을 만듭니다.
긴 상세 리포트와 긴 유형별 원문은 아직 작성하지 마세요.
공개 프로필, 비밀 프로필, 오너 검수, 20문항 답변과 이유만 근거로 하며 없는 설정을 만들지 마세요.
Evidence Pack은 대표 특징 몇 개가 아니라 정보 보존용 중간 포맷입니다. 관계 차이, 예외, 사소하지만 고유한 디테일까지 폭넓게 보존하세요.
오너 직접 정정과 인터뷰 답변/이유는 AI 추론보다 우선합니다.`;

function rec(v:unknown):R{return v&&typeof v==='object'&&!Array.isArray(v)?v as R:{}}
function text(v:unknown):string{
  if(typeof v==='string')return v.replace(/\s+/g,' ').trim();
  if(Array.isArray(v))return v.map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(v&&typeof v==='object')return Object.values(v as R).map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  return v==null?'':String(v).trim();
}
function clip(v:string,max:number){const s=v.replace(/\s+/g,' ').trim();return s.length<=max?s:s.slice(0,max).trimEnd()}
function texts(v:unknown,maxItems:number){
  const a=Array.isArray(v)?v:typeof v==='string'?v.split(/\n+/):[];
  return [...new Set(a.map(text).map(x=>clip(x,190)).filter(x=>x.length>=12))].slice(0,maxItems);
}
function interviewEvidence(v:unknown){
  if(!Array.isArray(v))return [];
  const m=new Map<number,{order:number;finding:string}>();
  for(const item of v){const r=rec(item);const order=Number(r.order??r.questionOrder??r.question_order);const finding=clip(text(r.finding??r.text??r.summary??r.evidence),190);if(Number.isInteger(order)&&order>=1&&order<=20&&finding.length>=18&&!m.has(order))m.set(order,{order,finding});}
  return [...m.values()].sort((a,b)=>a.order-b.order);
}
function evidencePack(v:unknown){
  const p=rec(v);
  return {
    version:'evidence-pack/2.0' as const,
    publicProfileEvidence:texts(p.publicProfileEvidence,32),
    secretProfileEvidence:texts(p.secretProfileEvidence,28),
    ownerReviewEvidence:texts(p.ownerReviewEvidence,20),
    interviewEvidence:interviewEvidence(p.interviewEvidence),
    behaviorRules:texts(p.behaviorRules,14),
    relationshipPatterns:texts(p.relationshipPatterns,12),
    emotionalPatterns:texts(p.emotionalPatterns,12),
    valuesAndMotives:texts(p.valuesAndMotives,12),
    exceptionsAndConditions:texts(p.exceptionsAndConditions,12),
    tensionsAndContradictions:texts(p.tensionsAndContradictions,10),
    distinctiveDetails:texts(p.distinctiveDetails,16),
    uncertainties:texts(p.uncertainties,10),
  };
}
function normalize(raw:z.infer<typeof summaryAnalysisRawSchema>){
  const s=rec(raw.summary);
  return {
    oneLineSummary:clip(text(raw.oneLineSummary),80),
    summary:{outerSelf:clip(text(s.outerSelf),160),innerSelf:clip(text(s.innerSelf),160),conflictStyle:clip(text(s.conflictStyle),160),affectionStyle:clip(text(s.affectionStyle),160)},
    evidencePack:evidencePack(raw.evidencePack),
  };
}
function reason(e:z.ZodError){return e.issues.slice(0,16).map(x=>`${x.path.join('.')||'(root)'}: ${x.message}`).join('; ')}
async function generateSummary(input:string):Promise<SummaryAnalysisGeneration>{
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const retry=attempt?`\n\n이전 생성은 검증 실패했습니다. 원자료로 새로 작성하세요. 실패 원인: ${last}`:'';
    const raw=await askClaudeJson({system:SUMMARY_SYSTEM,schema:summaryAnalysisRawSchema,maxTokens:6800,input:`${input}${retry}`});
    const parsed=summaryAnalysisGenerationSchema.safeParse(normalize(raw));
    if(parsed.success)return parsed.data;
    last=reason(parsed.error);
  }
  throw new Error(`AI_JSON_SCHEMA_FAILED: ${last||'SUMMARY_EVIDENCE_PACK_FAILED'}`);
}
async function uniqueShareCode(){
  const sb=getSupabaseServer();
  for(let i=0;i<8;i++){const code=generateShareCode();const {data,error}=await sb.rpc('character2_share_code_exists',{p_share_code:code});if(error)throw error;if(data!==true)return code;}
  throw new Error('SHARE_CODE_EXHAUSTED');
}

export async function POST(request:Request){
  try{
    await assertRateLimit('character_finalize',8,60);
    const body=requestSchema.parse(await request.json());
    const inferenceReview={
      confirmed:body.draft.aiInferences.filter(x=>x.ownerVerdict==='confirmed').map(x=>({text:x.text,evidence:x.evidence})),
      ambiguous:body.draft.aiInferences.filter(x=>x.ownerVerdict==='ambiguous').map(x=>({text:x.text,evidence:x.evidence,ownerFeedback:x.ownerFeedback?.trim()||''})),
      rejectedCorrections:body.draft.aiInferences.filter(x=>x.ownerVerdict==='rejected'&&x.ownerFeedback?.trim()).map(x=>({ownerCorrection:x.ownerFeedback!.trim()})),
    };
    const analysisDraft={
      basicProfile:body.draft.basicProfile,
      traits:body.draft.traits,
      relationshipTraits:body.draft.relationshipTraits,
      confirmedFacts:body.draft.confirmedFacts,
      analysisConfidence:body.draft.analysisConfidence,
    };
    const summaryInput=`캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\nEvidence Pack 작성 원칙:\n- rejectedCorrections.ownerCorrection과 ambiguous.ownerFeedback은 ownerReviewEvidence에 보존하세요.\n- publicProfileEvidence는 공개 프로필의 사실·행동·관계·고유 디테일을 폭넓게 보존하세요.\n- secretProfileEvidence는 비밀 프로필의 사실·과거·동기·관계·숨은 조건을 원문 복사 없이 보존하세요. 비밀 프로필이 없으면 []입니다.\n- interviewEvidence는 정확히 20개이며 order 1~20이 각각 한 번씩 있어야 합니다. 각 finding은 해당 answer와 reason을 함께 읽어 확인된 내용을 남기세요.\n- behaviorRules / relationshipPatterns / emotionalPatterns / valuesAndMotives는 여러 근거를 결합한 해석입니다.\n- exceptionsAndConditions에는 관계별 차이와 상황에 따라 바뀌는 기준을 우선 보존하세요.\n- tensionsAndContradictions는 실제로 동시에 성립하는 상반된 면만 적으세요.\n- distinctiveDetails에는 다른 캐릭터와 구분되는 습관·물건·관계·말버릇·사건·취향·역할을 보존하세요. 의미가 없는 디테일에 심리 의미를 만들지 마세요.\n- uncertainties에는 확정할 수 없는 부분만 적으세요.\n- Pack은 무료 요약 반복물이 아니라 상세 AI가 빠뜨린 축을 점검하는 인덱스입니다.\n\n무료 출력: oneLineSummary 25~80자, summary의 4개 항목 각각 70~160자.\nEvidence Pack 각 텍스트는 12~190자로 압축하고 원문을 길게 복사하지 마세요.\n최종 JSON 키는 oneLineSummary, summary, evidencePack만 사용하세요. evidencePack.version은 evidence-pack/2.0입니다.`;
    const summaryResult=await generateSummary(summaryInput);
    characterEvidencePackSchema.parse(summaryResult.evidencePack);

    const sb=getSupabaseServer();
    const shareCode=await uniqueShareCode();
    const editToken=createEditToken();
    const characterId=crypto.randomUUID();
    const {name,age,gender,profileText}=body.draft.basicProfile;
    const sharedInferences=body.draft.aiInferences.map(x=>({id:x.id,text:x.text,confidence:x.confidence,evidenceIds:[],evidence:[],ownerVerdict:x.ownerVerdict}));
    const passport=characterPassportSchema.parse({
      schemaVersion:'character-passport/1.0',characterId,shareCode,
      basicProfile:{name,age,gender,profileText},traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,
      confirmedFacts:body.draft.confirmedFacts,aiInferences:sharedInferences,
      interview:{version:'interview/1.0',completedCount:20,answers:body.answers},
      analysis:{oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,outerSelf:'',innerSelf:'',coreValues:[],desires:[],fears:[],conflictStyle:'',affectionStyle:'',misunderstoodPoints:[],contradictions:[],interestingPoints:[]},
      engineVersions:{parser:'parser/1.3',interview:'interview/1.4',analysis:'summary-evidence/2.1'},
    });
    const detailSeed={version:'detail-seed/2.0',name,oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,evidencePack:summaryResult.evidencePack};
    const privateSource={
      version:'detail-source/1.0',
      secretProfileText:body.draft.basicProfile.secretProfileText||'',
      ownerReview:inferenceReview,
      answers:body.answers,
      confirmedFacts:body.draft.confirmedFacts,
      traits:body.draft.traits,
      relationshipTraits:body.draft.relationshipTraits,
    };
    const {data:saved,error}=await sb.rpc('character2_create_character_preview_v2',{
      p_character_id:characterId,p_share_code:shareCode,p_name:name,p_schema_version:passport.schemaVersion,
      p_passport_json:passport,p_analysis_confidence:body.draft.analysisConfidence,p_engine_versions:passport.engineVersions,
      p_answers:body.answers,p_edit_token_hash:sha256(editToken),p_detail_seed_json:detailSeed,p_source_json:privateSource,
    });
    if(error)throw error;
    if(saved!==true)throw new Error('CHARACTER_SAVE_FAILED');
    return NextResponse.json({preview:buildCharacterReportPreview(passport),shareCode,editToken});
  }catch(error){return apiError(error)}
}
