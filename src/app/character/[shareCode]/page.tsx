import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import type { CharacterPassport } from '@/lib/schemas/character';

async function loadPassport(rawCode:string):Promise<CharacterPassport|null>{
  const code = normalizeShareCode(rawCode);
  if (!isShareCode(code)) return null;
  const supabase = getSupabaseAdmin();
  const { data: character, error } = await supabase.from('characters').select('id').eq('share_code', code).maybeSingle();
  if (error || !character) return null;
  const { data: row, error: pError } = await supabase.from('character_passports').select('passport_json').eq('character_id', character.id).maybeSingle();
  if (pError || !row) return null;
  return row.passport_json as CharacterPassport;
}

export default async function CharacterPage({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const passport=await loadPassport(shareCode);
  if(!passport) notFound();
  const a=passport.analysis;
  return <main className="container page">
    <div className="result-hero">
      <div><div className="eyebrow">Character Passport</div><h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{passport.basicProfile.name}</h1><p className="hero-copy" style={{fontSize:17}}>{a.oneLineSummary}</p></div>
      <div><div className="label">공유 코드</div><div className="share-code">{passport.shareCode}</div></div>
    </div>
    <div className="result-grid">
      <section className="result-block"><h3>겉으로 보이는 모습</h3><p>{a.outerSelf}</p></section>
      <section className="result-block"><h3>실제 내면</h3><p>{a.innerSelf}</p></section>
      <section className="result-block"><h3>갈등 방식</h3><p>{a.conflictStyle}</p></section>
      <section className="result-block"><h3>애정 표현</h3><p>{a.affectionStyle}</p></section>
      <section className="result-block"><h3>핵심 가치</h3><div className="tags">{a.coreValues.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
      <section className="result-block"><h3>핵심 욕망</h3><div className="tags">{a.desires.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
      <section className="result-block"><h3>두려워하는 것</h3><div className="tags">{a.fears.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
      <section className="result-block"><h3>쉽게 오해받는 부분</h3><p>{a.misunderstoodPoints.map(x=>`• ${x}`).join('\n')}</p></section>
      <section className="result-block"><h3>캐릭터의 모순</h3><p>{a.contradictions.map(x=>`• ${x}`).join('\n')}</p></section>
      <section className="result-block"><h3>AI가 발견한 흥미로운 지점</h3><p>{a.interestingPoints.map(x=>`• ${x}`).join('\n')}</p></section>
    </div>
    <section className="card" style={{marginTop:18}}><h3>확인된 설정과 AI 추론</h3><div className="two-col"><div><div className="label">프로필/답변에서 확인된 사실</div><p className="muted">{passport.confirmedFacts.length}개</p></div><div><div className="label">AI 추론</div><p className="muted">{passport.aiInferences.filter(x=>x.ownerVerdict!=='rejected').length}개 · 오너 검수 반영</p></div></div></section>
  </main>
}
