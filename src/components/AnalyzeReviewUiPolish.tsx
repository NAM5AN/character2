'use client';

import { useEffect } from 'react';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구만 다듬습니다.
export function AnalyzeReviewUiPolish(){
  useEffect(()=>{
    let currentName='';

    const savedName=()=>{
      try{
        const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
        if(!raw)return '';
        const parsed=JSON.parse(raw) as {name?:unknown};
        return typeof parsed.name==='string'?parsed.name.trim():'';
      }catch{return ''}
    };

    const apply=()=>{
      const heading=document.querySelector<HTMLElement>('.stack > .card:first-child h2');
      const text=heading?.textContent||'';
      const headingMatch=text.match(/^(.*?)(?:을|를) 이렇게 이해했어요\.$/u);
      if(heading&&headingMatch){
        currentName=headingMatch[1].trim()||currentName;
        heading.textContent=`${currentName}를 좀 더 이해해볼게요.`;
      }

      currentName=currentName||savedName();

      document.querySelectorAll<HTMLElement>('button, .loading').forEach(element=>{
        const label=element.textContent?.replace(/\s+/gu,' ').trim()||'';
        if(label==='첫 5문항 준비 중…'||label.startsWith('첫 5문항을 준비하고 있어요')){
          element.textContent='인터뷰 준비 중…';
        }
        if(label.startsWith('캐릭터 요약을 정리하고 있어요')||label.startsWith('캐릭터의 답변을 살펴보고 있어요')){
          element.textContent=currentName?`${currentName}의 답변을 살펴보고 있어요`:'답변을 살펴보고 있어요';
        }
      });

      const pageTitle=document.querySelector<HTMLElement>('.page-head h1');
      if(pageTitle){
        const inputStage=!!document.querySelector('.card .field input.input');
        pageTitle.textContent=!inputStage&&currentName?`${currentName} 정밀 분석`:'캐릭터 정밀 분석';
      }
    };

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);

  return null;
}
