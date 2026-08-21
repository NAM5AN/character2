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
type SavedDraft={
  usageSessionId?:unknown;
  personalityTags?:{
    aiInitial?:unknown;
    ownerSelected?:unknown;
    interviewAdaptive?:unknown;
    finalAdaptive?:unknown;
  };
  [key:string]:unknown;
};
type SavedAnalysisSession={
  name?:unknown;
  draft?:SavedDraft;
  [key:string]:unknown;
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

function writeAnalysisSession(saved:SavedAnalysisSession){
  try{localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(saved))}catch{}
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
    const parsed=readAnalysisSession();
    const draft=parsed?.draft;
    if(!parsed||!draft)return;
    const current=draft.personalityTags&&typeof draft.personalityTags==='object'?draft.personalityTags:{};
    draft.personalityTags={...current,ownerSelected:normalized};
    writeAnalysisSession(parsed);
  }catch{}
}

function saveAiInitial(sessionId:string,tags:PersonalityTagKey[]){
  const normalized=personalityTags(tags);
  if(!normalized.length)return;
  const parsed=readAnalysisSession();
  const draft=parsed?.draft;
  if(!parsed||!draft||draft.usageSessionId!==sessionId)return;
  const current=draft.personalityTags&&typeof draft.personalityTags==='object'?draft.personalityTags:{};
  draft.personalityTags={...current,aiInitial:normalized};
  writeAnalysisSession(parsed);
}

function personalityGuidance(tags:PersonalityTagKey[]){
  const descriptions=tags.map(key=>PERSONALITY_TAG_CATALOG.find(tag=>tag.key===key)).filter(Boolean).map(tag=>`${tag!.label} (${tag!.family})`);
  if(!descriptions.length)return '';
  return `오너가 직접 확인한 참고 성향: ${descriptions.join(' / ')}. 이 태그는 질문의 정답이나 절대적 설정이 아닙니다. 성격 라벨을 그대로 다시 묻지 말고 실제 프로필·오너 검수·이전 답변을 우선하세요. 태그는 조건, 예외, 반례, 관계별 차이를 탐색할 때만 보조 참고로 사용하세요.`;
}

