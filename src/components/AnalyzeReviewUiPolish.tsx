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
    };

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  return null;
}
