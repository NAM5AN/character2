import { notFound, redirect } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';

async function lookupShareCode(name:string,ownerName:string):Promise<string|null>{
  const sb=getSupabaseServer();
  const {data,error}=await sb.rpc('character2_lookup_character',{p_name:name,p_owner_name:ownerName});
  if(error||!data||typeof data!=='object')return null;
  const raw=(data as Record<string,unknown>).shareCode;
  const code=typeof raw==='string'?normalizeShareCode(raw):'';
  return isShareCode(code)?code:null;
}

export default async function CharacterLookupPage({searchParams}:{searchParams:Promise<{name?:string;owner?:string}>}){
  const params=await searchParams;
  const name=(params.name||'').trim();
  const ownerName=(params.owner||'').trim();
  if(!name||!ownerName)notFound();

  const shareCode=await lookupShareCode(name,ownerName);
  if(!shareCode)notFound();

  // Name + owner lookup is only a resolver. Always move to the canonical share-code
  // report URL so refresh, saved-detail access and character-theme restoration all
  // use the exact same route and client behavior.
  redirect(`/character/${shareCode}`);
}
