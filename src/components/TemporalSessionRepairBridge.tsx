'use client';

import { useEffect } from 'react';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';
const REPAIR_MARKER_KEY='chara_lab_temporal_repair_v1';

type SavedQuestion={
  order?:unknown;
  responseType?:unknown;
  options?:unknown;
  responseConfig?:unknown;
};

type SavedSession={
  draft?:unknown;
  question?:SavedQuestion|null;
  questionHistory?:unknown;
};

function options(value:unknown){return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').slice(0,4):[]}
function needsRepair(question:SavedQuestion){
  if(question.responseType!=='temporal_compare')return false;
  const first=options(question.options).map(item=>item.trim()).sort();
  const config=question.responseConfig&&typeof question.responseConfig==='object'?question.responseConfig as Record<string,unknown>:{};
  const second=options(config.options2).map(item=>item.trim()).sort();
  return second.length!==4||(first.length===4&&first.join('\u0001')===second.join('\u0001'));
}

export function TemporalSessionRepairBridge(){
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      try{
        const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
        if(!raw)return;
        const saved=JSON.parse(raw) as SavedSession;
        const question=saved.question;
        const draft=saved.draft;
        if(!question||!draft||typeof draft!=='object'||!needsRepair(question))return;
        const sessionId=typeof (draft as Record<string,unknown>).usageSessionId==='string'?(draft as Record<string,unknown>).usageSessionId as string:'session';
        const marker=`${sessionId}:${String(question.order??'')}`;
        if(sessionStorage.getItem(REPAIR_MARKER_KEY)===marker)return;
        sessionStorage.setItem(REPAIR_MARKER_KEY,marker);
        const response=await fetch('/api/characters/questions/temporal-options',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,question})});
        const body=await response.json().catch(()=>({}));
        if(cancelled||!response.ok||!Array.isArray(body.options2)||body.options2.length!==4)return;
        const currentRaw=localStorage.getItem(ANALYSIS_SESSION_KEY);
        if(!currentRaw)return;
        const current=JSON.parse(currentRaw) as SavedSession;
        const currentQuestion=current.question;
        if(!currentQuestion||currentQuestion.order!==question.order)return;
        const currentConfig=currentQuestion.responseConfig&&typeof currentQuestion.responseConfig==='object'?currentQuestion.responseConfig as Record<string,unknown>:{};
        current.question={...currentQuestion,responseConfig:{...currentConfig,options2:body.options2}};
        if(Array.isArray(current.questionHistory)){
          current.questionHistory=current.questionHistory.map(item=>{
            if(!item||typeof item!=='object'||(item as Record<string,unknown>).order!==question.order)return item;
            const record=item as Record<string,unknown>;
            const config=record.responseConfig&&typeof record.responseConfig==='object'?record.responseConfig as Record<string,unknown>:{};
            return {...record,responseConfig:{...config,options2:body.options2}};
          });
        }
        localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(current));
        window.location.reload();
      }catch{}
    })();
    return()=>{cancelled=true};
  },[]);
  return null;
}
