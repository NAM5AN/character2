import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterReportPreviewSchema, type CharacterReportPreview } from '@/lib/character-report';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { CharacterReportClient } from '@/components/CharacterReportClient';
import type { CompletedDetailPayload } from '@/components/CompletedCharacterReportView';

async function loadPreview(rawCode:string):Promise<CharacterReportPreview|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_public_preview',{p_share_code:code});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
}

async function loadSavedDetail(rawCode:string):Promise<CompletedDetailPayload|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_saved_detail',{p_share_code:code});
  if(error||!data||typeof data!=='object'||Array.isArray(data))return null;
  const record=data as Record<string,unknown>;
  const analysis=finalAnalysisSchema.safeParse(record.analysis);
  if(!analysis.success)return null;
  const rawStage=Number(record.stageReady)||1;
  const stageReady=Math.max(1,Math.min(3,rawStage));
  const complete=record.complete===true||record.complete==='true'||stageReady>=3;
  return {
    analysis:analysis.data,
    confirmedFactCount:Number(record.confirmedFactCount)||0,
    inferenceCount:Number(record.inferenceCount)||0,
    cached:true,
    stageReady,
    complete,
  };
}

export default async function CharacterPage({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const [preview,savedDetail]=await Promise.all([loadPreview(shareCode),loadSavedDetail(shareCode)]);
  if(!preview)notFound();
  return <main className="container page"><CharacterReportClient preview={preview} completedDetail={savedDetail}/></main>;
}
