'use client';
import { useEffect, useState } from 'react';

export function AccessCodeModal({ open, onClose, onValidated }: { open:boolean; onClose:()=>void; onValidated:(code:string)=>void }) {
  const [code,setCode]=useState('');
  const [postype,setPostype]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){ fetch('/api/access/validate').then(r=>r.json()).then(x=>setPostype(x.postypeUrl||'')).catch(()=>{}); setCode(localStorage.getItem('chara_ai_access_code')||''); }},[open]);
  if(!open) return null;
  async function validate(){
    setBusy(true); setError('');
    try{
      const r=await fetch('/api/access/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
      if(!r.ok){ localStorage.removeItem('chara_ai_access_code'); setError('현재 이용 코드와 일치하지 않아요. 포스타입에서 최신 코드를 확인해주세요.'); return; }
      localStorage.setItem('chara_ai_access_code',code.trim()); onValidated(code.trim()); onClose();
    }finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="modal">
      <div className="eyebrow">AI access code</div><h3>AI 이용 코드가 필요해요</h3>
      <p>포스타입 유료 영역에서 최신 코드를 확인한 뒤 입력해주세요. 한 번 입력한 코드는 이 브라우저에 저장됩니다.</p>
      {postype && <p><a className="btn soft" href={postype} target="_blank" rel="noreferrer">포스타입에서 코드 확인하기 ↗</a></p>}
      <div className="field"><label className="label">이용 코드</label><input className="input" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')validate()}} placeholder="예: CHARA82" /></div>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button className="btn primary" disabled={busy||!code.trim()} onClick={validate}>{busy?'확인 중…':'확인하고 계속'}</button><button className="btn" onClick={onClose}>닫기</button></div>
    </div>
  </div>
}
