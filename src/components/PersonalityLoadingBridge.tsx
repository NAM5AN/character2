'use client';

import { useEffect } from 'react';
import {
  isPersonalityTagKey,
  PERSONALITY_TAG_MAX_SELECTIONS,
  type PersonalityTagKey,
} from '@/lib/personality-tags';
import { setLoadingPersonalityTags } from '@/lib/loading-flavor';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';
const OWNER_TAG_KEY='chara_lab_personality_owner_tags_v1';
const LOADING_TAG_KEY='chara_lab_personality_loading_tags_v1';

type DraftLike={
  usageSessionId?:unknown;
  personalityTags?:{
    aiInitial?:unknown;
    ownerSelected?:unknown;
    interviewAdaptive?:unknown;
    finalAdaptive?:unknown;
  };
};

function normalizeTags(value:unknown):PersonalityTagKey[]{
  if(!Array.isArray(value))return[];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0,PERSONALITY_TAG_MAX_SELECTIONS);
}

function readOwnerTags(sessionId:string,fallback:unknown):PersonalityTagKey[]{
  try{
    const raw=localStorage.getItem(OWNER_TAG_KEY);
    if(raw){
      const saved=JSON.parse(raw) as {sessionId?:unknown;tags?:unknown};
      if(saved.sessionId===sessionId)return normalizeTags(saved.tags);
    }
  }catch{}
  return normalizeTags(fallback);
}

function readCurrentDraft():DraftLike|null{
  try{
    const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as {draft?:unknown};
    return parsed.draft&&typeof parsed.draft==='object'?parsed.draft as DraftLike:null;
  }catch{return null}
}

export function PersonalityLoadingBridge(){
  useEffect(()=>{
    let lastOwnerSignature='';

    const syncOwnerTags=()=>{
      const draft=readCurrentDraft();
      const sessionId=typeof draft?.usageSessionId==='string'?draft.usageSessionId:'';
      if(!sessionId)return;
      const selected=readOwnerTags(sessionId,draft?.personalityTags?.ownerSelected);
      const signature=`${sessionId}:${selected.join('|')}`;
      if(signature===lastOwnerSignature)return;
      lastOwnerSignature=signature;
      setLoadingPersonalityTags(sessionId,selected,'owner');
    };

    syncOwnerTags();
    const syncTimer=window.setInterval(syncOwnerTags,350);

    // AnalyzeReviewUiPolish가 먼저 감싼 fetch를 이어받아, 최종 분석 요청 직전에만
    // 20문항 기반 성격 재판별을 한 번 수행한다.
    const nextFetch=window.fetch.bind(window);
    const wrappedFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;

      // 새 프로필 분석을 시작하면 이전 캐릭터의 임시 로딩 태그를 제거한다.
      if(url.includes('/api/characters/parse')){
        try{localStorage.removeItem(LOADING_TAG_KEY)}catch{}
      }

      if(url.includes('/api/characters/finalize')&&typeof init?.body==='string'){
        try{
          const payload=JSON.parse(init.body) as Record<string,unknown>;
          const draft=payload.draft&&typeof payload.draft==='object'?payload.draft as DraftLike:null;
          const answers=Array.isArray(payload.answers)?payload.answers:[];
          const sessionId=typeof draft?.usageSessionId==='string'?draft.usageSessionId:'';
          if(draft&&sessionId&&answers.length===20){
            const state=draft.personalityTags&&typeof draft.personalityTags==='object'?draft.personalityTags:{};
            const ownerSelected=readOwnerTags(sessionId,state.ownerSelected);
            draft.personalityTags={...state,ownerSelected};
            setLoadingPersonalityTags(sessionId,ownerSelected,'owner');

            try{
              const adaptiveResponse=await nextFetch('/api/characters/personality/adaptive',{
                method:'POST',
                headers:{'content-type':'application/json'},
                body:JSON.stringify({draft,answers}),
              });
              const adaptiveBody=await adaptiveResponse.json().catch(()=>({}));
              if(adaptiveResponse.ok){
                const interviewAdaptive=normalizeTags((adaptiveBody as {tags?:unknown}).tags);
                if(interviewAdaptive.length){
                  draft.personalityTags={...draft.personalityTags,interviewAdaptive};
                  setLoadingPersonalityTags(sessionId,interviewAdaptive,'interview');
                }
              }
            }catch{}

            payload.draft=draft;
            init={...init,body:JSON.stringify(payload)};
          }
        }catch{}
      }

      return nextFetch(input,init);
    }) as typeof window.fetch;

    window.fetch=wrappedFetch;
    return()=>{
      window.clearInterval(syncTimer);
      if(window.fetch===wrappedFetch)window.fetch=nextFetch;
    };
  },[]);

  return null;
}
