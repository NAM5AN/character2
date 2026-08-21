import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { characterReportPreviewSchema } from '@/lib/character-report';
import { assertRateLimit } from '@/lib/rate-limit';
import {
  DETAIL_REPORT_VERSION,
  generatePaidDetailContinuation,
  generatePaidDetailRemaining,
  generatePaidDetailStage1,
} from '@/lib/ai/detail-report';
import { withAiUsageContext } from '@/lib/ai/usage';
import { CHARACTER_DEEP_ANALYSIS_SKILL_VERSION } from '@/lib/ai/character-deep-analysis-skill';
import { apiError } from '@/lib/http';
import { createDetailViewToken, sha256 } from '@/lib/crypto';
import { detailViewCookieName, detailViewCookieOptions, serializeDetailViewCookie } from '@/lib/detail-access';
import { ndjsonStream } from '@/lib/ai/stream';

const detailBundleSchema=z.object({
  seed:z.unknown().nullable().optional(),
  detail:z.unknown().nullable().optional(),
  precomputedDossier:z.unknown().nullable().optional(),
  precomputedAt:z.string().nullable().optional(),
  legacyAnalysis:z.unknown().nullable().optional(),
  publicProfileText:z.string().optional().default(''),
  confirmedFactCount:z.coerce.number().int().nonnegative().default(0),
  inferenceCount:z.coerce.number().int().nonnegative().default(0),
});

const PRECOMPUTE_FRESH_MS=24*60*60*1000;
// 결제 전에 미리 계산해둔 dossier가 (a) 존재하고 (b) 현재 프롬프트/스킬 버전과 같고 (c) 하루 안에 계산됐으면 재사용한다.
// 하나라도 어긋나면 무시하고 stage 1이 심리모델을 정상 생성한다.
function usablePrecomputedDossier(bundle:z.infer<typeof detailBundleSchema>):unknown{
  const pc=bundle.precomputedDossier;
  if(!pc||typeof pc!=='object'||Array.isArray(pc))return undefined;
  const tag=(pc as Record<string,unknown>)._v;
  if(tag!==`${DETAIL_REPORT_VERSION}|${CHARACTER_DEEP_ANALYSIS_SKILL_VERSION}`)return undefined;
  const at=typeof bundle.precomputedAt==='string'?Date.parse(bundle.precomputedAt):NaN;
  if(!Number.isFinite(at)||Date.now()-at>=PRECOMPUTE_FRESH_MS)return undefined;
  return pc;
}

function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}

function storedDetailStage(raw:Record<string,unknown>){
  const explicit=Number(raw.detailStage);
  if(explicit===1||explicit===2||explicit===3)return explicit;
  if(typeof raw.integratedReport==='string'&&raw.integratedReport.trim())return 3;
  if(typeof raw.relationshipStyle==='string'&&raw.relationshipStyle.trim())return 2;
  if(typeof raw.characterOverview==='string'&&raw.characterOverview.trim())return 1;
  if(typeof raw.detailedReport==='string'&&raw.detailedReport.trim())return 3;
  return 0;
}

async function loadPreview(rawCode:string){
  const shareCode=normalizeShareCode(rawCode);
  if(!isShareCode(shareCode))return {shareCode,error:'INVALID_SHARE_CODE' as const,status:400 as const,preview:null};
  const sb=getSupabaseServer();
  const {data,error}=await sb.rpc('character2_get_public_preview',{p_share_code:shareCode});
  if(error)throw error;
  if(!data)return {shareCode,error:'CHARACTER_NOT_FOUND' as const,status:404 as const,preview:null};
  return {shareCode,error:null,status:200 as const,preview:characterReportPreviewSchema.parse(data)};
}

export async function GET(_request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    const {shareCode:raw}=await context.params;
    const loaded=await loadPreview(raw);
    if(!loaded.preview)return NextResponse.json({error:loaded.error},{status:loaded.status});
    return NextResponse.json({preview:loaded.preview});
  }catch(error){return apiError(error)}
}

const detailSchema=z.object({
  accessCode:z.string().min(1).optional(),
  editToken:z.string().min(16).optional(),
  stage:z.coerce.number().int().min(1).max(3).optional().default(1),
  // dossier가 준비된 뒤 남은 두 페이지(2,3)를 한 요청에서 병렬 생성해 한 번에 저장한다.
  finishRemaining:z.boolean().optional().default(false),
});

