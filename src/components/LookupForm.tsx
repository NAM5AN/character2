'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LookupForm() {
  const [name,setName]=useState('');
  const [ownerName,setOwnerName]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const router=useRouter();

  async function submit(){
    const character=name.replace(/\s+/g,' ').trim();
    const owner=ownerName.replace(/\s+/g,' ').trim();
    if(!character||!owner)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/characters/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:character,ownerName:owner})});
      const body=await response.json().catch(()=>({}));
      if(response.ok&&body?.admin){
        router.push('/admin/console');
        return;
      }
      if(!response.ok){
        setError(body?.error==='CHARACTER_NOT_FOUND'?'저장된 캐릭터를 찾지 못했어요. 캐릭터 이름과 오너명을 확인해주세요.':'캐릭터를 불러오지 못했어요.');
        return;
      }
      router.push(`/character?name=${encodeURIComponent(character)}&owner=${encodeURIComponent(owner)}`);
    }finally{setBusy(false)}
  }

  return <form onSubmit={e=>{e.preventDefault();void submit()}}>
    <div className="field" style={{marginTop:0}}><label className="label"><span className="label-text">캐릭터 이름</span><input className="input" value={name} maxLength={80} placeholder="예: 한서진" onChange={e=>setName(e.target.value)} /></label></div>
    <div className="field"><label className="label"><span className="label-text">오너명</span><input className="input" value={ownerName} maxLength={80} placeholder="저장할 때 입력한 오너명" onChange={e=>setOwnerName(e.target.value)} /></label></div>
    {error&&<p className="error">{error}</p>}
    <button className="btn primary" disabled={busy||!name.trim()||!ownerName.trim()} type="submit">{busy?'찾는 중…':'리포트 불러오기'}</button>
  </form>;
}
