'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export function AdminFeedbackShortcut(){
  const pathname=usePathname();
  const [newCount,setNewCount]=useState(0);

  const loadNewCount=useCallback(async()=>{
    if(pathname!=='/admin/console')return;
    try{
      const res=await fetch('/api/admin/feedback',{cache:'no-store'});
      if(!res.ok){setNewCount(0);return;}
      const body=await res.json().catch(()=>({}));
      const reports=Array.isArray(body?.reports)?body.reports:[];
      setNewCount(reports.filter((item:{status?:unknown})=>item?.status==='new').length);
    }catch{
      // 알림 조회 실패는 관리자 콘솔 사용 자체를 막지 않는다.
    }
  },[pathname]);

  useEffect(()=>{
    if(pathname!=='/admin/console')return;
    void loadNewCount();
    const interval=window.setInterval(()=>void loadNewCount(),15000);
    const onFocus=()=>void loadNewCount();
    const onVisibility=()=>{if(document.visibilityState==='visible')void loadNewCount();};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{
      window.clearInterval(interval);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[pathname,loadNewCount]);

  if(pathname!=='/admin/console')return null;
  const hasNew=newCount>0;
  return <Link
    className={`btn primary admin-feedback-shortcut${hasNew?' has-new-feedback':''}`}
    href="/admin/feedback"
    aria-label={hasNew?`제보함, 확인하지 않은 새 제보 ${newCount}건`:'제보함'}
    title={hasNew?`확인하지 않은 새 제보 ${newCount}건`:'제보함'}
  >
    <span>제보함</span>
    {hasNew&&<><span className="admin-feedback-alert-mark" aria-hidden="true">!</span><span className="admin-feedback-new-count">{newCount>99?'99+':newCount}</span></>}
  </Link>;
}
