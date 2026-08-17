'use client';

import { useEffect } from 'react';

const LEVELS = [
  { value: 0, label: '이쪽이다' },
  { value: 25, label: '약간 이쪽인 편' },
  { value: 50, label: '보통이다' },
  { value: 75, label: '약간 저쪽인 편' },
  { value: 100, label: '저쪽이다' },
] as const;

function nearestLevel(value:number){
  return LEVELS.reduce((best,item)=>Math.abs(item.value-value)<Math.abs(best.value-value)?item:best,LEVELS[0]);
}

export function BipolarFiveLevelUi(){
  useEffect(()=>{
    const enhance=()=>{
      document.querySelectorAll<HTMLElement>('.bipolar-control').forEach(control=>{
        if(control.dataset.fiveLevelReady==='1')return;
        const range=control.querySelector<HTMLInputElement>('.bipolar-range');
        if(!range)return;
        control.dataset.fiveLevelReady='1';

        const labels=control.querySelectorAll<HTMLElement>('.bipolar-labels strong');
        const left=labels[0]?.textContent?.trim()||'왼쪽';
        const right=labels[1]?.textContent?.trim()||'오른쪽';

        const scale=document.createElement('div');
        scale.className='five-level-scale';
        scale.setAttribute('role','radiogroup');
        scale.setAttribute('aria-label',`${left}와 ${right} 사이의 5단계 선택`);

        const sync=()=>{
          const active=nearestLevel(Number(range.value||50)).value;
          scale.querySelectorAll<HTMLButtonElement>('.five-level-choice').forEach(button=>{
            const checked=Number(button.dataset.value)===active && control.dataset.fiveLevelTouched==='1';
            button.classList.toggle('selected',checked);
            button.setAttribute('aria-checked',checked?'true':'false');
          });
        };

        LEVELS.forEach((level,index)=>{
          const button=document.createElement('button');
          button.type='button';
          button.className=`five-level-choice level-${index+1}`;
          button.dataset.value=String(level.value);
          button.setAttribute('role','radio');
          button.setAttribute('aria-checked','false');
          button.setAttribute('aria-label',index===0?`${left} 쪽이다`:index===1?`${left} 쪽인 편`:index===2?'보통이다':index===3?`${right} 쪽인 편`:`${right} 쪽이다`);
          button.innerHTML=`<span class="five-level-circle" aria-hidden="true"></span><span class="five-level-label">${level.label}</span>`;
          button.addEventListener('click',()=>{
            control.dataset.fiveLevelTouched='1';
            try{range.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}catch{range.dispatchEvent(new Event('pointerdown',{bubbles:true}))}
            range.value=String(level.value);
            range.dispatchEvent(new Event('input',{bubbles:true}));
            range.dispatchEvent(new Event('change',{bubbles:true}));
            sync();
          });
          scale.appendChild(button);
        });

        range.addEventListener('input',sync);
        range.addEventListener('change',sync);
        control.appendChild(scale);
      });
    };

    enhance();
    const observer=new MutationObserver(enhance);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  return <style>{`
    .bipolar-control .bipolar-track,
    .bipolar-control .bipolar-hints,
    .bipolar-control .bipolar-current { display:none !important; }
    .five-level-scale {
      display:grid;
      grid-template-columns:repeat(5,minmax(0,1fr));
      align-items:start;
      gap:12px;
      margin-top:28px;
      padding:0 12px 4px;
    }
    .five-level-choice {
      appearance:none;
      border:0;
      background:transparent;
      color:var(--ink);
      padding:0;
      min-width:0;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:10px;
      font:inherit;
      cursor:pointer;
    }
    .five-level-circle {
      width:58px;
      height:58px;
      border:3px solid #77746f;
      border-radius:50%;
      background:var(--paper);
      display:block;
      transition:transform .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease;
    }
    .five-level-choice.level-2 .five-level-circle,
    .five-level-choice.level-4 .five-level-circle { width:48px;height:48px;margin-top:5px; }
    .five-level-choice.level-3 .five-level-circle { width:38px;height:38px;margin-top:10px; }
    .five-level-choice:hover .five-level-circle { border-color:var(--ink);transform:scale(1.05); }
    .five-level-choice.selected .five-level-circle {
      background:var(--ink);
      border-color:var(--ink);
      box-shadow:inset 0 0 0 7px var(--paper),0 0 0 2px var(--ink);
    }
    .five-level-label {
      font-size:12px;
      line-height:1.35;
      font-weight:800;
      text-align:center;
      color:var(--muted);
      word-break:keep-all;
    }
    .five-level-choice.selected .five-level-label { color:var(--ink); }
    .five-level-choice:focus-visible { outline:2px solid var(--ink);outline-offset:6px;border-radius:8px; }
    @media (max-width:640px){
      .five-level-scale { gap:5px;padding:0;margin-top:22px; }
      .five-level-circle { width:46px;height:46px;border-width:2px; }
      .five-level-choice.level-2 .five-level-circle,.five-level-choice.level-4 .five-level-circle { width:39px;height:39px;margin-top:3px; }
      .five-level-choice.level-3 .five-level-circle { width:32px;height:32px;margin-top:7px; }
      .five-level-label { font-size:10px; }
    }
  `}</style>;
}
