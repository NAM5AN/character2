import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterReportPreviewSchema, type CharacterReportPreview } from '@/lib/character-report';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { CharacterReportClient } from '@/components/CharacterReportClient';
import type { CompletedDetailPayload } from '@/components/CompletedCharacterReportView';
import { detailViewCookieName } from '@/lib/detail-access';

async function loadPreview(rawCode:string):Promise<CharacterReportPreview|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_public_preview',{p_share_code:code});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
}

async function loadSavedDetail(rawCode:string,detailViewToken:string):Promise<CompletedDetailPayload|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code)||!detailViewToken)return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_entitled_detail_bundle',{
    p_share_code:code,
    p_detail_view_token:detailViewToken,
    p_edit_token:'',
  });
  if(error||!data||typeof data!=='object'||Array.isArray(data))return null;
  const record=data as Record<string,unknown>;
  const analysis=finalAnalysisSchema.safeParse(record.detail);
  if(!analysis.success)return null;
  const rawDetail=record.detail&&typeof record.detail==='object'&&!Array.isArray(record.detail)
    ?record.detail as Record<string,unknown>
    :{};
  const explicitStage=Number(rawDetail.detailStage);
  const inferredStage=typeof rawDetail.integratedReport==='string'&&rawDetail.integratedReport.trim()?3:
    typeof rawDetail.relationshipStyle==='string'&&rawDetail.relationshipStyle.trim()?2:
    typeof rawDetail.characterOverview==='string'&&rawDetail.characterOverview.trim()?1:
    typeof rawDetail.detailedReport==='string'&&rawDetail.detailedReport.trim()?3:1;
  const stageReady=Math.max(1,Math.min(3,explicitStage||inferredStage));
  return {
    analysis:analysis.data,
    confirmedFactCount:Number(record.confirmedFactCount)||0,
    inferenceCount:Number(record.inferenceCount)||0,
    cached:true,
    stageReady,
    complete:stageReady>=3,
  };
}

export default async function CharacterPage({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const normalized=normalizeShareCode(shareCode);
  const cookieStore=await cookies();
  const detailViewToken=isShareCode(normalized)
    ?cookieStore.get(detailViewCookieName(normalized))?.value?.trim()||''
    :'';
  const [preview,savedDetail]=await Promise.all([
    loadPreview(normalized),
    loadSavedDetail(normalized,detailViewToken),
  ]);
  if(!preview)notFound();
  return <main className="container page"><CharacterReportClient preview={preview} completedDetail={savedDetail}/></main>;
}
