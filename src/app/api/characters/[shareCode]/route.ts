import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { characterReportPreviewSchema } from '@/lib/character-report';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import {
  DETAIL_REPORT_VERSION,
  generatePaidDetailContinuation,
  generatePaidDetailStage1,
} from '@/lib/ai/detail-report';
import { withAiUsageContext } from '@/lib/ai/usage';
import { CHARACTER_DEEP_ANALYSIS_SKILL_VERSION } from '@/lib/ai/character-deep-analysis-skill';
import { apiError } from '@/lib/http';

const detailBundleSchema=z.object({
  seed:z.unknown().nullable().optional(),
  detail:z.unknown().nullable().optional(),
  legacyAnalysis:z.unknown().nullable().optional(),
  publicProfileText:z.string().optional().default(''),
  confirmedFactCount:z.coerce.number().int().nonnegative().default(0),
  inferenceCount:z.coerce.number().int().nonnegative().default(0),
});

function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}

function storedDetailStage(raw:Record<string,unknown>){
  const explicit=Number(raw.detailStage);
  if(explicit===1||explicit===2||explicit===3)return explicit;
  if(typeof raw.integratedReport==='string'&&raw.integratedReport.trim())return 3;
  if(typeof raw.relationshipStyle==='string'&&raw.relationshipStyle.trim())return 2;
  if(typeof raw.characterOverview==='string'&&raw.characterOverview.trim())return 1;
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
  accessCode:z.string().min(1),
  editToken:z.string().min(16).optional(),
  stage:z.coerce.number().int().min(1).max(3).optional().default(1),
});

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    await assertRateLimit('character_detail_unlock',12,60);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});
    const body=detailSchema.parse(await request.json());
    if(!(await validateAccessCode(body.accessCode)))throw new Error('CODE_INVALID');

    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_get_detail_bundle',{p_share_code:shareCode,p_access_code:body.accessCode.trim()});
    if(error)throw error;
    if(!data)return NextResponse.json({error:'CHARACTER_NOT_FOUND'},{status:404});
    const bundle=detailBundleSchema.parse(data);

    const rawDetail=record(bundle.detail);
    const parsedExisting=bundle.detail?finalAnalysisSchema.safeParse(bundle.detail):null;
    const currentVersion=Boolean(bundle.detail)&&
      rawDetail.detailVersion===DETAIL_REPORT_VERSION &&
      rawDetail.skillVersion===CHARACTER_DEEP_ANALYSIS_SKILL_VERSION;
    const currentStage=currentVersion?storedDetailStage(rawDetail):0;

    // 다른 사용자는 완성된 캐시만 읽습니다. 생성 도중의 내부 dossier는 노출하지 않습니다.
    if(bundle.detail&&!body.editToken){
      if(currentVersion&&currentStage<3){
        return NextResponse.json({error:'DETAIL_GENERATION_IN_PROGRESS',details:'생성자가 상세 리포트를 만드는 중이에요.'},{status:409});
      }
      if(parsedExisting?.success){
        return NextResponse.json({detail:{analysis:parsedExisting.data,stageReady:currentStage||3,complete:true,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true}});
      }
    }

    // 생성자 브라우저에서는 이미 준비된 페이지를 AI 호출 없이 즉시 돌려줍니다.
    if(currentVersion&&parsedExisting?.success&&currentStage>=body.stage){
      return NextResponse.json({detail:{analysis:parsedExisting.data,stageReady:currentStage,complete:currentStage>=3,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true}});
    }

    if(!bundle.seed&&bundle.legacyAnalysis){
      const legacy=finalAnalysisSchema.safeParse(bundle.legacyAnalysis);
      const hasReadableLegacy=legacy.success&&Boolean(
        (legacy.data.outerSelf?.trim()&&legacy.data.innerSelf?.trim()) || legacy.data.characterOverview?.trim()
      );
      if(legacy.success&&hasReadableLegacy){
        return NextResponse.json({detail:{analysis:legacy.data,stageReady:3,complete:true,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true,legacy:true}});
      }
    }
    if(!bundle.seed)return NextResponse.json({error:'DETAIL_SOURCE_NOT_AVAILABLE'},{status:409});
    if(!body.editToken)return NextResponse.json({error:'DETAIL_OWNER_SOURCE_REQUIRED'},{status:409});

    const saveDetail=async(storedAnalysis:Record<string,unknown>)=>{
      const {data:saved,error:saveError}=await sb.rpc('character2_save_detail',{
        p_share_code:shareCode,p_access_code:body.accessCode.trim(),p_detail_json:storedAnalysis,
      });
      if(saveError)throw saveError;
      if(saved!==true)throw new Error('DETAIL_SAVE_FAILED');
    };

    if(body.stage===1){
      const seedRecord=record(bundle.seed);
      const needsRawSource=seedRecord.version==='detail-seed/2.0';
      let privateSource:unknown=undefined;
      if(needsRawSource){
        const {data:source,error:sourceError}=await sb.rpc('character2_get_detail_source',{
          p_share_code:shareCode,p_access_code:body.accessCode.trim(),p_edit_token:body.editToken,
        });
        if(sourceError)throw sourceError;
        if(!source)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
        privateSource=source;
      }

      const generated=await withAiUsageContext({shareCode,stage:'detail_stage_1'},()=>generatePaidDetailStage1(bundle.seed,bundle.publicProfileText,privateSource));
      const storedAnalysis:Record<string,unknown>={
        ...generated.analysis,
        detailVersion:DETAIL_REPORT_VERSION,
        skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION,
        detailStage:1,
        detailComplete:false,
        _detailDossier:generated.dossier,
      };
      await saveDetail(storedAnalysis);
      const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
      return NextResponse.json({detail:{analysis:publicAnalysis,stageReady:1,complete:false,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
    }

    if(!currentVersion||currentStage<body.stage-1){
      return NextResponse.json({error:'DETAIL_STAGE_NOT_READY',details:`이전 페이지 생성이 먼저 필요해요. 현재 준비 단계: ${currentStage}`},{status:409});
    }

    const dossier=rawDetail._detailDossier;
    if(!dossier)return NextResponse.json({error:'DETAIL_DOSSIER_MISSING'},{status:409});
    const continuationStage=body.stage as 2|3;
    const patch=await withAiUsageContext({shareCode,stage:`detail_stage_${continuationStage}`},()=>generatePaidDetailContinuation(bundle.seed,dossier,continuationStage));
    const {_detailDossier:ignoredDossier,...existingWithoutDossier}=rawDetail;
    void ignoredDossier;
    const storedAnalysis:Record<string,unknown>={
      ...existingWithoutDossier,
      ...patch,
      detailVersion:DETAIL_REPORT_VERSION,
      skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION,
      detailStage:continuationStage,
      detailComplete:continuationStage===3,
      ...(continuationStage<3?{_detailDossier:dossier}:{}),
    };
    await saveDetail(storedAnalysis);
    const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
    return NextResponse.json({detail:{analysis:publicAnalysis,stageReady:continuationStage,complete:continuationStage===3,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
  }catch(error){return apiError(error)}
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
    return NextResponse.json({ok:true});
  }catch(error){return apiError(error)}
}
