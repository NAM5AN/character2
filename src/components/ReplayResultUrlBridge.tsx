'use client';

import { readJsonOrStreamResult } from '@/lib/stream-client';
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
          // finalize 는 진행률 NDJSON 스트림이라 .json() 으로는 읽을 수 없다.
          // 여기서 await 하면 스트림이 끝날 때까지 응답 반환이 막혀 진행률이 실시간으로
          // 흐르지 않는다. 복제본을 백그라운드로 읽고 응답은 즉시 돌려준다.
          void readJsonOrStreamResult<{shareCode?:unknown;editToken?:unknown}>(response.clone()).then(body=>{
            const shareCode=typeof body?.shareCode==='string'?body.shareCode.trim().toUpperCase():'';
            const editToken=typeof body?.editToken==='string'?body.editToken:'';
            if(SHARE_CODE_RE.test(shareCode))routeWhenFinalizeHasSettled(shareCode,editToken);
          }).catch(()=>{});
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