// 질문/답변 화자 일치 검증은 질문 생성 API에서 처리하고, 이 컴포넌트는 화면 문구와
// 첫 해석 단계의 오너 성격 태그 검수 UI를 다듬습니다.
export function AnalyzeReviewUiPolish(){
  useEffect(()=>{
    let currentName='';
    const initialTagRequests=new Set<string>();

    // 성격 칩 UI는 AnalyzeFlow의 React state 바깥에서 동작하므로, 질문 생성/최종 분석 요청 직전에
    // 로컬에 저장된 최신 오너 선택값과 AI 최초 선택값을 request draft에 합쳐 보낸다.
    const originalFetch=window.fetch.bind(window);
    window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
      const isQuestionRequest=url.includes('/api/characters/questions/next');
      const isFinalizeRequest=url.includes('/api/characters/finalize');
      if((isQuestionRequest||isFinalizeRequest)&&typeof init?.body==='string'){
        try{
          const payload=JSON.parse(init.body) as Record<string,unknown>;
          const draft=payload.draft&&typeof payload.draft==='object'?payload.draft as Record<string,unknown>:null;
          if(draft){
            const sessionId=typeof draft.usageSessionId==='string'?draft.usageSessionId:'';
            const current=draft.personalityTags&&typeof draft.personalityTags==='object'?draft.personalityTags as Record<string,unknown>:{};
            const persisted=readAnalysisSession()?.draft?.personalityTags;
            const saved=sessionId?readOwnerSelection(sessionId):null;
            const ownerSelected=saved??personalityTags(current.ownerSelected);
            const persistedAi=personalityTags(persisted?.aiInitial);
            const aiInitial=persistedAi.length?persistedAi:personalityTags(current.aiInitial);
            draft.personalityTags={...current,aiInitial,ownerSelected};

            // 질문 생성에만 참고 문구를 일시적으로 traits에 싣는다.
            // finalize에는 이 합성 필드를 넣지 않아 저장된 원본 traits를 오염시키지 않는다.
            if(isQuestionRequest){
              const guidance=personalityGuidance(ownerSelected);
              if(guidance){
                const traits=draft.traits&&typeof draft.traits==='object'?draft.traits as Record<string,unknown>:{};
                draft.traits={...traits,ownerConfirmedPersonalityTags:guidance};
              }
            }

            payload.draft=draft;
            init={...init,body:JSON.stringify(payload)};
          }
        }catch{}
      }
      return originalFetch(input,init);
    }) as typeof window.fetch;

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
        #${PERSONALITY_PICKER_ID} .personality-chip{position:relative;border:1px solid var(--line);background:white;color:var(--ink,#171816);border-radius:999px;padding:9px 13px 9px 31px;font:inherit;font-size:13px;font-weight:800;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease;overflow:visible}
        #${PERSONALITY_PICKER_ID} .personality-chip::before{content:'';position:absolute;left:12px;top:50%;transform:translateY(-50%);width:12px;text-align:center;font-size:13px;font-weight:900;line-height:1}
        #${PERSONALITY_PICKER_ID} .personality-chip[data-selected="true"]{background:var(--ink,#171816);border-color:var(--ink,#171816);color:white}
        #${PERSONALITY_PICKER_ID} .personality-chip[data-selected="true"]::before{content:'✓'}
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
      let aiInitial=personalityTags(draft?.personalityTags?.aiInitial);
      const stored=readOwnerSelection(sessionId);
      let selected=stored??personalityTags(draft?.personalityTags?.ownerSelected);
      if(!selected.length&&stored===null&&aiInitial.length){
        selected=[...aiInitial];
        saveOwnerSelection(sessionId,selected);
      }

      ensurePersonalityStyle();
      const section=document.createElement('section');
      section.id=PERSONALITY_PICKER_ID;
      section.setAttribute('aria-label','캐릭터 성격 성향 선택');
      const heading=document.createElement('div');
      heading.className='personality-heading';
      const intro=document.createElement('div');
      const title=document.createElement('p');
      title.className='personality-title';
      title.textContent='캐릭터의 성격도 한번 확인해볼게요.';
      const copy=document.createElement('p');
      copy.className='personality-copy';
      copy.textContent=aiInitial.length
        ?'프로필을 읽고 가까운 성향을 먼저 골라뒀어요. 맞지 않는 건 빼고, 필요한 건 더해주세요.'
        :'프로필을 바탕으로 가까운 성향을 고르고 있어요. 잠시 뒤 자동으로 선택돼요.';
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
          button.dataset.tooltip=tag.tooltip;
          button.setAttribute('aria-pressed',String(active));
          button.setAttribute('aria-label',`${tag.label}: ${tag.tooltip}`);
          button.textContent=tag.label;
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

      // 기존 parse 모델이 aiInitial을 비워 보낸 경우에만 보정 AI를 한 번 호출한다.
      // 사용자에게는 같은 첫 해석 화면에서 자동 선택된 칩으로 반영된다.
      if(!aiInitial.length&&stored===null&&!initialTagRequests.has(sessionId)){
        initialTagRequests.add(sessionId);
        void (async()=>{
          try{
            const latest=readAnalysisSession();
            const latestDraft=latest?.draft;
            if(!latestDraft||latestDraft.usageSessionId!==sessionId)return;
            const response=await originalFetch('/api/characters/personality/initial',{
              method:'POST',
              headers:{'content-type':'application/json'},
              body:JSON.stringify({draft:latestDraft}),
            });
            const body=await response.json().catch(()=>({}));
            if(!response.ok)return;
            const tags=personalityTags(body?.tags);
            if(!tags.length)return;
            aiInitial=tags;
            saveAiInitial(sessionId,tags);
            // 호출 중 사용자가 직접 칩을 건드리지 않았다면 AI 제안을 그대로 최초 선택으로 사용한다.
            if(readOwnerSelection(sessionId)===null){
              selected=[...tags];
              saveOwnerSelection(sessionId,selected);
            }else{
              selected=readOwnerSelection(sessionId)??selected;
            }
            copy.textContent='프로필을 읽고 가까운 성향을 먼저 골라뒀어요. 맞지 않는 건 빼고, 필요한 건 더해주세요.';
            render();
          }catch{}
        })();
      }
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
          setLoadingTextWithDots(element,'답변을 살펴보고 있어요');
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
    // AnalyzeFlow는 draft를 localStorage에 150ms 지연 저장한다. DOM 변화만 기다리면 첫 진입에서 놓치므로
    // review 화면에 들어온 직후 짧게 재확인해 첫 렌더에서도 칩을 확실히 붙인다.
    const retry=window.setInterval(ensurePersonalityPicker,120);
    return()=>{observer.disconnect();window.clearInterval(retry);window.fetch=originalFetch};
  },[]);

  return null;
}
