'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LookupForm() {
  const [code, setCode] = useState('');
  const router = useRouter();
  return (
    <form className="lookup" onSubmit={(e) => { e.preventDefault(); const c=code.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8); if(c.length===8) router.push(`/character/${c}`); }}>
      <input className="input" value={code} maxLength={8} placeholder="K7M4P2Q8" onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8))} />
      <button className="btn primary" type="submit">불러오기</button>
    </form>
  );
}