// 첫 페이지 생성은 1분 이상 걸리고 그동안 진행률 스트림이 열려 있어야 한다.
// 플랫폼 기본값이 바뀌어도 스트림이 중간에 끊기지 않도록 상한을 명시한다.
export const maxDuration=300;

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  let issuedCookie:{shareCode:string;token:string}|null=null;
  try{
    await assertRateLimit('character_detail_unlock',12,60);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});
    const body=detailSchema.parse(await request.json());
    const cookieStore=await cookies();
    let detailViewToken=cookieStore.get(detailViewCookieName(shareCode))?.value?.trim()||'';

    const sb=getSupabaseServer();
    let bundleData:unknown=null;

    if(detailViewToken){
      const {data,error}=await sb.rpc('character2_get_entitled_detail_bundle',{
        p_share_code:shareCode,
        p_detail_view_token:detailViewToken,
        p_edit_token:body.editToken||'',
      });
      if(error)throw error;
      if(data)bundleData=data;
    }

    if(!bundleData&&(body.accessCode?.trim()||body.editToken)){
      detailViewToken=createDetailViewToken();
      const {data,error}=await sb.rpc('character2_claim_detail_entitlement',{
        p_share_code:shareCode,
        p_access_code:body.accessCode?.trim()||'',
        p_detail_view_token_hash:sha256(detailViewToken),
        p_edit_token:body.editToken||'',
      });
      if(error)throw error;
      if(!data)return NextResponse.json({error:'CHARACTER_NOT_FOUND'},{status:404});
      bundleData=data;
      issuedCookie={shareCode,token:detailViewToken};
    }

    if(!bundleData)return NextResponse.json({error:'DETAIL_ACCESS_DENIED'},{status:403});

    const bundle=detailBundleSchema.parse(bundleData);
    const rawDetail=record(bundle.detail);
    const parsedExisting=bundle.detail?finalAnalysisSchema.safeParse(bundle.detail):null;
    const currentVersion=Boolean(bundle.detail)&&
      rawDetail.detailVersion===DETAIL_REPORT_VERSION&&
      rawDetail.skillVersion===CHARACTER_DEEP_ANALYSIS_SKILL_VERSION;
    const currentStage=currentVersion?storedDetailStage(rawDetail):0;

    const respond=(payload:unknown,status=200)=>{
      const response=NextResponse.json(payload,{status});
      if(issuedCookie){
        response.cookies.set(detailViewCookieName(issuedCookie.shareCode),issuedCookie.token,detailViewCookieOptions());
      }
      return response;
    };

    // finishRemaining 요청은 아직 완결(stage 3)되지 않았다면 캐시로 빠지지 말고 남은 페이지를 마저 생성한다.
    const wantsFinish=body.finishRemaining&&currentStage<3;
    if(currentVersion&&parsedExisting?.success&&currentStage>=body.stage&&!wantsFinish){
      return respond({detail:{analysis:parsedExisting.data,stageReady:currentStage,complete:currentStage>=3,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true}});
    }

    if(!bundle.seed&&bundle.legacyAnalysis){
      const legacy=finalAnalysisSchema.safeParse(bundle.legacyAnalysis);
      const hasReadableLegacy=legacy.success&&Boolean((legacy.data.outerSelf?.trim()&&legacy.data.innerSelf?.trim())||legacy.data.characterOverview?.trim());
      if(legacy.success&&hasReadableLegacy){
        return respond({detail:{analysis:legacy.data,stageReady:3,complete:true,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true,legacy:true}});
      }
    }

    if(!bundle.seed)return respond({error:'DETAIL_SOURCE_NOT_AVAILABLE'},409);

    const saveDetail=async(storedAnalysis:Record<string,unknown>)=>{
      const {data:saved,error:saveError}=await sb.rpc('character2_save_entitled_detail',{
        p_share_code:shareCode,p_detail_view_token:detailViewToken,p_edit_token:body.editToken||'',p_detail_json:storedAnalysis,
      });
      if(saveError)throw saveError;
      if(saved!==true)throw new Error('DETAIL_SAVE_FAILED');
    };

    // 상세 리포트 생성 소요시간 측정(관리자용). 코드 입력 후 stage 1 시작 기준. 실패해도 생성엔 영향 없음.
    const markTimingStart=async()=>{try{await sb.rpc('character2_mark_detail_timing_start',{p_share_code:shareCode})}catch{}};
    const markTimingDone=async()=>{try{await sb.rpc('character2_mark_detail_timing_done',{p_share_code:shareCode})}catch{}};

    // stage 는 기본값이 1이라, stage 를 생략하는 finishRemaining 요청도 이 분기에 걸렸다.
    // 그래서 남은 두 페이지 대신 1페이지가 매번 다시 생성됐다(비용 낭비 + stageReady 정체).
    if(body.stage===1&&!body.finishRemaining){
      if(!body.editToken)return respond({error:'DETAIL_OWNER_SOURCE_REQUIRED'},409);
      await markTimingStart();
      const seedRecord=record(bundle.seed);
      const needsRawSource=seedRecord.version==='detail-seed/2.0';
      let privateSource:unknown=undefined;
      if(needsRawSource){
        const {data:source,error:sourceError}=await sb.rpc('character2_get_entitled_detail_source',{p_share_code:shareCode,p_edit_token:body.editToken});
        if(sourceError)throw sourceError;
        if(!source)return respond({error:'EDIT_TOKEN_INVALID'},403);
        privateSource=source;
      }

      const precomputed=usablePrecomputedDossier(bundle);
      // 첫 페이지는 1분 넘게 걸린다. 예전에는 화면이 경과 시간으로 %를 지어냈지만,
      // 이제 실제 생성 진행률을 흘려보낸다(요약 화면과 같은 방식).
      return ndjsonStream(async(emit)=>{
        const generated=await withAiUsageContext({shareCode,stage:'detail_stage_1'},()=>generatePaidDetailStage1(bundle.seed,bundle.publicProfileText,privateSource,precomputed,(r:number)=>emit(r*.97)));
        const storedAnalysis:Record<string,unknown>={...generated.analysis,detailVersion:DETAIL_REPORT_VERSION,skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION,detailStage:1,detailComplete:false,_detailDossier:generated.dossier};
        await saveDetail(storedAnalysis);
        await markTimingDone();
        const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
        return {detail:{analysis:publicAnalysis,stageReady:1,complete:false,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}};
      },{
        estimateSeconds:70,
        floorCap:.9,
        ...(issuedCookie?{headers:{'set-cookie':serializeDetailViewCookie(issuedCookie.shareCode,issuedCookie.token)}}:{}),
      });
    }

    // 남은 두 페이지(2,3)를 병렬로 한 번에 생성. dossier만 있으면 되므로 stage 2 저장을 기다리지 않는다.
    if(body.finishRemaining){
      if(!currentVersion||currentStage<1){
        return respond({error:'DETAIL_STAGE_NOT_READY',details:`먼저 첫 페이지 생성이 필요해요. 현재 준비 단계: ${currentStage}`},409);
      }
      const restDossier=rawDetail._detailDossier;
      if(!restDossier)return respond({error:'DETAIL_DOSSIER_MISSING'},409);
      const restPatch=await withAiUsageContext({shareCode,stage:'detail_stage_rest'},()=>generatePaidDetailRemaining(bundle.seed,restDossier));
      const {_detailDossier:ignoredRestDossier,...existingBeforeRest}=rawDetail;
      void ignoredRestDossier;
      const restStored:Record<string,unknown>={...existingBeforeRest,...restPatch,detailVersion:DETAIL_REPORT_VERSION,skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION,detailStage:3,detailComplete:true};
      await saveDetail(restStored);
      await markTimingDone();
      const restAnalysis=finalAnalysisSchema.parse(restStored);
      return respond({detail:{analysis:restAnalysis,stageReady:3,complete:true,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
    }

    if(!currentVersion||currentStage<body.stage-1){
      return respond({error:'DETAIL_STAGE_NOT_READY',details:`이전 페이지 생성이 먼저 필요해요. 현재 준비 단계: ${currentStage}`},409);
    }

    const dossier=rawDetail._detailDossier;
    if(!dossier)return respond({error:'DETAIL_DOSSIER_MISSING'},409);
    const continuationStage=body.stage as 2|3;
    const patch=await withAiUsageContext({shareCode,stage:`detail_stage_${continuationStage}`},()=>generatePaidDetailContinuation(bundle.seed,dossier,continuationStage));
    const {_detailDossier:ignoredDossier,...existingWithoutDossier}=rawDetail;
    void ignoredDossier;
    const storedAnalysis:Record<string,unknown>={...existingWithoutDossier,...patch,detailVersion:DETAIL_REPORT_VERSION,skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION,detailStage:continuationStage,detailComplete:continuationStage===3,...(continuationStage<3?{_detailDossier:dossier}:{})};
    await saveDetail(storedAnalysis);
    await markTimingDone();
    const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
    return respond({detail:{analysis:publicAnalysis,stageReady:continuationStage,complete:continuationStage===3,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
  }catch(error){
    const response=apiError(error);
    if(issuedCookie){response.cookies.set(detailViewCookieName(issuedCookie.shareCode),issuedCookie.token,detailViewCookieOptions());}
    return response;
  }
}

const deleteSchema=z.object({editToken:z.string().min(16)});
export async function DELETE(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    const body=deleteSchema.parse(await request.json());
    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_delete_character',{p_share_code:shareCode,p_edit_token:body.editToken});
    if(error)throw error;
    if(data!==true)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
    const response=NextResponse.json({ok:true});
    response.cookies.delete(detailViewCookieName(shareCode));
    return response;
  }catch(error){return apiError(error)}
}
