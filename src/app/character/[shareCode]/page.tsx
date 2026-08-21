import type { Metadata } from 'next';
import { cache } from 'react';
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

const SITE_ORIGIN='https://www.cha-lab.com';
const DEFAULT_TITLE='CHA LAB ㅡ 캐릭터 정밀 해석';
const DEFAULT_DESCRIPTION='나도 몰랐던 내 캐릭터의 심리';

function compactMetadataText(value:string,max=170){
  const normalized=value.replace(/\s+/gu,' ').trim();
  if(normalized.length<=max)return normalized;
  return `${normalized.slice(0,max-1).trimEnd()}…`;
}

const loadPreview=cache(async(rawCode:string):Promise<CharacterReportPreview|null>=>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_public_preview',{p_share_code:code});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
});

async function loadSavedDetail(rawCode:string):Promise<CompletedDetailPayload|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_saved_detail_public',{p_share_code:code});
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

export async function generateMetadata({params}:{params:Promise<{shareCode:string}>}):Promise<Metadata>{
  const {shareCode}=await params;
  const normalized=normalizeShareCode(shareCode);
  const preview=await loadPreview(normalized);
  if(!preview){
    return {title:DEFAULT_TITLE,description:DEFAULT_DESCRIPTION};
  }

  const title=`${preview.name} 정밀 해석 | CHA LAB`;
  const description=compactMetadataText(preview.oneLineSummary||DEFAULT_DESCRIPTION);
  const canonical=`${SITE_ORIGIN}/character/${preview.shareCode}`;
  const imageUrl=`${canonical}/opengraph-image`;

  return {
    title,
    description,
    alternates:{canonical},
    openGraph:{
      type:'website',
      locale:'ko_KR',
      siteName:'CHA LAB',
      url:canonical,
      title,
      description,
      images:[{url:imageUrl,width:1200,height:630,alt:`${preview.name} 캐릭터 정밀 해석`}],
    },
    twitter:{
      card:'summary_large_image',
      title,
      description,
      images:[imageUrl],
    },
  };
}

export default async function CharacterPage({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const normalized=normalizeShareCode(shareCode);
  const cookieStore=await cookies();
  const canResume=isShareCode(normalized)&&Boolean(
    cookieStore.get(detailViewCookieName(normalized))?.value?.trim(),
  );
  const [preview,savedDetail]=await Promise.all([
    loadPreview(normalized),
    loadSavedDetail(normalized),
  ]);
  if(!preview)notFound();
  const completedDetail=savedDetail?{...savedDetail,canResume}:null;
  return <main className="container page"><CharacterReportClient preview={preview} completedDetail={completedDetail}/></main>;
}
