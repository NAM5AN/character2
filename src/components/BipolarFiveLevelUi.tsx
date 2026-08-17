'use client';

import { useEffect } from 'react';

const LEVEL_VALUES = [0, 25, 50, 75, 100] as const;

type ManagedScale = HTMLElement & {
  __fiveLevelRange?: HTMLInputElement;
  __fiveLevelSync?: EventListener;
};

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

function currentQuestionKey(control:HTMLElement,left:string,right:string){
  const card=control.closest('.question-card');
  const order=card?.querySelector<HTMLElement>('.q-meta span:first-child')?.textContent?.trim()||'';
  const title=card?.querySelector<HTMLElement>('.q-title')?.textContent?.trim()||'';
  return `${order}|${title}|${left}|${right}`;
}

function syncControl(control:HTMLElement,range:HTMLInputElement,scale:HTMLElement){
  const active=nearestLevel(Number(range.value||50));
  const hasReactSelection=Boolean(control.querySelector('.bipolar-current'));
  const touched=hasReactSelection||control.dataset.fiveLevelTouched==='1';
  scale.querySelectorAll<HTMLButtonElement>('.five-level-choice').forEach(button=>{
    const checked=Number(button.dataset.value)===active&&touched;
    button.classList.toggle('selected',checked);
    button.setAttribute('aria-checked',checked?'true':'false');
  });
}

function refreshLabels(scale:HTMLElement,left:string,right:string){
  const groupLabel=`${left}와 ${right} 사이의 5단계 선택`;
  if(scale.getAttribute('aria-label')!==groupLabel)scale.setAttribute('aria-label',groupLabel);
  scale.querySelectorAll<HTMLButtonElement>('.five-level-choice').forEach((button,index)=>{
    const label=levelLabel(index,left,right);
    if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
    const caption=button.querySelector<HTMLElement>('.five-level-label');
    if(caption&&caption.textContent!==label)caption.textContent=label;
  });
}

function bindRange(control:HTMLElement,range:HTMLInputElement,scale:ManagedScale){
  if(scale.__fiveLevelRange===range)return;
  if(scale.__fiveLevelRange&&scale.__fiveLevelSync){
    scale.__fiveLevelRange.removeEventListener('input',scale.__fiveLevelSync);
    scale.__fiveLevelRange.removeEventListener('change',scale.__fiveLevelSync);
  }
  const sync:EventListener=()=>syncControl(control,range,scale);
  range.addEventListener('input',sync);
  range.addEventListener('change',sync);
  scale.__fiveLevelRange=range;
  scale.__fiveLevelSync=sync;
}

function createScale(control:HTMLElement){
  const scale=document.createElement('div') as ManagedScale;
  scale.className='five-level-scale';
  scale.setAttribute('role','radiogroup');

  LEVEL_VALUES.forEach((value,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className=`five-level-choice level-${index+1}`;
    button.dataset.value=String(value);
    button.setAttribute('role','radio');
    button.setAttribute('aria-checked','false');

    const circle=document.createElement('span');
    circle.className='five-level-circle';
    circle.setAttribute('aria-hidden','true');
    const caption=document.createElement('span');
    caption.className='five-level-label';
    button.append(circle,caption);

    button.addEventListener('click',()=>{
      const currentControl=button.closest('.bipolar-control') as HTMLElement|null;
      const currentRange=currentControl?.querySelector<HTMLInputElement>('.bipolar-range');
      if(!currentControl||!currentRange)return;
      currentControl.dataset.fiveLevelTouched='1';
      try{currentRange.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}catch{currentRange.dispatchEvent(new Event('pointerdown',{bubbles:true}))}
      currentRange.value=String(value);
      currentRange.dispatchEvent(new Event('input',{bubbles:true}));
      currentRange.dispatchEvent(new Event('change',{bubbles:true}));
      syncControl(currentControl,currentRange,scale);
    });
    scale.appendChild(button);
  });

  control.appendChild(scale);
  return scale;
}

function removeStaleScales(){
  document.querySelectorAll<ManagedScale>('.five-level-scale').forEach(scale=>{
    const parent=scale.parentElement;
    const valid=Boolean(
      parent?.classList.contains('bipolar-control')&&
      parent.querySelector<HTMLInputElement>('.bipolar-range'),
    );
    if(valid)return;
    if(scale.__fiveLevelRange&&scale.__fiveLevelSync){
      scale.__fiveLevelRange.removeEventListener('input',scale.__fiveLevelSync);
      scale.__fiveLevelRange.removeEventListener('change',scale.__fiveLevelSync);
    }
    scale.remove();
  });
}

export function BipolarFiveLevelUi(){
  useEffect(()=>{
    const enhance=()=>{
      removeStaleScales();
      document.querySelectorAll<HTMLElement>('.bipolar-control').forEach(control=>{
        const range=control.querySelector<HTMLInputElement>('.bipolar-range');
        if(!range)return;

        const labels=control.querySelectorAll<HTMLElement>('.bipolar-labels strong');
        const left=labels[0]?.textContent?.trim()||'첫 번째 선택';
        const right=labels[1]?.textContent?.trim()||'두 번째 선택';
        const nextQuestionKey=currentQuestionKey(control,left,right);
        const questionChanged=control.dataset.fiveLevelQuestionKey!==nextQuestionKey;

        let scale=control.querySelector<ManagedScale>(':scope > .five-level-scale');
        if(!scale)scale=createScale(control);

        if(questionChanged){
          control.dataset.fiveLevelQuestionKey=nextQuestionKey;
          control.dataset.fiveLevelTouched=control.querySelector('.bipolar-current')?'1':'0';
        }

        refreshLabels(scale,left,right);
        bindRange(control,range,scale);
        syncControl(control,range,scale);
      });
    };

    enhance();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>{
        queued=false;
        enhance();
      });
    });
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      observer.disconnect();
      removeStaleScales();
    };
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
      .bipolar-control { padding:18px 14px 16px; }
      .bipolar-control .bipolar-labels { display:none; }
      .five-level-scale {
        display:flex;
        flex-direction:column;
        align-items:stretch;
        gap:4px;
        position:relative;
        margin-top:0;
        padding:2px 0;
      }
      .five-level-scale::before {
        content:'';
        position:absolute;
        left:23px;
        top:25px;
        bottom:25px;
        width:2px;
        background:var(--line);
        border-radius:999px;
        pointer-events:none;
      }
      .five-level-choice {
        width:100%;
        min-height:58px;
        display:grid;
        grid-template-columns:48px minmax(0,1fr);
        align-items:center;
        gap:14px;
        padding:4px 2px;
        text-align:left;
        border-radius:12px;
      }
      .five-level-choice:hover { background:rgba(255,255,255,.35); }
      .five-level-circle,
      .five-level-choice.level-2 .five-level-circle,
      .five-level-choice.level-3 .five-level-circle,
      .five-level-choice.level-4 .five-level-circle {
        position:relative;
        z-index:1;
        margin:0 auto;
      }
      .five-level-circle { width:44px;height:44px;border-width:2px; }
      .five-level-choice.level-2 .five-level-circle,
      .five-level-choice.level-4 .five-level-circle { width:37px;height:37px; }
      .five-level-choice.level-3 .five-level-circle { width:30px;height:30px; }
      .five-level-label {
        max-width:none;
        font-size:13px;
        line-height:1.45;
        text-align:left;
        color:var(--ink);
      }
    }
  `}</style>;
}
