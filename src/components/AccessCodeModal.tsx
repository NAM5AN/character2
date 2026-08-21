'use client';
import { useEffect, useRef, useState } from 'react';
import { useModalFocus } from '@/lib/use-modal-focus';

type Props = {
  open: boolean;
  onClose: () => void;
  onValidated: (code: string) => void | Promise<void>;
  eyebrow?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
};

function apiErrorText(_body:unknown,_status:number,fallback:string){
  return fallback;
}

export function AccessCodeModal({
  open,
  onClose,
  onValidated,
  eyebrow = '',
  title = '상세 이용 코드가 필요해요',
  description = '포스타입 유료 영역에서 최신 코드를 확인한 뒤 입력해주세요. 한 번 입력한 코드는 이 브라우저에 저장됩니다.',
  submitLabel = '확인하고 계속',
}: Props) {
  const [code,setCode]=useState('');
  const [postype,setPostype]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const dialogRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{ if(open){ fetch('/api/access/validate').then(r=>r.json()).then(x=>setPostype(x.postypeUrl||'')).catch(()=>{}); setCode(localStorage.getItem('chara_ai_access_code')||''); setError(''); }},[open]);
  // 열릴 때 포커스 이동 · Escape 닫기 · Tab 순환 · 닫힐 때 복귀
  useModalFocus(open,dialogRef,onClose);

  if(!open) return null;
  async function validate(){
    setBusy(true); setError('');
    try{
      const r=await fetch('/api/access/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok){
        localStorage.removeItem('chara_ai_access_code');
        setError(apiErrorText(body,r.status,'현재 이용 코드와 일치하지 않아요. 포스타입에서 최신 코드를 확인해주세요.'));
        return;
      }
      const normalized=code.trim();
      localStorage.setItem('chara_ai_access_code',normalized);
      onClose();
      await onValidated(normalized);
    }catch{
      setError('이용 코드를 확인하지 못했어요. 잠시 후 다시 시도해주세요.');
    }finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <div className="modal" role="dialog" aria-modal="true" aria-busy={busy} ref={dialogRef}>
      {eyebrow?<div className="eyebrow">{eyebrow}</div>:null}<h3>{title}</h3>
      <p>{description}</p>
      <div className="notice" style={{margin:'14px 0',lineHeight:1.7}}>
        <strong>
          상세 이용권 <del style={{opacity:.62,fontWeight:700}}>3,000원</del>{' '}
          <span style={{fontSize:'1.14em'}}>1,500원</span> · 캐릭터 수 제한 없음
        </strong><br/>
        <span style={{display:'inline-block',marginTop:6}}>
          현재는 샘플을 모으는 기간이라 할인 가격으로 운영하고 있어요. 충분한 샘플이 모인 뒤에는 별도 예고 없이 가격을 올릴 예정입니다.
        </span><br/>
        <span style={{display:'inline-block',marginTop:6}}>
          구매자 본인 이용을 전제로 합니다. 코드 공유·타인 이용이 의심되는 경우 이용 코드는 예고 없이 교체될 수 있으며, 교체 후에는 포스타입 유료 영역에서 최신 코드를 다시 확인해주세요.
        </span>
        <div style={{marginTop:14}}>
          <a
            className="btn soft"
            href={postype||undefined}
            target={postype?'_blank':undefined}
            rel={postype?'noreferrer':undefined}
            aria-disabled={!postype}
            style={{display:'inline-flex',opacity:postype?1:.72,pointerEvents:postype?'auto':'none'}}
          >포스타입에서 코드 확인하기 ↗</a>
        </div>
      </div>
      <div className="field"><label className="label"><span className="label-text">이용 코드</span><input disabled={busy} className="input" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!busy)validate()}} /></label></div>
      {error && <div className="error" style={{whiteSpace:'pre-wrap'}}>{error}</div>}
      <div className="actions"><button className="btn primary" disabled={busy||!code.trim()} onClick={validate}>{busy?'확인 중…':submitLabel}</button><button className="btn" disabled={busy} onClick={onClose}>닫기</button></div>
    </div>
  </div>;
}
