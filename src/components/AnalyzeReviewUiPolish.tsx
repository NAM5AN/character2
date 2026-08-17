'use client';

import { useEffect } from 'react';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구와 진행 상태만 다듬습니다.
export function AnalyzeReviewUiPolish(){
  useEffect(()=>{
    let currentName='';
    let summaryProgress=6;
    let summaryWasVisible=false;

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

    const summaryLoader=()=>[...document.querySelectorAll<HTMLElement>('.loading')].find(element=>{
      const label=element.textContent?.replace(/\s+/gu,' ').trim()||'';
      return label.startsWith('캐릭터 요약을 정리하고 있어요')||label.includes('답변을 살펴보고 있어요');
    });

    const syncSummaryProgress=()=>{
      const loading=summaryLoader();
      if(!loading){summaryWasVisible=false;summaryProgress=6;return}
      if(!summaryWasVisible){summaryWasVisible=true;summaryProgress=6}
      const card=loading.closest<HTMLElement>('.card');
      if(!card)return;
      let progress=card.querySelector<HTMLElement>('.summary-progress-value');
      if(!progress){
        progress=document.createElement('div');
        progress.className='summary-progress-value';
        progress.style.marginTop='18px';
        progress.style.fontSize='32px';
        progress.style.lineHeight='1';
        progress.style.fontWeight='900';
        progress.style.fontVariantNumeric='tabular-nums';
        loading.insertAdjacentElement('afterend',progress);
      }
      const value=`${Math.floor(summaryProgress)}%`;
      if(progress.textContent!==value)progress.textContent=value;
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

      syncSummaryProgress();
    };

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    const timer=window.setInterval(()=>{
      const loading=summaryLoader();
      if(loading){
        if(summaryProgress<55)summaryProgress=Math.min(55,summaryProgress+2);
        else if(summaryProgress<80)summaryProgress=Math.min(80,summaryProgress+1);
        else if(summaryProgress<92)summaryProgress=Math.min(92,summaryProgress+.5);
        else summaryProgress=Math.min(96,summaryProgress+.2);
      }
      syncSummaryProgress();
    },700);
    return()=>{observer.disconnect();window.clearInterval(timer)};
  },[]);

  return null;
}
