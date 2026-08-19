'use client';

import { useEffect } from 'react';
import { applyName } from '@/lib/josa';
import {
  PERSONALITY_TAG_CATALOG,
  PERSONALITY_TAG_MAX_SELECTIONS,
  isPersonalityTagKey,
  type PersonalityTagKey,
} from '@/lib/personality-tags';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';
const PERSONALITY_OWNER_TAG_KEY='chara_lab_personality_owner_tags_v1';
const PERSONALITY_PICKER_ID='personality-tag-picker';
const PERSONALITY_STYLE_ID='personality-tag-picker-style';

type SavedPersonalitySelection={sessionId:string;tags:PersonalityTagKey[]};
type SavedAnalysisSession={
  name?:unknown;
  draft?:{
    usageSessionId?:unknown;
    personalityTags?:{
      aiInitial?:unknown;
      ownerSelected?:unknown;
    };
  };
};

function personalityTags(value:unknown):PersonalityTagKey[]{
  if(!Array.isArray(value))return[];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0,PERSONALITY_TAG_MAX_SELECTIONS);
}

function readAnalysisSession():SavedAnalysisSession|null{
  try{
    const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as unknown;
    return parsed&&typeof parsed==='object'?parsed as SavedAnalysisSession:null;
  }catch{return null}
}

