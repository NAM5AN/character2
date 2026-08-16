import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterPassportSchema, type CharacterPassport } from '@/lib/schemas/character';
import { buildCharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';

async function loadPassport(rawCode:string):Promise<CharacterPassport|null>{
  const code = normalizeShareCode(rawCode);
  if (!isShareCode(code)) return null;
  const supabase = getSupabaseServer();
  const { data, error } = await supabase.rpc('character2_get_character', { p_share_code: code });
  if (error || !data) return null;
  const parsed = characterPassportSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export default async function CharacterPage({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const passport=await loadPassport(shareCode);
  if(!passport) notFound();
  const preview=buildCharacterReportPreview(passport);
  return <main className="container page"><CharacterReportView preview={preview}/></main>;
}
