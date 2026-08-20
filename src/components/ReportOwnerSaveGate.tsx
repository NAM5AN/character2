'use client';

import { useEffect } from 'react';

const NOTICE_CLASS='owner-save-required-notice';
const LOCKED_CLASS='owner-save-required-locked';

function syncGate(){
  document.querySelectorAll<HTMLElement>('.save-character-panel').forEach(panel=>{
    const row=panel.querySelector<HTMLElement>('.save-character-row');
    if(!row)return;

    const saveButton=row.querySelector<HTMLButtonElement>('.btn.soft');
    const cta=document.querySelector<HTMLButtonElement>('.full-preview-cta');
    if(!saveButton||!cta)return;

    const saved=saveButton.textContent?.trim()==='저장 완료';
    const overlay=cta.parentElement;
    if(!overlay)return;

    let notice=overlay.querySelector<HTMLElement>(`.${NOTICE_CLASS}`);
    if(saved){
      notice?.remove();
      cta.classList.remove(LOCKED_CLASS);
      cta.removeAttribute('aria-describedby');
      // React owns the normal busy/disabled state. Only clear the lock when this
      // bridge was the thing that disabled it and the report is not already loading.
      if(cta.dataset.ownerSaveLocked==='1'&&!cta.textContent?.includes('작성하는 중'))cta.disabled=false;
      delete cta.dataset.ownerSaveLocked;
      return;
    }

    if(!notice){
      notice=document.createElement('div');
      notice.className=NOTICE_CLASS;
      notice.id='owner-save-required-notice';
      notice.textContent='상세 리포트를 열기 전에 위의 캐릭터 저장에서 오너명을 먼저 저장해주세요.';
      overlay.insertBefore(notice,cta);
    }
    cta.dataset.ownerSaveLocked='1';
    cta.classList.add(LOCKED_CLASS);
    cta.setAttribute('aria-describedby',notice.id);
    cta.disabled=true;
  });
}

export function ReportOwnerSaveGate(){
  useEffect(()=>{
    syncGate();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>{
        queued=false;
        syncGate();
      });
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','value']});
    return()=>observer.disconnect();
  },[]);

  return <style>{`
    .owner-save-required-notice {
      max-width: 520px;
      padding: 10px 14px;
      border: 1px solid color-mix(in srgb,var(--character-point, var(--accent)) 28%,var(--line));
      border-radius: 12px;
      background: color-mix(in srgb,var(--character-accent-soft, var(--accent-soft)) 78%,transparent);
      color: var(--ink);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.55;
      text-align: center;
      pointer-events: none;
    }
    .full-preview-cta.owner-save-required-locked {
      opacity: .48 !important;
      filter: saturate(.55);
      cursor: not-allowed !important;
      box-shadow: none !important;
    }
  `}</style>;
}
