import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { assertRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/http';
import {
  DETAIL_REPORT_VERSION,
  generatePaidDetailContinuation,
} from '@/lib/ai/detail-report';
import { CHARACTER_DEEP_ANALYSIS_SKILL_VERSION } from '@/lib/ai/character-deep-analysis-skill';
import { withAiUsageContext } from '@/lib/ai/usage';
import { detailViewCookieName } from '@/lib/detail-access';

const requestSchema=z.object({stage:z.coerce.number().int().min(2).max(3)});
const bundleSchema=z.object({
  seed:z.unknown(),
  detail:z.unknown(),
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
  if(typeof raw.detailedReport==='string'&&raw.detailedReport.trim())return 3;
  return 0;
}

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    await assertRateLimit('character_detail_resume',8,60);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});
    const body=requestSchema.parse(await request.json());
    const cookieStore=await cookies();
    const detailViewToken=cookieStore.get(detailViewCookieName(shareCode))?.value?.trim()||'';
    if(!detailViewToken)return NextResponse.json({error:'DETAIL_ACCESS_DENIED'},{status:403});

    const sb=getSupabaseServer();
    const {data,error}=await sb.rpc('character2_get_entitled_detail_bundle',{
      p_share_code:shareCode,
      p_detail_view_token:detailViewToken,
      p_edit_token:'',
    });
    if(error)throw error;
    if(!data)return NextResponse.json({error:'DETAIL_ACCESS_DENIED'},{status:403});
    const bundle=bundleSchema.parse(data);
    const rawDetail=record(bundle.detail);
    const currentStage=storedDetailStage(rawDetail);
    const parsedExisting=finalAnalysisSchema.safeParse(rawDetail);

    if(parsedExisting.success&&currentStage>=body.stage){
      return NextResponse.json({detail:{
        analysis:parsedExisting.data,
        stageReady:currentStage,
        complete:currentStage>=3,
        confirmedFactCount:bundle.confirmedFactCount,
        inferenceCount:bundle.inferenceCount,
        cached:true,
      }});
    }
    if(currentStage<body.stage-1){
      return NextResponse.json({error:'DETAIL_STAGE_NOT_READY'},{status:409});
    }

    const dossier=rawDetail._detailDossier;
    if(!dossier)return NextResponse.json({error:'DETAIL_DOSSIER_MISSING'},{status:409});

    const continuationStage=body.stage as 2|3;
    const patch=await withAiUsageContext(
      {shareCode,stage:`detail_resume_${continuationStage}`},
      ()=>generatePaidDetailContinuation(bundle.seed,dossier,continuationStage),
    );
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

    const {data:saved,error:saveError}=await sb.rpc('character2_save_entitled_detail',{
      p_share_code:shareCode,
      p_detail_view_token:detailViewToken,
      p_edit_token:'',
      p_detail_json:storedAnalysis,
    });
    if(saveError)throw saveError;
    if(saved!==true)throw new Error('DETAIL_SAVE_FAILED');

    const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
    return NextResponse.json({detail:{
      analysis:publicAnalysis,
      stageReady:continuationStage,
      complete:continuationStage===3,
      confirmedFactCount:bundle.confirmedFactCount,
      inferenceCount:bundle.inferenceCount,
      cached:false,
    }});
  }catch(error){return apiError(error)}
}
