'use client';
import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onValidated: (code: string) => void | Promise<void>;
  eyebrow?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
};

export function AccessCodeModal({
  open,
  onClose,
  onValidated,
  eyebrow = 'AI access code',
  title = 'AI 이용 코드가 필요해요',
  description = '포스타입 유료 영역에서 최신 코드를 확인한 뒤 입력해주세요. 한 번 입력한 코드는 이 브라우저에 저장됩니다.',
  submitLabel = '확인하고 계속',
}: Props) {
  const [code,setCode]=useState('');
  const [postype,setPostype]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){ fetch('/api/access/validate').then(r=>r.json()).then(x=>setPostype(x.postypeUrl||'')).catch(()=>{}); setCode(localStorage.getItem('chara_ai_access_code')||''); setError(''); }},[open]);
  if(!open) return null;
  async function validate(){
    setBusy(true); setError('');
    try{
      const r=await fetch('/api/access/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
      if(!r.ok){ localStorage.removeItem('chara_ai_access_code'); setError('현재 이용 코드와 일치하지 않아요. 포스타입에서 최신 코드를 확인해주세요.'); return; }
      const normalized=code.trim();
      localStorage.setItem('chara_ai_access_code',normalized);
      await onValidated(normalized);
      onClose();
    }finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <div className="modal" role="dialog" aria-modal="true" aria-busy={busy}>
      <div className="eyebrow">{eyebrow}</div><h3>{title}</h3>
      <p>{description}</p>
      <div className="notice" style={{margin:'14px 0',lineHeight:1.7}}>
        <strong>상세 이용권 3,000원 · 캐릭터 수 제한 없음</strong><br/>
        구매자 본인 이용을 전제로 합니다. 코드 공유·타인 이용이 의심되는 경우 이용 코드는 예고 없이 교체될 수 있으며, 교체 후에는 포스타입 유료 영역에서 최신 코드를 다시 확인해주세요.
      </div>
      {postype && <p><a className="btn soft" href={postype} target="_blank" rel="noreferrer">포스타입에서 코드 확인하기 ↗</a></p>}
      <div className="field"><label className="label">이용 코드</label><input disabled={busy} className="input" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!busy)validate()}} placeholder="예: CHARA82" /></div>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button className="btn primary" disabled={busy||!code.trim()} onClick={validate}>{busy?'확인 중…':submitLabel}</button><button className="btn" disabled={busy} onClick={onClose}>닫기</button></div>
    </div>
  </div>;
}
