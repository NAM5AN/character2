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
import { assertRateLimit } from '@/lib/rate-limit';
import { generateShareCode } from '@/lib/share-code';
import { createEditToken, sha256 } from '@/lib/crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { apiError } from '@/lib/http';

const requestSchema=z.object({draft:characterDraftSchema,answers:z.array(interviewAnswerSchema).length(20)});
type R=Record<string,unknown>;

const SUMMARY_SYSTEM=`당신은 자캐커뮤니티 캐릭터를 정밀하게 읽는 분석가입니다.
이번 단계에서는 결제 전 공개할 짧은 요약과 상세 분석을 보조할 고차원 패턴만 만듭니다.
긴 상세 리포트와 긴 유형별 원문은 절대 미리 쓰지 마세요.
공개 프로필, 비밀 프로필, 오너 검수, 20문항 답변과 이유만 근거로 하며 없는 설정을 만들지 마세요.
오너 직접 정정과 인터뷰 답변/이유는 AI 추론보다 우선합니다.
Evidence Pack의 원자료 보존 부분은 서버가 직접 만들므로, 당신은 behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties 같은 고차원 패턴만 간결하게 제안하세요.
프로필에서 근거가 부족한 항목은 억지로 개수를 채우지 말고 빈 배열로 둘 수 있습니다.`;

function rec(v:unknown):R{return v&&typeof v==='object'&&!Array.isArray(v)?v as R:{}}
function text(v:unknown):string{if(typeof v==='string')return v.replace(/\s+/g,' ').trim();if(Array.isArray(v))return v.map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();if(v&&typeof v==='object')return Object.values(v as R).map(text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();return v==null?'':String(v).trim()}
function clip(v:string,max:number){const s=v.replace(/\s+/g,' ').trim();return s.length<=max?s:s.slice(0,max).trimEnd()}
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
  return {
    version:'evidence-pack/2.0' as const,
    publicProfileEvidence:fragments(body.draft.basicProfile.profileText,32),
    secretProfileEvidence:fragments(body.draft.basicProfile.secretProfileText||'',28),
    ownerReviewEvidence:ownerEvidence(review),
    interviewEvidence:deterministicInterviewEvidence(body.answers),
    behaviorRules:texts(p.behaviorRules,14),relationshipPatterns:texts(p.relationshipPatterns,12),emotionalPatterns:texts(p.emotionalPatterns,12),valuesAndMotives:texts(p.valuesAndMotives,12),exceptionsAndConditions:texts(p.exceptionsAndConditions,12),tensionsAndContradictions:texts(p.tensionsAndContradictions,10),distinctiveDetails:texts(p.distinctiveDetails,16),uncertainties:texts(p.uncertainties,10),
  };
}
function normalize(raw:z.infer<typeof summaryAnalysisRawSchema>,body:z.infer<typeof requestSchema>,review:any){const s=rec(raw.summary);return {oneLineSummary:clip(text(raw.oneLineSummary),80),summary:{outerSelf:clip(text(s.outerSelf),160),innerSelf:clip(text(s.innerSelf),160),conflictStyle:clip(text(s.conflictStyle),160),affectionStyle:clip(text(s.affectionStyle),160)},evidencePack:buildPack(raw.evidencePack,body,review)}}
function validationReason(e:z.ZodError){return e.issues.slice(0,16).map(x=>`${x.path.join('.')||'(root)'}: ${x.message}`).join('; ')}