function readOwnerSelection(sessionId:string):PersonalityTagKey[]|null{
  try{
    const raw=localStorage.getItem(PERSONALITY_OWNER_TAG_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as Partial<SavedPersonalitySelection>;
    if(parsed.sessionId!==sessionId)return null;
    return personalityTags(parsed.tags);
  }catch{return null}
}

function saveOwnerSelection(sessionId:string,tags:PersonalityTagKey[]){
  const normalized=personalityTags(tags);
  try{
    localStorage.setItem(PERSONALITY_OWNER_TAG_KEY,JSON.stringify({sessionId,tags:normalized} satisfies SavedPersonalitySelection));
    const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
    if(!raw)return;
    const parsed=JSON.parse(raw) as Record<string,unknown>;
    const draft=parsed.draft&&typeof parsed.draft==='object'?parsed.draft as Record<string,unknown>:null;
    if(!draft)return;
    const current=draft.personalityTags&&typeof draft.personalityTags==='object'?draft.personalityTags as Record<string,unknown>:{};
    draft.personalityTags={...current,ownerSelected:normalized};
    localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(parsed));
  }catch{}
}

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구와
// 첫 해석 단계의 오너 성격 태그 검수 UI를 다듬습니다.
export function AnalyzeReviewUiPolish(){
  useEffect(()=>{
    let currentName='';

    const savedName=()=>{
      const saved=readAnalysisSession();
      return typeof saved?.name==='string'?saved.name.trim():'';
    };

    const ensurePersonalityStyle=()=>{
      if(document.getElementById(PERSONALITY_STYLE_ID))return;
      const style=document.createElement('style');
      style.id=PERSONALITY_STYLE_ID;
      style.textContent=`
        #${PERSONALITY_PICKER_ID}{margin-top:26px;padding-top:24px;border-top:1px solid var(--line)}
        #${PERSONALITY_PICKER_ID} .personality-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
        #${PERSONALITY_PICKER_ID} .personality-title{margin:0;font-size:16px;font-weight:900;color:var(--ink,#171816)}
        #${PERSONALITY_PICKER_ID} .personality-copy{margin:6px 0 0;color:var(--muted,#777);font-size:13px;line-height:1.55}
        #${PERSONALITY_PICKER_ID} .personality-count{font-size:12px;font-weight:800;color:var(--muted,#777);white-space:nowrap}
        #${PERSONALITY_PICKER_ID} .personality-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;overflow:visible}
        #${PERSONALITY_PICKER_ID} .personality-chip{position:relative;border:1px solid var(--line);background:white;color:var(--ink,#171816);border-radius:999px;padding:9px 13px;font:inherit;font-size:13px;font-weight:800;line-height:1;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease;overflow:visible}
        #${PERSONALITY_PICKER_ID} .personality-chip[data-selected="true"]{background:var(--ink,#171816);border-color:var(--ink,#171816);color:white}
        #${PERSONALITY_PICKER_ID} .personality-chip[data-blocked="true"]{opacity:.42;cursor:not-allowed}
        #${PERSONALITY_PICKER_ID} .personality-chip::after{content:attr(data-tooltip);position:absolute;left:50%;bottom:calc(100% + 9px);transform:translate(-50%,5px);width:max-content;max-width:240px;padding:7px 9px;border-radius:8px;background:#171816;color:#fff;font-size:11px;font-weight:700;line-height:1.35;white-space:normal;opacity:0;visibility:hidden;pointer-events:none;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,.16);transition:opacity .12s ease,transform .12s ease,visibility .12s ease}
        #${PERSONALITY_PICKER_ID} .personality-chip:hover::after,#${PERSONALITY_PICKER_ID} .personality-chip:focus-visible::after{opacity:1;visibility:visible;transform:translate(-50%,0)}
      `;
      document.head.appendChild(style);
    };

    const ensurePersonalityPicker=()=>{
      const reviewHeading=document.querySelector<HTMLElement>('.stack > .card:first-child h2');
      if(!reviewHeading||!reviewHeading.textContent?.includes('잘 이해한게 맞나요?'))return;
      const firstCard=reviewHeading.closest<HTMLElement>('.card');
      if(!firstCard||firstCard.querySelector(`#${PERSONALITY_PICKER_ID}`))return;

      const saved=readAnalysisSession();
      const draft=saved?.draft;
      const sessionId=typeof draft?.usageSessionId==='string'?draft.usageSessionId:'';
      if(!sessionId)return;
      const aiInitial=personalityTags(draft?.personalityTags?.aiInitial);
      const stored=readOwnerSelection(sessionId);
      let selected=stored??personalityTags(draft?.personalityTags?.ownerSelected);
      if(!selected.length&&stored===null)selected=[...aiInitial];
      saveOwnerSelection(sessionId,selected);

      ensurePersonalityStyle();
      const section=document.createElement('section');
      section.id=PERSONALITY_PICKER_ID;
      section.setAttribute('aria-label','캐릭터 성격 성향 선택');
      const heading=document.createElement('div');
      heading.className='personality-heading';
      const intro=document.createElement('div');
      const title=document.createElement('p');
      title.className='personality-title';
      title.textContent='캐릭터의 성격도 한번 확인해볼까요?';
      const copy=document.createElement('p');
      copy.className='personality-copy';
      copy.textContent='AI가 프로필을 읽고 가까운 성향을 먼저 골라뒀어요. 맞지 않는 건 빼고, 필요한 건 더해주세요.';
      const count=document.createElement('span');
      count.className='personality-count';
      intro.append(title,copy);heading.append(intro,count);
      const chips=document.createElement('div');
      chips.className='personality-chips';
      section.append(heading,chips);

      const render=()=>{
        count.textContent=`${selected.length} / ${PERSONALITY_TAG_MAX_SELECTIONS} 선택`;
        chips.replaceChildren();
        for(const tag of PERSONALITY_TAG_CATALOG){
          const active=selected.includes(tag.key);
          const blocked=!active&&selected.length>=PERSONALITY_TAG_MAX_SELECTIONS;
          const button=document.createElement('button');
          button.type='button';
          button.className='personality-chip';
          button.dataset.selected=String(active);
          button.dataset.blocked=String(blocked);
          button.dataset.tooltip=tag.family;
          button.setAttribute('aria-pressed',String(active));
          button.setAttribute('aria-label',`${tag.label}: ${tag.family}`);
          button.textContent=`${active?'✓ ':''}${tag.label}`;
          button.addEventListener('click',()=>{
            if(active){selected=selected.filter(key=>key!==tag.key)}
            else if(selected.length<PERSONALITY_TAG_MAX_SELECTIONS){selected=[...selected,tag.key]}
            saveOwnerSelection(sessionId,selected);
            render();
          });
          chips.appendChild(button);
        }
      };
      render();
      firstCard.appendChild(section);
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
        const desired=applyName('제가 {name}을 잘 이해한게 맞나요?',currentName);
        if(heading.textContent!==desired)heading.textContent=desired;
      }

      currentName=currentName||savedName();
      ensurePersonalityPicker();

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
