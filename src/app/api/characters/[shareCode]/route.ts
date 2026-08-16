import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { characterReportPreviewSchema } from '@/lib/character-report';
import { validateAccessCode } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { generatePaidDetail } from '@/lib/ai/detail-report';
import { apiError } from '@/lib/http';

const detailBundleSchema = z.object({
  seed: z.unknown().nullable().optional(),
  detail: z.unknown().nullable().optional(),
  legacyAnalysis: z.unknown().nullable().optional(),
  publicProfileText: z.string().optional().default(''),
  confirmedFactCount: z.coerce.number().int().nonnegative().default(0),
  inferenceCount: z.coerce.number().int().nonnegative().default(0),
});

async function loadPreview(rawCode:string){
  const shareCode=normalizeShareCode(rawCode);
  if(!isShareCode(shareCode)) return {shareCode,error:'INVALID_SHARE_CODE' as const,status:400 as const,preview:null};
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_public_preview',{p_share_code:shareCode});
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
  }catch(error){
    return apiError(error);
  }
}

const detailSchema=z.object({accessCode:z.string().min(1)});

export async function POST(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    await assertRateLimit('character_detail_unlock',12,60);
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    if(!isShareCode(shareCode))return NextResponse.json({error:'INVALID_SHARE_CODE'},{status:400});

    const body=detailSchema.parse(await request.json());
    if(!(await validateAccessCode(body.accessCode)))throw new Error('CODE_INVALID');

    const supabase=getSupabaseServer();
    const {data,error}=await supabase.rpc('character2_get_detail_bundle',{
      p_share_code:shareCode,
      p_access_code:body.accessCode.trim(),
    });
    if(error)throw error;
    if(!data)return NextResponse.json({error:'CHARACTER_NOT_FOUND'},{status:404});

    const bundle=detailBundleSchema.parse(data);

    if(bundle.detail){
      const analysis=finalAnalysisSchema.parse(bundle.detail);
      return NextResponse.json({detail:{analysis,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true}});
    }

    if(!bundle.seed && bundle.legacyAnalysis){
      const legacy=finalAnalysisSchema.safeParse(bundle.legacyAnalysis);
      if(legacy.success && legacy.data.outerSelf.trim() && legacy.data.innerSelf.trim()){
        return NextResponse.json({detail:{analysis:legacy.data,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:true,legacy:true}});
      }
    }

    if(!bundle.seed)return NextResponse.json({error:'DETAIL_SOURCE_NOT_AVAILABLE'},{status:409});

    const analysis=await generatePaidDetail(bundle.seed,bundle.publicProfileText);
    const {data:saved,error:saveError}=await supabase.rpc('character2_save_detail',{
      p_share_code:shareCode,
      p_access_code:body.accessCode.trim(),
      p_detail_json:analysis,
    });
    if(saveError)throw saveError;
    if(saved!==true)throw new Error('DETAIL_SAVE_FAILED');

    return NextResponse.json({detail:{analysis,confirmedFactCount:bundle.confirmedFactCount,inferenceCount:bundle.inferenceCount,cached:false}});
  }catch(error){
    return apiError(error);
  }
}

const deleteSchema=z.object({editToken:z.string().min(16)});

export async function DELETE(request:Request,context:{params:Promise<{shareCode:string}>}){
  try{
    const {shareCode:raw}=await context.params;
    const shareCode=normalizeShareCode(raw);
    const body=deleteSchema.parse(await request.json());
    const supabase=getSupabaseServer();
    const {data,error}=await supabase.rpc('character2_delete_character',{
      p_share_code:shareCode,
      p_edit_token:body.editToken,
    });
    if(error)throw error;
    if(data!==true)return NextResponse.json({error:'EDIT_TOKEN_INVALID'},{status:403});
    return NextResponse.json({ok:true});
  }catch(error){
    return apiError(error);
  }
}
