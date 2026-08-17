'use client';

import { useEffect } from 'react';

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구만 다듬습니다.
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
        if(label.startsWith('캐릭터 요약을 정리하고 있어요')){
          element.textContent='캐릭터의 답변을 살펴보고 있어요';
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
