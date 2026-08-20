'use client';

import { useEffect } from 'react';

const SHARE_CODE_RE=/^[A-HJ-NP-Z2-9]{8}$/;

// A finalized report must be rendered by the same canonical route used when a
// saved character is reopened. Older behavior only replaced the address bar,
// leaving AnalyzeFlow mounted under a /character/... URL; that created two
// visually similar but technically different report screens.
export function ReplayResultUrlBridge(){
  useEffect(()=>{
    if(window.location.pathname!=='/analyze')return;

    const originalFetch=window.fetch.bind(window);
    let redirectTimer:number|undefined;

    const routeWhenFinalizeHasSettled=(shareCode:string,editToken:string)=>{
      const canonical=`/character/${shareCode}`;
      const startedAt=Date.now();

      const check=()=>{
        // AnalyzeFlow stores the edit token immediately after it has fully read
        // the finalize response. Reaching that point also means any outer fetch
        // bridge (notably theme persistence) has finished its own work.
        let callerSettled=false;
        try{
          callerSettled=Boolean(editToken)&&localStorage.getItem(`chara_edit_${shareCode}`)===editToken;
        }catch{}

        // Fallback for browsers where storage is unavailable: the inline report
        // only mounts after AnalyzeFlow has consumed the response.
        const resultMounted=Boolean(document.querySelector('.analyze-page .report-mag'));

        if(callerSettled||resultMounted||Date.now()-startedAt>10000){
          window.location.replace(canonical);
          return;
        }
        redirectTimer=window.setTimeout(check,25);
      };

      redirectTimer=window.setTimeout(check,0);
    };

    window.fetch=async (...args:Parameters<typeof fetch>)=>{
      const response=await originalFetch(...args);
      try{
        const input=args[0];
        const rawUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
        const pathname=new URL(rawUrl,window.location.origin).pathname;
        if(response.ok&&pathname==='/api/characters/finalize'){
          const body=await response.clone().json().catch(()=>null) as {shareCode?:unknown;editToken?:unknown}|null;
          const shareCode=typeof body?.shareCode==='string'?body.shareCode.trim().toUpperCase():'';
          const editToken=typeof body?.editToken==='string'?body.editToken:'';
          if(SHARE_CODE_RE.test(shareCode))routeWhenFinalizeHasSettled(shareCode,editToken);
        }
      }catch{}
      return response;
    };

    return()=>{
      if(redirectTimer!==undefined)window.clearTimeout(redirectTimer);
      window.fetch=originalFetch;
    };
  },[]);

  return null;
}
