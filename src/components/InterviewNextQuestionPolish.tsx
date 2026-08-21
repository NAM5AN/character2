'use client';

import { useEffect } from 'react';

const NEXT_LABEL = '다음 질문';

function currentQuestionOrder(){
  return document.querySelector<HTMLElement>('.question-card .q-meta span:first-child')?.textContent?.trim() || '';
}

function normalizeNextLabel(){
  document.querySelectorAll<HTMLButtonElement>('.question-card .actions .btn.primary').forEach(button=>{
    if(button.textContent?.trim()==='답변하고 다음 질문')button.textContent=NEXT_LABEL;
  });
}

export function InterviewNextQuestionPolish(){
  useEffect(()=>{
    let pendingOrder='';
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');

    const sync=()=>{
      normalizeNextLabel();
      if(!pendingOrder)return;
      const nextOrder=currentQuestionOrder();
      if(!nextOrder||nextOrder===pendingOrder)return;
      pendingOrder='';
      window.requestAnimationFrame(()=>{
        window.scrollTo({top:0,behavior:reducedMotion.matches?'auto':'smooth'});
      });
    };

    const onClick=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof Element))return;
      const button=target.closest<HTMLButtonElement>('.question-card .actions button');
      if(!button||button.disabled)return;
      const label=button.textContent?.trim();
      if(label===NEXT_LABEL||label==='답변하고 다음 질문'||label==='다음 질문 보기 →'){
        pendingOrder=currentQuestionOrder();
      }
    };

    document.addEventListener('click',onClick,true);
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    sync();

    return()=>{
      document.removeEventListener('click',onClick,true);
      observer.disconnect();
    };
  },[]);

  return null;
}