async function generateSummary(input:string,body:z.infer<typeof requestSchema>,review:any):Promise<SummaryAnalysisGeneration>{
  let last='';
  for(let attempt=0;attempt<2;attempt++){
    const retry=attempt===0?'':`\n\n이전 생성은 JSON 형식/길이 검증에 실패했습니다. 이번에는 사용자에게 보이는 oneLineSummary와 summary 4개 필드를 최우선으로 완성하세요. evidencePack은 빈 객체 {}로 출력해도 됩니다. 이전 출력을 수리하지 말고 원자료에서 새로 작성하세요. 실패 원인: ${last}`;
    try{
      const raw=await askClaudeJson({system:SUMMARY_SYSTEM,schema:summaryAnalysisRawSchema,maxTokens:4000,maxAttempts:1,input:`${input}${retry}`,allowFallback:false});
      const parsed=summaryAnalysisGenerationSchema.safeParse(normalize(raw,body,review));
      if(parsed.success)return parsed.data;
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
    const summaryInput=`캐릭터 데이터:\n${JSON.stringify(analysisDraft)}\n\nAI 추론에 대한 오너 검수:\n${JSON.stringify(inferenceReview)}\n\n오너 인터뷰 20문항:\n${JSON.stringify(body.answers)}\n\n출력 규칙:\n- oneLineSummary: 25~80자.\n- summary.outerSelf / innerSelf / conflictStyle / affectionStyle: 각각 70~160자.\n- evidencePack에는 behaviorRules, relationshipPatterns, emotionalPatterns, valuesAndMotives, exceptionsAndConditions, tensionsAndContradictions, distinctiveDetails, uncertainties만 작성합니다. 각 축은 정말 중요한 발견만 0~3개로 제한하세요.\n- 원자료를 반복 복사하지 말고 여러 근거를 연결한 패턴만 적으세요.\n- 근거가 부족한 축은 빈 배열로 두세요.\n- 사용자에게 보이는 oneLineSummary와 summary 4개 필드의 완결성이 evidencePack의 개수보다 항상 우선합니다.\n최종 JSON 키는 oneLineSummary, summary, evidencePack만 사용하세요.`;
    const summaryResult=await generateSummary(summaryInput,body,inferenceReview);
    characterEvidencePackSchema.parse(summaryResult.evidencePack);

    const sb=getSupabaseServer(),shareCode=await uniqueShareCode(),editToken=createEditToken(),characterId=crypto.randomUUID();
    const {name,age,gender,profileText}=body.draft.basicProfile;
    const sharedInferences=body.draft.aiInferences.map(x=>({id:x.id,text:x.text,confidence:x.confidence,evidenceIds:[],evidence:[],ownerVerdict:x.ownerVerdict}));
    const passport=characterPassportSchema.parse({schemaVersion:'character-passport/1.0',characterId,shareCode,basicProfile:{name,age,gender,profileText},traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits,confirmedFacts:body.draft.confirmedFacts,aiInferences:sharedInferences,interview:{version:'interview/1.0',completedCount:20,answers:body.answers},analysis:{oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,outerSelf:'',innerSelf:'',coreValues:[],desires:[],fears:[],conflictStyle:'',affectionStyle:'',misunderstoodPoints:[],contradictions:[],interestingPoints:[]},engineVersions:{parser:'parser/1.3',interview:'interview/1.4',analysis:'claude-only-summary-evidence/2.5'}});
    const detailSeed={version:'detail-seed/2.0',name,oneLineSummary:summaryResult.oneLineSummary,summary:summaryResult.summary,evidencePack:summaryResult.evidencePack};
    const privateSource={version:'detail-source/1.0',secretProfileText:body.draft.basicProfile.secretProfileText||'',ownerReview:inferenceReview,answers:body.answers,confirmedFacts:body.draft.confirmedFacts,traits:body.draft.traits,relationshipTraits:body.draft.relationshipTraits};
    const {data:saved,error}=await sb.rpc('character2_create_character_preview_v2',{p_character_id:characterId,p_share_code:shareCode,p_name:name,p_schema_version:passport.schemaVersion,p_passport_json:passport,p_analysis_confidence:body.draft.analysisConfidence,p_engine_versions:passport.engineVersions,p_answers:body.answers,p_edit_token_hash:sha256(editToken),p_detail_seed_json:detailSeed,p_source_json:privateSource});
    if(error)throw error;if(saved!==true)throw new Error('CHARACTER_SAVE_FAILED');
    return NextResponse.json({preview:buildCharacterReportPreview(passport),shareCode,editToken});
  }catch(error){return apiError(error)}
}
