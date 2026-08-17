import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { characterReportPreviewSchema, type CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportClient } from '@/components/CharacterReportClient';

async function loadPreview(name:string,ownerName:string):Promise<CharacterReportPreview|null>{
  const sb=getSupabaseServer();
  const {data:lookup,error:lookupError}=await sb.rpc('character2_lookup_character',{p_name:name,p_owner_name:ownerName});
  if(lookupError||!lookup||typeof lookup!=='object')return null;
  const shareCode=typeof (lookup as Record<string,unknown>).shareCode==='string'?(lookup as Record<string,unknown>).shareCode as string:'';
  if(!shareCode)return null;
  const {data,error}=await sb.rpc('character2_get_public_preview',{p_share_code:shareCode});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
}

export default async function CharacterLookupPage({searchParams}:{searchParams:Promise<{name?:string;owner?:string}>}){
  const params=await searchParams;
  const name=(params.name||'').trim();
  const ownerName=(params.owner||'').trim();
  if(!name||!ownerName)notFound();
  const preview=await loadPreview(name,ownerName);
  if(!preview)notFound();
  return <main className="container page"><CharacterReportClient preview={preview}/></main>;
}
