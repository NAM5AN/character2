'use client';

import { useEffect } from 'react';

export function AnalyzeReviewUiPolish(){
  useEffect(()=>{
    const apply=()=>{
      const heading=document.querySelector<HTMLElement>('.stack > .card:first-child h2');
      const text=heading?.textContent||'';
      if(heading&&/(을|를) 이렇게 이해했어요\.$/u.test(text)){
        heading.textContent=text.replace(/(을|를) 이렇게 이해했어요\.$/u,'를 좀 더 이해해볼게요.');
      }

      document.querySelectorAll<HTMLElement>('button, .loading').forEach(element=>{
        const label=element.textContent?.replace(/\s+/gu,' ').trim()||'';
        if(label==='첫 5문항 준비 중…'||label.startsWith('첫 5문항을 준비하고 있어요')){
          element.textContent='인터뷰 준비 중…';
        }
      });
    };

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);

  return null;
}
