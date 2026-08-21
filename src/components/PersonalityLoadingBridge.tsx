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

function syncProfileLoadingCopy(){
  const status=document.querySelector<HTMLElement>('.analyze-page .card[aria-busy="true"] [role="status"]');
  if(!status)return;

  const heading=status.querySelector<HTMLElement>(':scope > div:first-child > strong:first-child');
  if(heading&&heading.textContent!=='잠시만 기다려주세요.')heading.textContent='잠시만 기다려주세요.';

  const card=status.closest<HTMLElement>('.card[aria-busy="true"]');
  const button=card?.querySelector<HTMLButtonElement>('.actions .btn.primary');
  if(button?.disabled&&button.textContent?.startsWith('프로필을 읽는 중')&&button.textContent!=='프로필을 읽는 중…'){
    button.textContent='프로필을 읽는 중…';
  }
}

export function PersonalityLoadingBridge(){
  useEffect(()=>{
    let lastOwnerSignature='';
    let copyQueued=false;

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

    const queueProfileLoadingCopy=()=>{
      if(copyQueued)return;
      copyQueued=true;
      window.requestAnimationFrame(()=>{
        copyQueued=false;
        syncProfileLoadingCopy();
      });
    };

    syncOwnerTags();
    queueProfileLoadingCopy();
    const syncTimer=window.setInterval(syncOwnerTags,350);
    const loadingCopyObserver=new MutationObserver(queueProfileLoadingCopy);
    loadingCopyObserver.observe(document.body,{childList:true,subtree:true,characterData:true});

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

            // 예전에는 여기서 적응형 태그 AI 호출을 await 한 뒤에야 finalize 를 보냈다.
            // 성격 태그는 AI 추론 단계 태그와 오너 선택으로 고정하기로 했으므로 그 호출을
            // 제거한다. 리포트 생성이 그만큼 더 빨리 시작된다.
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
      loadingCopyObserver.disconnect();
      if(window.fetch===wrappedFetch)window.fetch=nextFetch;
    };
  },[]);

  return <style>{`
    .analyze-page .card[aria-busy='true'] [role='status'] > p.muted {
      font-size: 13px !important;
      line-height: 1.45 !important;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `}</style>;
}
