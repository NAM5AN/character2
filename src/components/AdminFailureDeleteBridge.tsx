'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const BUTTON_ID = 'admin-failure-log-clear';

function failureCard(){
  return [...document.querySelectorAll<HTMLElement>('.card')].find(card=>
    [...card.querySelectorAll('strong')].some(node=>node.textContent?.trim()==='AI 생성 실패'),
  )||null;
}

function refreshButton(card:HTMLElement){
  return [...card.querySelectorAll<HTMLButtonElement>('button')].find(button=>
    button.id!==BUTTON_ID&&button.textContent?.trim()==='새로고침',
  )||null;
}

export function AdminFailureDeleteBridge(){
  const pathname=usePathname();

  useEffect(()=>{
    if(pathname!=='/admin/console')return;
    let disposed=false;

    const ensure=()=>{
      if(disposed||document.getElementById(BUTTON_ID))return;
      const card=failureCard();
      if(!card)return;
      const refresh=refreshButton(card);
      const actions=refresh?.parentElement;
      if(!actions)return;

      const button=document.createElement('button');
      button.id=BUTTON_ID;
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
          const response=await fetch('/api/admin/gen-failures',{
            method:'DELETE',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({all:true}),
          });
          const body=await response.json().catch(()=>({}));
          if(response.status===401){
            window.alert('관리자 세션이 만료됐어요. 다시 로그인해주세요.');
            window.location.reload();
            return;
          }
          if(!response.ok){
            window.alert(`실패 기록을 삭제하지 못했어요. (${body?.error||response.status})`);
            return;
          }
          const deleted=Number(body?.deleted||0);
          button.textContent=deleted>0?`${deleted}건 삭제됨`:'삭제할 기록 없음';
          const freshCard=failureCard();
          const reload=freshCard?refreshButton(freshCard):null;
          reload?.click();
          window.setTimeout(()=>{
            if(!button.isConnected)return;
            button.textContent='확인한 실패 기록 비우기';
            button.disabled=false;
          },1400);
        }catch{
          window.alert('실패 기록 삭제 중 네트워크 오류가 발생했어요.');
        }finally{
          if(button.isConnected&&button.textContent==='삭제 중…'){
            button.textContent='확인한 실패 기록 비우기';
            button.disabled=false;
          }
        }
      });

      actions.insertBefore(button,refresh||null);
    };

    ensure();
    const observer=new MutationObserver(()=>queueMicrotask(ensure));
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      disposed=true;
      observer.disconnect();
      document.getElementById(BUTTON_ID)?.remove();
    };
  },[pathname]);

  return null;
}
