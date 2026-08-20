'use client';

import { useEffect } from 'react';

const SHARE_CODE_RE=/^[A-HJ-NP-Z2-9]{8}$/;

// Any successful finalize performed on /analyze receives a permanent character URL.
// This keeps the just-generated summary visible after refresh and also gives the
// report-theme runtime a stable share code to restore the saved palette from.
export function ReplayResultUrlBridge(){
  useEffect(()=>{
    if(window.location.pathname!=='/analyze')return;

    const originalFetch=window.fetch.bind(window);
    window.fetch=async (...args:Parameters<typeof fetch>)=>{
      const response=await originalFetch(...args);
      try{
        const input=args[0];
        const rawUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
        const pathname=new URL(rawUrl,window.location.origin).pathname;
        if(response.ok&&pathname==='/api/characters/finalize'){
          const body=await response.clone().json().catch(()=>null) as {shareCode?:unknown}|null;
          const shareCode=typeof body?.shareCode==='string'?body.shareCode.trim().toUpperCase():'';
          if(SHARE_CODE_RE.test(shareCode)){
            window.history.replaceState(window.history.state,'',`/character/${shareCode}`);
            window.dispatchEvent(new Event('character-report-url-ready'));
          }
        }
      }catch{}
      return response;
    };

    return()=>{
      window.fetch=originalFetch;
    };
  },[]);

  return null;
}
