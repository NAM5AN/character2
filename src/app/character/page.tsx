import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterReportPreviewSchema, type CharacterReportPreview } from '@/lib/character-report';
import { finalAnalysisSchema } from '@/lib/schemas/character';
import { CharacterReportClient } from '@/components/CharacterReportClient';
import type { CompletedDetailPayload } from '@/components/CompletedCharacterReportView';
import { detailViewCookieName } from '@/lib/detail-access';
import { normalizeStoredDetailParagraphGuides } from '@/lib/stored-detail-paragraph-guides';

async function lookupShareCode(name:string,ownerName:string):Promise<string|null>{
  const sb=getSupabaseServer();
  const {data,error}=await sb.rpc('character2_lookup_character',{p_name:name,p_owner_name:ownerName});
  if(error||!data||typeof data!=='object')return null;
  const raw=(data as Record<string,unknown>).shareCode;
  const code=typeof raw==='string'?normalizeShareCode(raw):'';
  return isShareCode(code)?code:null;
}

async function loadPreview(code:string):Promise<CharacterReportPreview|null>{
  const sb=getSupabaseServer();
  const {data,error}=await sb.rpc('character2_get_public_preview',{p_share_code:code});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
}

async function loadSavedDetail(code:string):Promise<CompletedDetailPayload|null>{
  const sb=getSupabaseServer();
  const {data,error}=await sb.rpc('character2_get_saved_detail_public',{p_share_code:code});
  if(error||!data||typeof data!=='object'||Array.isArray(data))return null;
  const record=data as Record<string,unknown>;
  const normalizedAnalysis=normalizeStoredDetailParagraphGuides(record.analysis);
  const analysis=finalAnalysisSchema.safeParse(normalizedAnalysis);
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

export default async function CharacterLookupPage({searchParams}:{searchParams:Promise<{name?:string;owner?:string}>}){
  const params=await searchParams;
  const name=(params.name||'').trim();
  const ownerName=(params.owner||'').trim();
  if(!name||!ownerName)notFound();

  const shareCode=await lookupShareCode(name,ownerName);
  if(!shareCode)notFound();

  const cookieStore=await cookies();
  const canResume=Boolean(cookieStore.get(detailViewCookieName(shareCode))?.value?.trim());
  const [preview,savedDetail]=await Promise.all([
    loadPreview(shareCode),
    loadSavedDetail(shareCode),
  ]);
  if(!preview)notFound();
  const completedDetail=savedDetail?{...savedDetail,canResume}:null;
  return <main className="container page"><CharacterReportClient preview={preview} completedDetail={completedDetail}/></main>;
}
