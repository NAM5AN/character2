'use client';

import { useEffect } from 'react';

const LEVEL_VALUES = [0, 25, 50, 75, 100] as const;

function nearestLevel(value:number){
  return LEVEL_VALUES.reduce((best,item)=>Math.abs(item-value)<Math.abs(best-value)?item:best,LEVEL_VALUES[0]);
}

function levelLabel(index:number,left:string,right:string){
  if(index===0)return left;
  if(index===1)return `‘${left}’에 조금 더 가까움`;
  if(index===2)return '두 경우가 비슷함';
  if(index===3)return `‘${right}’에 조금 더 가까움`;
  return right;
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
        const left=labels[0]?.textContent?.trim()||'첫 번째 선택';
        const right=labels[1]?.textContent?.trim()||'두 번째 선택';

        const scale=document.createElement('div');
        scale.className='five-level-scale';
        scale.setAttribute('role','radiogroup');
        scale.setAttribute('aria-label',`${left}와 ${right} 사이의 5단계 선택`);

        const sync=()=>{
          const active=nearestLevel(Number(range.value||50));
          scale.querySelectorAll<HTMLButtonElement>('.five-level-choice').forEach(button=>{
            const checked=Number(button.dataset.value)===active && control.dataset.fiveLevelTouched==='1';
            button.classList.toggle('selected',checked);
            button.setAttribute('aria-checked',checked?'true':'false');
          });
        };

        LEVEL_VALUES.forEach((value,index)=>{
          const label=levelLabel(index,left,right);
          const button=document.createElement('button');
          button.type='button';
          button.className=`five-level-choice level-${index+1}`;
          button.dataset.value=String(value);
          button.setAttribute('role','radio');
          button.setAttribute('aria-checked','false');
          button.setAttribute('aria-label',label);

          const circle=document.createElement('span');
          circle.className='five-level-circle';
          circle.setAttribute('aria-hidden','true');
          const caption=document.createElement('span');
          caption.className='five-level-label';
          caption.textContent=label;
          button.append(circle,caption);

          button.addEventListener('click',()=>{
            control.dataset.fiveLevelTouched='1';
            try{range.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}catch{range.dispatchEvent(new Event('pointerdown',{bubbles:true}))}
            range.value=String(value);
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
      flex:0 0 auto;
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
      line-height:1.4;
      font-weight:800;
      text-align:center;
      color:var(--muted);
      word-break:keep-all;
      max-width:190px;
    }
    .five-level-choice.selected .five-level-label { color:var(--ink); }
    .five-level-choice:focus-visible { outline:2px solid var(--ink);outline-offset:6px;border-radius:8px; }
    @media (max-width:640px){
      .five-level-scale { gap:5px;padding:0;margin-top:22px; }
      .five-level-circle { width:46px;height:46px;border-width:2px; }
      .five-level-choice.level-2 .five-level-circle,.five-level-choice.level-4 .five-level-circle { width:39px;height:39px;margin-top:3px; }
      .five-level-choice.level-3 .five-level-circle { width:32px;height:32px;margin-top:7px; }
      .five-level-label { font-size:10px;line-height:1.35; }
    }
  `}</style>;
}
