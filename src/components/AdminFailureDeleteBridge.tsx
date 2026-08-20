'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const CLEAR_BUTTON_ID='admin-failure-log-clear';
const ROW_BUTTON_ATTR='data-admin-failure-delete';
const REFRESH_BOUND_ATTR='data-failure-delete-refresh-bound';

type FailureListPayload={failures?:{recent?:{id?:unknown}[]}};

function failureCard(){
  return [...document.querySelectorAll<HTMLElement>('.card')].find(card=>
    [...card.querySelectorAll('strong')].some(node=>node.textContent?.trim()==='AI 생성 실패'),
  )||null;
}

function refreshButton(card:HTMLElement){
  return [...card.querySelectorAll<HTMLButtonElement>('button')].find(button=>
    button.id!==CLEAR_BUTTON_ID&&button.textContent?.trim()==='새로고침',
  )||null;
}

function recentStack(card:HTMLElement){
  const toggle=[...card.querySelectorAll<HTMLButtonElement>('button')].find(button=>
    button.textContent?.trim()==='개별 기록 접기',
  );
  const sibling=toggle?.nextElementSibling;
  return sibling instanceof HTMLElement&&sibling.classList.contains('stack')?sibling:null;
}

export function AdminFailureDeleteBridge(){
  const pathname=usePathname();

  useEffect(()=>{
    if(pathname!=='/admin/console')return;
    let disposed=false;
    let recentIds:number[]|null=null;
    let recentPromise:Promise<number[]>|null=null;

    const loadRecentIds=async()=>{
      if(recentIds)return recentIds;
      if(recentPromise)return recentPromise;
      recentPromise=(async()=>{
        try{
          const response=await fetch('/api/admin/gen-failures',{cache:'no-store'});
          const body=await response.json().catch(()=>({})) as FailureListPayload;
          if(!response.ok)return[];
          const ids=(body.failures?.recent||[])
            .map(row=>Number(row.id))
            .filter(id=>Number.isSafeInteger(id)&&id>0);
          recentIds=ids;
          return ids;
        }catch{return[]}
        finally{recentPromise=null}
      })();
      return recentPromise;
    };

    const requestDelete=async(payload:{all:true}|{ids:number[]})=>{
      const response=await fetch('/api/admin/gen-failures',{
        method:'DELETE',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload),
      });
      const body=await response.json().catch(()=>({}));
      if(response.status===401){
        window.alert('관리자 세션이 만료됐어요. 다시 로그인해주세요.');
        window.location.reload();
        return null;
      }
      if(!response.ok)throw new Error(String(body?.error||response.status));
      recentIds=null;
      return Number(body?.deleted||0);
    };

    const triggerRefresh=()=>{
      const card=failureCard();
      refreshButton(card||document.body)?.click();
    };

    const ensureClearButton=()=>{
      if(disposed||document.getElementById(CLEAR_BUTTON_ID))return;
      const card=failureCard();
      if(!card)return;
      const refresh=refreshButton(card);
      const actions=refresh?.parentElement;
      if(!actions)return;

      const button=document.createElement('button');
      button.id=CLEAR_BUTTON_ID;
      button.type='button';
      button.className='btn soft';
      button.textContent='확인한 실패 기록 비우기';
      button.style.padding='6px 12px';
      button.style.borderColor='rgba(192,57,43,.34)';
      button.style.color='#9f3026';
      button.title='AI 생성 실패 로그만 삭제합니다. 재시도 기록, 실행 중 상태, 비용/캐릭터 데이터는 유지됩니다.';

      button.addEventListener('click',async()=>{
        const ok=window.confirm(
          '확인한 AI 생성 실패 기록을 모두 비울까요?\n\n실패 로그만 삭제됩니다. 재시도 기록·멈춤 상태·비용 기록·캐릭터 데이터는 그대로 유지됩니다.\n삭제한 실패 로그는 되돌릴 수 없어요.',
        );
        if(!ok)return;
        button.disabled=true;
        button.textContent='삭제 중…';
        try{
          const deleted=await requestDelete({all:true});
          if(deleted===null)return;
          button.textContent=deleted>0?`${deleted}건 삭제됨`:'삭제할 기록 없음';
          triggerRefresh();
          window.setTimeout(()=>{
            if(!button.isConnected)return;
            button.textContent='확인한 실패 기록 비우기';
            button.disabled=false;
          },1400);
        }catch(error){
          window.alert(`실패 기록을 삭제하지 못했어요. (${error instanceof Error?error.message:'UNKNOWN'})`);
        }finally{
          if(button.isConnected&&button.textContent==='삭제 중…'){
            button.textContent='확인한 실패 기록 비우기';
            button.disabled=false;
          }
        }
      });

      actions.insertBefore(button,refresh||null);
    };

    const bindRefreshInvalidation=()=>{
      const card=failureCard();
      if(!card)return;
      const refresh=refreshButton(card);
      if(!refresh||refresh.getAttribute(REFRESH_BOUND_ATTR)==='1')return;
      refresh.setAttribute(REFRESH_BOUND_ATTR,'1');
      refresh.addEventListener('click',()=>{
        recentIds=null;
        window.setTimeout(()=>void syncRowButtons(),80);
      });
    };

    const syncRowButtons=async()=>{
      if(disposed)return;
      const card=failureCard();
      if(!card)return;
      const stack=recentStack(card);
      if(!stack)return;
      const rows=[...stack.children].filter((node):node is HTMLElement=>node instanceof HTMLElement);
      if(!rows.length)return;
      const ids=await loadRecentIds();
      if(disposed)return;

      rows.forEach((row,index)=>{
        const id=ids[index];
        if(!id)return;
        const top=row.firstElementChild;
        if(!(top instanceof HTMLElement)||top.querySelector(`[${ROW_BUTTON_ATTR}]`))return;
        const button=document.createElement('button');
        button.type='button';
        button.className='btn soft';
        button.setAttribute(ROW_BUTTON_ATTR,String(id));
        button.textContent='삭제';
        button.style.padding='3px 8px';
        button.style.fontSize='10px';
        button.style.color='#9f3026';
        button.style.borderColor='rgba(192,57,43,.28)';
        button.title='이 실패 기록만 삭제';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          button.textContent='삭제 중';
          try{
            const deleted=await requestDelete({ids:[id]});
            if(deleted===null)return;
            triggerRefresh();
          }catch(error){
            button.disabled=false;
            button.textContent='삭제';
            window.alert(`실패 기록을 삭제하지 못했어요. (${error instanceof Error?error.message:'UNKNOWN'})`);
          }
        });
        top.appendChild(button);
      });
    };

    const ensure=()=>{
      if(disposed)return;
      ensureClearButton();
      bindRefreshInvalidation();
      void syncRowButtons();
    };

    ensure();
    const observer=new MutationObserver(()=>queueMicrotask(ensure));
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      disposed=true;
      observer.disconnect();
      document.getElementById(CLEAR_BUTTON_ID)?.remove();
      document.querySelectorAll(`[${ROW_BUTTON_ATTR}]`).forEach(node=>node.remove());
    };
  },[pathname]);

  return null;
}
