'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

async function copyShareUrl(url:string){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(url);
    return;
  }
  const field=document.createElement('textarea');
  field.value=url;
  field.setAttribute('readonly','');
  field.style.position='fixed';
  field.style.opacity='0';
  document.body.appendChild(field);
  field.select();
  const copied=document.execCommand('copy');
  field.remove();
  if(!copied)throw new Error('COPY_FAILED');
}

export function DetailReportShareFooterBridge(){
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const [status,setStatus]=useState('');
  const statusTimer=useRef<number|null>(null);

  useEffect(()=>{
    const locate=()=>{
      const next=document.querySelector<HTMLElement>('#paid-detail-report .report-mag .sheet');
      setTarget(current=>current===next?current:next);
    };
    locate();
    const observer=new MutationObserver(locate);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>()=>{
    if(statusTimer.current!==null)window.clearTimeout(statusTimer.current);
  },[]);

  function showStatus(message:string){
    setStatus(message);
    if(statusTimer.current!==null)window.clearTimeout(statusTimer.current);
    statusTimer.current=window.setTimeout(()=>setStatus(''),1800);
  }

  async function shareReport(){
    const url=`${window.location.origin}${window.location.pathname}`;
    const data={
      title:'CHA LAB 캐릭터 리포트',
      text:'캐릭터 리포트를 확인해보세요.',
      url,
    };

    if(typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare(data))){
      try{
        await navigator.share(data);
        showStatus('공유했어요');
        return;
      }catch(error){
        if(error instanceof DOMException&&error.name==='AbortError')return;
      }
    }

    try{
      await copyShareUrl(url);
      showStatus('링크를 복사했어요');
    }catch{
      showStatus('공유하지 못했어요');
    }
  }

  if(!target)return null;

  return createPortal(
    <div
      className="detail-report-share-footer"
      style={{
        display:'flex',
        justifyContent:'center',
        marginTop:28,
        paddingTop:28,
        borderTop:'1px solid var(--line)',
      }}
    >
      <button
        type="button"
        className="btn primary"
        style={{width:'min(100%,420px)',minHeight:48}}
        onClick={()=>void shareReport()}
        aria-live="polite"
      >
        {status||'공유하기'}
      </button>
    </div>,
    target,
  );
}
