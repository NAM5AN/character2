import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { characterReportPreviewSchema } from '@/lib/character-report';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { DETAIL_REPORT_VERSION, generatePaidDetail } from '@/lib/ai/detail-report';
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

const detailSchema=z.object({accessCode:z.string().min(1),editToken:z.string().min(16).optional()});

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

    if(bundle.detail){
      const rawDetail=record(bundle.detail);
      const currentVersion=
        rawDetail.detailVersion===DETAIL_REPORT_VERSION &&
        rawDetail.skillVersion===CHARACTER_DEEP_ANALYSIS_SKILL_VERSION;
      // 공유 코드로 보는 사람은 기존 캐시를 그대로 사용합니다. 캐릭터 생성 브라우저에서만
      // 엔진 또는 분석 스킬 버전이 바뀐 상세 리포트를 한 번 갱신합니다.
      if(currentVersion||!body.editToken){
        const analysis=finalAnalysisSchema.parse(bundle.detail);
        return NextResponse.json({detail:{analysis,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true}});
      }
    }

    if(!bundle.seed&&bundle.legacyAnalysis){
      const legacy=finalAnalysisSchema.safeParse(bundle.legacyAnalysis);
      const hasReadableLegacy=legacy.success&&Boolean(
        (legacy.data.outerSelf?.trim()&&legacy.data.innerSelf?.trim()) || legacy.data.characterOverview?.trim()
      );
      if(legacy.success&&hasReadableLegacy){
        return NextResponse.json({detail:{analysis:legacy.data,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true,legacy:true}});
      }
    }
    if(!bundle.seed)return NextResponse.json({error:'DETAIL_SOURCE_NOT_AVAILABLE'},{status:409});

    const seedRecord=record(bundle.seed);
    const needsRawSource=seedRecord.version==='detail-seed/2.0';
    let privateSource:unknown=undefined;
    if(needsRawSource){
      if(!body.editToken)return NextResponse.json({error:'DETAIL_OWNER_SOURCE_REQUIRED'},{status:409});
      const {data:source,error:sourceError}=await sb.rpc('character2_get_detail_source',{
        p_share_code:shareCode,p_access_code:body.accessCode.trim(),p_edit_token:body.editToken,
      });
      if(sourceError)throw sourceError;
      if(!source)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
      privateSource=source;
    }

    const analysis=await generatePaidDetail(bundle.seed,bundle.publicProfileText,privateSource);
    const storedAnalysis={...analysis,skillVersion:CHARACTER_DEEP_ANALYSIS_SKILL_VERSION};
    const {data:saved,error:saveError}=await sb.rpc('character2_save_detail',{
      p_share_code:shareCode,p_access_code:body.accessCode.trim(),p_detail_json:storedAnalysis,
    });
    if(saveError)throw saveError;
    if(saved!==true)throw new Error('DETAIL_SAVE_FAILED');
    const publicAnalysis=finalAnalysisSchema.parse(storedAnalysis);
    return NextResponse.json({detail:{analysis:publicAnalysis,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
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
