'use client';

import { useEffect } from 'react';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구만 다듬습니다.
// 요약 단계의 진행률 %는 AnalyzeFlow가 스트리밍 실제 진행률로 직접 표시합니다.
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

    const setLoadingTextWithDots=(element:HTMLElement,label:string)=>{
      const desired=`${label} `;
      const first=element.firstChild;
      if(first?.nodeType===Node.TEXT_NODE){
        if(first.textContent!==desired)first.textContent=desired;
      }else{
        element.insertBefore(document.createTextNode(desired),first||null);
      }
      const dots=[...element.querySelectorAll<HTMLElement>('i.dot')];
      while(dots.length<3){
        const dot=document.createElement('i');
        dot.className='dot';
        element.appendChild(dot);
        dots.push(dot);
      }
      dots.slice(3).forEach(dot=>dot.remove());
    };

    const apply=()=>{
      const heading=document.querySelector<HTMLElement>('.stack > .card:first-child h2');
      const text=heading?.textContent||'';
      const headingMatch=text.match(/^(.*?)(?:을|를) 이렇게 이해했어요\.$/u);
      if(heading&&headingMatch){
        currentName=headingMatch[1].trim()||currentName;
        const desired=`${currentName}를 좀 더 이해해볼게요.`;
        if(heading.textContent!==desired)heading.textContent=desired;
      }

      currentName=currentName||savedName();

      document.querySelectorAll<HTMLElement>('button').forEach(element=>{
        const label=element.textContent?.replace(/\s+/gu,' ').trim()||'';
        if(label==='첫 5문항 준비 중…'&&element.textContent!=='인터뷰 준비 중…')element.textContent='인터뷰 준비 중…';
      });

      document.querySelectorAll<HTMLElement>('.loading').forEach(element=>{
        const label=element.textContent?.replace(/\s+/gu,' ').trim()||'';
        if(label.startsWith('첫 5문항을 준비하고 있어요')||label.startsWith('인터뷰 준비 중…')){
          setLoadingTextWithDots(element,'인터뷰 준비 중…');
        }
        if(label.startsWith('캐릭터 요약을 정리하고 있어요')||label.includes('답변을 살펴보고 있어요')){
          setLoadingTextWithDots(element,currentName?`${currentName}의 답변을 살펴보고 있어요`:'답변을 살펴보고 있어요');
        }
      });

      const pageTitle=document.querySelector<HTMLElement>('.page-head h1');
      if(pageTitle){
        const inputStage=!!document.querySelector('.card .field input.input');
        const desired=!inputStage&&currentName?`${currentName} 정밀 분석`:'캐릭터 정밀 분석';
        if(pageTitle.textContent!==desired)pageTitle.textContent=desired;
      }
    };

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);

  return null;
}
